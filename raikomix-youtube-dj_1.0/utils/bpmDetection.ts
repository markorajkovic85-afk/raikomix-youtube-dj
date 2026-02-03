// raikomix-youtube-dj_1.0/utils/bpmDetection.ts

export const extractBPMFromTitle = (title: string): number | null => {
  // Pattern 1: "128 BPM"
  const match1 = title.match(/(\d{2,3})\s*BPM/i);
  if (match1) return parseInt(match1[1]);

  // Pattern 2: "[128BPM]"
  const match2 = title.match(/\[(\d{2,3})BPM\]/i);
  if (match2) return parseInt(match2[1]);

  // Pattern 3: Common BPM ranges (60-180)
  const match3 = title.match(/\b(6[0-9]|7[0-9]|8[0-9]|9[0-9]|1[0-7][0-9]|180)\b/);
  if (match3 && parseInt(match3[1]) >= 60 && parseInt(match3[1]) <= 180) {
    return parseInt(match3[1]);
  }

  return null;
};

export type LocalBpmKeyAnalysis = {
  bpm: number | null;
  confidence: number; // 0..1
  musicalKey?: string; // Camelot like "8A"/"8B", or "-"
  keyConfidence?: number; // 0..1
  candidates?: Array<{ bpm: number; score: number }>;
};

export type LocalBpmKeyAnalysisOptions = {
  // Segment selection
  skipEdgeSeconds?: number; // default 10
  analyzeSeconds?: number; // default 60
  // Tempo search
  bpmMin?: number; // default 70
  bpmMax?: number; // default 180
  bpmStep?: number; // default 0.5
  // Key detection
  detectKey?: boolean; // default false
};

type WorkerRequest =
  | {
      id: number;
      type: "analyze";
      monoPcm: ArrayBuffer;
      length: number;
      sampleRate: number;
      options: Required<Pick<LocalBpmKeyAnalysisOptions, "bpmMin" | "bpmMax" | "bpmStep" | "detectKey">>;
    };

type WorkerResponse =
  | {
      id: number;
      type: "result";
      bpm: number | null;
      confidence: number;
      musicalKey?: string;
      keyConfidence?: number;
      candidates?: Array<{ bpm: number; score: number }>;
    }
  | {
      id: number;
      type: "error";
      message: string;
    };

let workerSingleton: Worker | null = null;
let nextMsgId = 1;
const pending = new Map<
  number,
  { resolve: (v: LocalBpmKeyAnalysis) => void; reject: (e: any) => void }
>();

function getWorker(): Worker {
  if (workerSingleton) return workerSingleton;

  workerSingleton = new Worker(new URL("./localAudioAnalysis.worker.ts", import.meta.url), {
    type: "module",
  });

  workerSingleton.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (msg.type === "error") {
      p.reject(new Error(msg.message));
      return;
    }

    p.resolve({
      bpm: msg.bpm,
      confidence: msg.confidence,
      musicalKey: msg.musicalKey,
      keyConfidence: msg.keyConfidence,
      candidates: msg.candidates,
    });
  };

  workerSingleton.onerror = (err) => {
    // Fail all pending
    for (const [id, p] of pending.entries()) {
      p.reject(err);
      pending.delete(id);
    }
  };

  return workerSingleton;
}

function sleep0(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function pickStableSegment(
  durationSec: number,
  skipEdgeSeconds: number,
  analyzeSeconds: number
): { startSec: number; endSec: number } {
  const safeSkip = Math.max(0, skipEdgeSeconds);
  let start = safeSkip;
  let end = Math.max(start, durationSec - safeSkip);

  // If the file is very short, just take the middle-ish chunk.
  if (end - start <= 1) {
    start = Math.max(0, durationSec * 0.2);
    end = Math.min(durationSec, start + Math.max(1, durationSec * 0.6));
  }

  const available = end - start;
  const take = Math.min(analyzeSeconds, available);

  // Center the selection inside [start, end]
  const mid = (start + end) * 0.5;
  const half = take * 0.5;

  const startSec = Math.max(0, mid - half);
  const endSec = Math.min(durationSec, startSec + take);
  return { startSec, endSec };
}

async function extractMonoPcmSegment(
  audioBuffer: AudioBuffer,
  opts: Required<Pick<LocalBpmKeyAnalysisOptions, "skipEdgeSeconds" | "analyzeSeconds">>
) {
  const { startSec, endSec } = pickStableSegment(audioBuffer.duration, opts.skipEdgeSeconds, opts.analyzeSeconds);
  const sr = audioBuffer.sampleRate;

  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(audioBuffer.length, Math.floor(endSec * sr));
  const length = Math.max(0, endSample - startSample);
  const channels = Math.max(1, audioBuffer.numberOfChannels);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(audioBuffer.getChannelData(ch));

  const mono = new Float32Array(length);

  // Chunked downmix to avoid UI jank on big buffers.
  const CHUNK = 262_144;
  for (let i = 0; i < length; i++) {
    let s = 0;
    const idx = startSample + i;
    for (let ch = 0; ch < channels; ch++) s += channelData[ch][idx] || 0;
    mono[i] = s / channels;

    if (i > 0 && i % CHUNK === 0) {
      await sleep0();
    }
  }

  return { mono, sampleRate: sr };
}

/**
 * Robust BPM (+ optional key) estimator for local files.
 * - Builds onset/beat-strength envelope
 * - Estimates periodicity via autocorrelation over a BPM range
 * - Returns confidence so UI can avoid confidently setting a wrong tempo
 */
export const detectBpmFromAudioBuffer = async (
  audioBuffer: AudioBuffer,
  options: LocalBpmKeyAnalysisOptions = {}
): Promise<LocalBpmKeyAnalysis> => {
  const opts: Required<LocalBpmKeyAnalysisOptions> = {
    skipEdgeSeconds: options.skipEdgeSeconds ?? 10,
    analyzeSeconds: options.analyzeSeconds ?? 60,
    bpmMin: options.bpmMin ?? 70,
    bpmMax: options.bpmMax ?? 180,
    bpmStep: options.bpmStep ?? 0.5,
    detectKey: options.detectKey ?? false,
  };

  const { mono, sampleRate } = await extractMonoPcmSegment(audioBuffer, {
    skipEdgeSeconds: opts.skipEdgeSeconds,
    analyzeSeconds: opts.analyzeSeconds,
  });

  if (mono.length < sampleRate * 3) {
    return { bpm: null, confidence: 0, musicalKey: "-", keyConfidence: 0 };
  }

  const w = getWorker();
  const id = nextMsgId++;

  const req: WorkerRequest = {
    id,
    type: "analyze",
    monoPcm: mono.buffer,
    length: mono.length,
    sampleRate,
    options: {
      bpmMin: opts.bpmMin,
      bpmMax: opts.bpmMax,
      bpmStep: opts.bpmStep,
      detectKey: opts.detectKey,
    },
  };

  return new Promise<LocalBpmKeyAnalysis>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Transfer the PCM buffer so postMessage is zero-copy.
    w.postMessage(req, [mono.buffer]);
  });
};
