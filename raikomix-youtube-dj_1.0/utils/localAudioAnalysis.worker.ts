// raikomix-youtube-dj_1.0/utils/localAudioAnalysis.worker.ts
// Web Worker: heavy BPM + (optional) key detection.

type AnalyzeRequest = {
  id: number;
  type: "analyze";
  monoPcm: ArrayBuffer;
  length: number;
  sampleRate: number;
  options: {
    bpmMin: number;
    bpmMax: number;
    bpmStep: number;
    detectKey: boolean;
  };
};

type AnalyzeResult = {
  id: number;
  type: "result";
  bpm: number | null;
  confidence: number; // 0..1
  candidates?: Array<{ bpm: number; score: number }>;
  musicalKey?: string; // Camelot or "-"
  keyConfidence?: number; // 0..1
};

type AnalyzeError = {
  id: number;
  type: "error";
  message: string;
};

const EPS = 1e-12;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function meanAndStd(x: Float32Array) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= Math.max(1, x.length);

  let v = 0;
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m;
    v += d * d;
  }
  v /= Math.max(1, x.length);
  return { mean: m, std: Math.sqrt(v + EPS) };
}

// Simple 1-pole lowpass state for band split.
function onePoleAlpha(fc: number, sampleRate: number) {
  // alpha in (0,1): rough match, stable, cheap
  const x = (2 * Math.PI * fc) / sampleRate;
  return x / (1 + x);
}

/**
 * Build an onset/beat-strength envelope:
 * - downmix already done
 * - energy flux on (low band + high band), half-wave rectified
 * - smoothed and normalized
 *
 * Returns: envelope at frameRate (frames per second).
 */
function buildOnsetEnvelope(mono: Float32Array, sampleRate: number) {
  const frameSize = 1024;
  const hopSize = 512;
  const frames = Math.floor((mono.length - frameSize) / hopSize);
  if (frames <= 8) return { env: new Float32Array(0), frameRate: sampleRate / hopSize };

  const env = new Float32Array(frames);

  const aLP = onePoleAlpha(150, sampleRate); // low band around kick/bass

  let lp = 0;
  let prevLogLow = 0;
  let prevLogHigh = 0;

  for (let f = 0; f < frames; f++) {
    const base = f * hopSize;

    let eLow = 0;
    let eHigh = 0;

    for (let i = 0; i < frameSize; i++) {
      const x = mono[base + i] || 0;
      lp = lp + aLP * (x - lp);
      const low = lp;
      const high = x - lp;
      eLow += low * low;
      eHigh += high * high;
    }

    // Log-energy flux (robust vs level changes)
    const logLow = Math.log(eLow + EPS);
    const logHigh = Math.log(eHigh + EPS);

    const dLow = Math.max(0, logLow - prevLogLow);
    const dHigh = Math.max(0, logHigh - prevLogHigh);

    // Weighted sum (low band stronger for 4-on-the-floor, high band helps pop/hiphop transients)
    env[f] = dLow + 0.6 * dHigh;

    prevLogLow = logLow;
    prevLogHigh = logHigh;
  }

  // Smooth with a short moving average + simple leaky integration.
  const smoothed = new Float32Array(env.length);
  const win = 4;
  let acc = 0;
  for (let i = 0; i < env.length; i++) {
    acc += env[i];
    if (i >= win) acc -= env[i - win];
    const ma = acc / Math.min(win, i + 1);
    smoothed[i] = ma;
  }

  // Normalize: zero-mean, unit-std, then half-wave rectify.
  const ms = meanAndStd(smoothed);
  for (let i = 0; i < smoothed.length; i++) {
    const z = (smoothed[i] - ms.mean) / ms.std;
    smoothed[i] = Math.max(0, z);
  }

  // Remove slow drift (very light highpass on the envelope).
  let hp = 0;
  const a = 0.995;
  for (let i = 0; i < smoothed.length; i++) {
    hp = a * hp + (1 - a) * smoothed[i];
    smoothed[i] = Math.max(0, smoothed[i] - hp);
  }

  const frameRate = sampleRate / hopSize;
  return { env: smoothed, frameRate };
}

/**
 * Autocorrelation of env for integer lags in [minLag, maxLag].
 * env should be non-negative and roughly normalized.
 */
