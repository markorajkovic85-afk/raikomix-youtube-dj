import type { WaveformData, WaveformLevel } from '../types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const quantile = (values: number[], q: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + (next - sorted[base]) * rest;
};

const normalizeLevel = (level: WaveformLevel, percentile: number) => {
  const amps: number[] = [];
  for (let i = 0; i < level.samples; i += 1) {
    const pL = level.peakL[i] ?? 0;
    const pR = level.peakR[i] ?? 0;
    const rL = level.rmsL[i] ?? 0;
    const rR = level.rmsR[i] ?? 0;
    const aL = pL * 0.65 + rL * 0.35;
    const aR = pR * 0.65 + rR * 0.35;
    amps.push(aL, aR);
  }

  const scale = Math.max(0.00001, quantile(amps, percentile));

  return {
    ...level,
    peakL: level.peakL.map((v) => clamp01(v / scale)),
    peakR: level.peakR.map((v) => clamp01(v / scale)),
    rmsL: level.rmsL.map((v) => clamp01(v / scale)),
    rmsR: level.rmsR.map((v) => clamp01(v / scale))
  };
};

const downsample2x = <T>(arr: T[], reducer: (a: T, b: T) => T): T[] => {
  const nextLen = Math.floor(arr.length / 2);
  const out: T[] = new Array(nextLen);
  for (let i = 0; i < nextLen; i += 1) {
    const a = arr[i * 2];
    const b = arr[i * 2 + 1];
    out[i] = reducer(a, b);
  }
  return out;
};

const downsampleLevel2x = (prev: {
  samples: number;
  peakL: number[];
  peakR: number[];
  msL: number[];
  msR: number[];
  bandLow?: number[];
  bandMid?: number[];
  bandHigh?: number[];
}) => {
  const nextSamples = Math.floor(prev.samples / 2);

  const peakL = downsample2x(prev.peakL, (a, b) => Math.max(a ?? 0, b ?? 0));
  const peakR = downsample2x(prev.peakR, (a, b) => Math.max(a ?? 0, b ?? 0));
  const msL = downsample2x(prev.msL, (a, b) => ((a ?? 0) + (b ?? 0)) / 2);
  const msR = downsample2x(prev.msR, (a, b) => ((a ?? 0) + (b ?? 0)) / 2);

  const bandLow = prev.bandLow ? downsample2x(prev.bandLow, (a, b) => ((a ?? 0) + (b ?? 0)) / 2) : undefined;
  const bandMid = prev.bandMid ? downsample2x(prev.bandMid, (a, b) => ((a ?? 0) + (b ?? 0)) / 2) : undefined;
  const bandHigh = prev.bandHigh ? downsample2x(prev.bandHigh, (a, b) => ((a ?? 0) + (b ?? 0)) / 2) : undefined;

  return { samples: nextSamples, peakL, peakR, msL, msR, bandLow, bandMid, bandHigh };
};

