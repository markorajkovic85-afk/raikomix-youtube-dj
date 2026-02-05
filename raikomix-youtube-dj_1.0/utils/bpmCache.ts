export type BpmCacheEntry = {
  bpm: number;
  bpmConfidence: number;
  musicalKey?: string;
  keyConfidence?: number;
  analyzedAt: number;
};

const CACHE_PREFIX = 'bpmCache:v1:';

export const getBpmCacheEntry = (fingerprint: string): BpmCacheEntry | null => {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${fingerprint}`);
    if (!raw) return null;
    return JSON.parse(raw) as BpmCacheEntry;
  } catch {
    return null;
  }
};

export const setBpmCacheEntry = (fingerprint: string, entry: BpmCacheEntry) => {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${fingerprint}`, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (private mode/quota)
  }
};
