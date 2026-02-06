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

const downsampleLevel2x = (prev: {
  samples: number;
  peakL: number[];
  peakR: number[];
  msL: number[];
  msR: number[];
}) => {
  const nextSamples = Math.floor(prev.samples / 2);
  const peakL: number[] = new Array(nextSamples);
  const peakR: number[] = new Array(nextSamples);
  const msL: number[] = new Array(nextSamples);
  const msR: number[] = new Array(nextSamples);

  for (let i = 0; i < nextSamples; i += 1) {
    const a = i * 2;
    const b = a + 1;
    peakL[i] = Math.max(prev.peakL[a] ?? 0, prev.peakL[b] ?? 0);
    peakR[i] = Math.max(prev.peakR[a] ?? 0, prev.peakR[b] ?? 0);
    msL[i] = ((prev.msL[a] ?? 0) + (prev.msL[b] ?? 0)) / 2;
    msR[i] = ((prev.msR[a] ?? 0) + (prev.msR[b] ?? 0)) / 2;
  }

  return { samples: nextSamples, peakL, peakR, msL, msR };
};

export const buildWaveformData = (
  audioBuffer: AudioBuffer,
  options?: {
    maxSamples?: number;
    minSamples?: number;
    normalizePercentile?: number;
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

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(Math.min(1, channels - 1));

  const baseSamples = Math.min(maxSamples, Math.max(minSamples, Math.floor(totalSamples / 256)));
  const blockSize = Math.max(1, Math.floor(totalSamples / baseSamples));

  const peakL: number[] = new Array(baseSamples);
  const peakR: number[] = new Array(baseSamples);
  const msL: number[] = new Array(baseSamples);
  const msR: number[] = new Array(baseSamples);

  for (let i = 0; i < baseSamples; i += 1) {
    const start = i * blockSize;
    const end = i === baseSamples - 1 ? totalSamples : Math.min(totalSamples, start + blockSize);

    let pL = 0;
    let pR = 0;
    let sL = 0;
    let sR = 0;
    let count = 0;

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
    }

    peakL[i] = pL;
    peakR[i] = pR;
    msL[i] = count ? sL / count : 0;
    msR[i] = count ? sR / count : 0;
  }

  const pyramidRaw: Array<{ samples: number; peakL: number[]; peakR: number[]; msL: number[]; msR: number[] }> = [
    { samples: baseSamples, peakL, peakR, msL, msR }
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
        rmsR
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
  const data = buildWaveformData(audioBuffer, { maxSamples: Math.max(512, samples), minSamples: Math.max(256, Math.floor(samples / 2)) });
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