export const buildWaveformData = (
  audioBuffer: AudioBuffer,
  options?: {
    maxSamples?: number;
    minSamples?: number;
    normalizePercentile?: number;

    /** Frequency band split points (Hz) */
    lowCutHz?: number;
    highCutHz?: number;

    /** Whether to compute band mix ratios for coloring */
    includeBands?: boolean;
  }
): WaveformData => {
  const channels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;

  if (channels === 0 || totalSamples === 0) {
    return {
      version: 1,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels,
      levels: []
    };
  }

  const maxSamples = Math.max(512, options?.maxSamples ?? 8192);
  const minSamples = Math.max(256, Math.min(maxSamples, options?.minSamples ?? 512));
  const normalizePercentile = options?.normalizePercentile ?? 0.95;

  const includeBands = options?.includeBands ?? true;
  const lowCutHz = options?.lowCutHz ?? 250;
  const highCutHz = options?.highCutHz ?? 2500;

  const sampleRate = audioBuffer.sampleRate;
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(Math.min(1, channels - 1));

  const baseSamples = Math.min(maxSamples, Math.max(minSamples, Math.floor(totalSamples / 256)));
  const blockSize = Math.max(1, Math.floor(totalSamples / baseSamples));

  const peakL: number[] = new Array(baseSamples);
  const peakR: number[] = new Array(baseSamples);
  const msL: number[] = new Array(baseSamples);
  const msR: number[] = new Array(baseSamples);

  const bandLow: number[] | undefined = includeBands ? new Array(baseSamples) : undefined;
  const bandMid: number[] | undefined = includeBands ? new Array(baseSamples) : undefined;
  const bandHigh: number[] | undefined = includeBands ? new Array(baseSamples) : undefined;

  // One-pole filters on MONO signal to approximate low/mid/high energy.
  const lowAlpha = includeBands ? (1 - Math.exp(-2 * Math.PI * lowCutHz / sampleRate)) : 0;
  const hpAlpha = includeBands ? Math.exp(-2 * Math.PI * highCutHz / sampleRate) : 0;

  let lowState = 0;
  let hpState = 0;
  let hpPrevX = 0;

  for (let i = 0; i < baseSamples; i += 1) {
    const start = i * blockSize;
    const end = i === baseSamples - 1 ? totalSamples : Math.min(totalSamples, start + blockSize);

    let pL = 0;
    let pR = 0;
    let sL = 0;
    let sR = 0;
    let count = 0;

    let eLow = 0;
    let eMid = 0;
    let eHigh = 0;

    for (let j = start; j < end; j += 1) {
      const l = left[j] ?? 0;
      const r = right[j] ?? l;

      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > pL) pL = al;
      if (ar > pR) pR = ar;

      sL += l * l;
      sR += r * r;
      count += 1;

      if (includeBands) {
        const x = (l + r) * 0.5;

        // Low: one-pole lowpass
        lowState = lowState + lowAlpha * (x - lowState);
        const low = lowState;

        // High: one-pole highpass
        hpState = hpAlpha * (hpState + x - hpPrevX);
        hpPrevX = x;
        const high = hpState;

        // Mid: remainder
        const mid = x - low - high;

        eLow += low * low;
        eMid += mid * mid;
        eHigh += high * high;
      }
    }

    peakL[i] = pL;
    peakR[i] = pR;
    msL[i] = count ? sL / count : 0;
    msR[i] = count ? sR / count : 0;

    if (includeBands && bandLow && bandMid && bandHigh) {
      const tot = Math.max(1e-12, eLow + eMid + eHigh);
      bandLow[i] = clamp01(eLow / tot);
      bandMid[i] = clamp01(eMid / tot);
      bandHigh[i] = clamp01(eHigh / tot);
    }
  }

  const pyramidRaw: Array<{
    samples: number;
    peakL: number[];
    peakR: number[];
    msL: number[];
    msR: number[];
    bandLow?: number[];
    bandMid?: number[];
    bandHigh?: number[];
  }> = [
    { samples: baseSamples, peakL, peakR, msL, msR, bandLow, bandMid, bandHigh }
  ];

  while (pyramidRaw[pyramidRaw.length - 1].samples / 2 >= minSamples && pyramidRaw.length < 6) {
    pyramidRaw.push(downsampleLevel2x(pyramidRaw[pyramidRaw.length - 1]));
  }

  const levels: WaveformLevel[] = pyramidRaw
    .map((lvl) => {
      const rmsL = lvl.msL.map((v) => Math.sqrt(Math.max(0, v)));
      const rmsR = lvl.msR.map((v) => Math.sqrt(Math.max(0, v)));
      return {
        samples: lvl.samples,
        peakL: [...lvl.peakL],
        peakR: [...lvl.peakR],
        rmsL,
        rmsR,
        bandLow: lvl.bandLow ? [...lvl.bandLow] : undefined,
        bandMid: lvl.bandMid ? [...lvl.bandMid] : undefined,
        bandHigh: lvl.bandHigh ? [...lvl.bandHigh] : undefined
      };
    })
    .map((lvl) => normalizeLevel(lvl, normalizePercentile));

  return {
    version: 1,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    channels,
    levels
  };
};

// Legacy helper retained for older call sites (returns a mono envelope).
export const buildWaveformPeaks = (audioBuffer: AudioBuffer, samples = 900): number[] => {
  const data = buildWaveformData(audioBuffer, {
    maxSamples: Math.max(512, samples),
    minSamples: Math.max(256, Math.floor(samples / 2)),
    includeBands: false
  });

  const level = data.levels.reduce((best, lvl) => {
    if (!best) return lvl;
    return Math.abs(lvl.samples - samples) < Math.abs(best.samples - samples) ? lvl : best;
  }, null as any);

  if (!level) return [];

  const mono: number[] = [];
  for (let i = 0; i < level.samples; i += 1) {
    const p = Math.max(level.peakL[i] ?? 0, level.peakR[i] ?? 0);
    const r = Math.max(level.rmsL[i] ?? 0, level.rmsR[i] ?? 0);
    mono.push(clamp01(p * 0.65 + r * 0.35));
  }
  return mono;
};