function autocorrelate(env: Float32Array, minLag: number, maxLag: number) {
  const n = env.length;
  const acf = new Float32Array(maxLag + 2);

  // Precompute energy for normalization
  let e = 0;
  for (let i = 0; i < n; i++) e += env[i] * env[i];
  const denom = Math.max(EPS, e);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    const m = n - lag;
    for (let i = 0; i < m; i++) s += env[i] * env[i + lag];
    // Normalize by signal energy and length (so long lags don't artificially win)
    acf[lag] = (s / denom) * (m / n);
  }
  return acf;
}

function lerpAcf(acf: Float32Array, lag: number) {
  const i0 = Math.floor(lag);
  const i1 = i0 + 1;
  if (i0 < 0 || i1 >= acf.length) return 0;
  const t = lag - i0;
  return acf[i0] * (1 - t) + acf[i1] * t;
}

function estimateBpmFromEnvelope(
  env: Float32Array,
  frameRate: number,
  bpmMin: number,
  bpmMax: number,
  bpmStep: number
) {
  // Convert bpm range -> lag range
  const minLag = Math.max(2, Math.floor((60 * frameRate) / bpmMax));
  const maxLag = Math.max(minLag + 2, Math.ceil((60 * frameRate) / bpmMin));

  const acf = autocorrelate(env, minLag, maxLag);

  const candidates: Array<{ bpm: number; score: number }> = [];

  let bestBpm = 0;
  let bestScore = -1;
  let secondScore = -1;

  for (let bpm = bpmMin; bpm <= bpmMax + 1e-9; bpm += bpmStep) {
    const lag = (60 * frameRate) / bpm;

    // Tempogram-ish harmonic sum to reduce half/double-time errors:
    // base + 1/2 weight at double-lag (half tempo) + 1/4 weight at half-lag (double tempo)
    let score = lerpAcf(acf, lag);
    score += 0.5 * lerpAcf(acf, lag * 2);
    score += 0.25 * lerpAcf(acf, lag * 0.5);

    candidates.push({ bpm, score });

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestBpm = bpm;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Confidence: combine separation + peak prominence
  const scores = candidates.map((c) => c.score);
  const avg = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  const variance =
    scores.reduce((a, b) => a + (b - avg) * (b - avg), 0) / Math.max(1, scores.length);
  const std = Math.sqrt(variance + EPS);

  const separation = (bestScore - secondScore) / Math.max(EPS, bestScore);
  const prominenceZ = (bestScore - avg) / Math.max(EPS, std);
  const prominence = 1 / (1 + Math.exp(-(prominenceZ - 1.0))); // sigmoid

  let confidence = clamp01(separation) * clamp01(prominence);

  // Final half/double snap (gentle): only if the alternative is nearly as good.
  const scoreAt = (bpm: number) => {
    const lag = (60 * frameRate) / bpm;
    let s = lerpAcf(acf, lag);
    s += 0.5 * lerpAcf(acf, lag * 2);
    s += 0.25 * lerpAcf(acf, lag * 0.5);
    return s;
  };

  if (bestBpm < 90) {
    const dbl = bestBpm * 2;
    if (dbl <= bpmMax) {
      const sD = scoreAt(dbl);
      if (sD >= bestScore * 0.97) bestBpm = dbl;
    }
  } else if (bestBpm > 160) {
    const half = bestBpm * 0.5;
    if (half >= bpmMin) {
      const sH = scoreAt(half);
      if (sH >= bestScore * 0.97) bestBpm = half;
    }
  }

  // Sort candidates for debug/harness
  candidates.sort((a, b) => b.score - a.score);

  return {
    bpm: bestScore > 0.02 ? Math.round(bestBpm * 10) / 10 : null,
    confidence,
    candidates: candidates.slice(0, 8),
  };
}

/* ------------------------ Key detection ------------------------ */

function downsampleLinear(x: Float32Array, srcRate: number, dstRate: number) {
  if (dstRate >= srcRate) return { y: x, sampleRate: srcRate };
  const ratio = srcRate / dstRate;
  const n = Math.floor(x.length / ratio);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(x.length - 1, i0 + 1);
    const frac = t - i0;
    y[i] = x[i0] * (1 - frac) + x[i1] * frac;
  }
  return { y, sampleRate: dstRate };
}

function hannWindow(n: number) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

function fftRadix2(re: Float32Array, im: Float32Array) {
  const n = re.length;
  // bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      const half = len >> 1;

      for (let j = 0; j < half; j++) {
        const uR = re[i + j];
        const uI = im[i + j];
        const vR = re[i + j + half] * wr - im[i + j + half] * wi;
        const vI = re[i + j + half] * wi + im[i + j + half] * wr;

        re[i + j] = uR + vR;
        im[i + j] = uI + vI;
        re[i + j + half] = uR - vR;
        im[i + j + half] = uI - vI;

        const nwr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nwr;
      }
    }
  }
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const CAM_MAJOR_BY_PC = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAM_MINOR_BY_PC = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

function dot(a: number[], b: Float32Array) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[i] * b[i];
  return s;
}

function rotateProfile(p: number[], tonic: number) {
  const r = new Array<number>(12);
  for (let i = 0; i < 12; i++) r[i] = p[(i - tonic + 12) % 12];
  return r;
}

function estimateKeyCamelot(mono: Float32Array, sampleRate: number) {
  // Downsample to reduce FFT cost
  const { y, sampleRate: sr } = downsampleLinear(mono, sampleRate, 11025);

  const N = 2048;
  const H = 1024;
  const w = hannWindow(N);

  if (y.length < N + H) return { musicalKey: "-", keyConfidence: 0 };

  const chroma = new Float32Array(12);
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  for (let pos = 0; pos + N <= y.length; pos += H) {
    // windowed frame
    for (let i = 0; i < N; i++) {
      re[i] = (y[pos + i] || 0) * w[i];
      im[i] = 0;
    }

    fftRadix2(re, im);

    // Accumulate chroma from magnitude spectrum
    const nyq = N >> 1;
    for (let k = 1; k < nyq; k++) {
      const freq = (k * sr) / N;
      if (freq < 65 || freq > 5000) continue;

      const mag2 = re[k] * re[k] + im[k] * im[k];
      if (mag2 < 1e-8) continue;

      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag2;
    }
  }

  // Normalize chroma
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum <= EPS) return { musicalKey: "-", keyConfidence: 0 };
  for (let i = 0; i < 12; i++) chroma[i] /= sum;

  // Score all keys (major + minor)
  let best = { score: -1, tonic: 0, mode: "major" as const };
  let second = { score: -1, tonic: 0, mode: "major" as const };

  for (let tonic = 0; tonic < 12; tonic++) {
    const maj = dot(rotateProfile(MAJOR_PROFILE, tonic), chroma);
    const min = dot(rotateProfile(MINOR_PROFILE, tonic), chroma);

    const consider = (score: number, mode: "major" | "minor") => {
      if (score > best.score) {
        second = best as any;
        best = { score, tonic, mode: mode as any };
      } else if (score > second.score) {
        second = { score, tonic, mode: mode as any } as any;
      }
    };

    consider(maj, "major");
    consider(min, "minor");
  }

  const sep = (best.score - second.score) / Math.max(EPS, best.score);
  const conf = clamp01(sep);

  // Threshold: avoid confidently wrong key
  if (conf < 0.15) return { musicalKey: "-", keyConfidence: conf };

  const musicalKey =
    best.mode === "major" ? CAM_MAJOR_BY_PC[best.tonic] : CAM_MINOR_BY_PC[best.tonic];

  return { musicalKey, keyConfidence: conf };
}

/* ------------------------ Worker wiring ------------------------ */

self.onmessage = (ev: MessageEvent<AnalyzeRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== "analyze") return;

  const { id, monoPcm, length, sampleRate, options } = msg;

  try {
    const mono = new Float32Array(monoPcm, 0, length);

    const { env, frameRate } = buildOnsetEnvelope(mono, sampleRate);
    const tempo = estimateBpmFromEnvelope(env, frameRate, options.bpmMin, options.bpmMax, options.bpmStep);

    let musicalKey: string | undefined;
    let keyConfidence: number | undefined;

    if (options.detectKey) {
      const key = estimateKeyCamelot(mono, sampleRate);
      musicalKey = key.musicalKey;
      keyConfidence = key.keyConfidence;
    }

    const out: AnalyzeResult = {
      id,
      type: "result",
      bpm: tempo.bpm,
      confidence: tempo.confidence,
      candidates: tempo.candidates,
      musicalKey,
      keyConfidence,
    };

    (self as any).postMessage(out);
  } catch (e: any) {
    const err: AnalyzeError = {
      id,
      type: "error",
      message: e?.message || String(e),
    };
    (self as any).postMessage(err);
  }
};
