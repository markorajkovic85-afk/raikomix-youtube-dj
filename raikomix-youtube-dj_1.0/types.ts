export interface WaveformLevel {
  samples: number;

  /** Peak envelope (per-block max abs), per channel */
  peakL: number[];
  peakR: number[];

  /** RMS envelope (per-block rms), per channel */
  rmsL: number[];
  rmsR: number[];

  /** Optional per-block frequency mix ratios (0..1, sum≈1). */
  bandLow?: number[];
  bandMid?: number[];
  bandHigh?: number[];
}

export interface WaveformData {
  version: 1;
  duration: number;
  sampleRate: number;
  channels: number;
  levels: WaveformLevel[];
}

export type DeckId = 'A' | 'B';
export type CrossfaderCurve = 'SMOOTH' | 'CUT' | 'DIP';
export type EffectType =
  | 'ECHO'
  | 'DELAY'
  | 'REVERB'
  | 'FLANGER'
  | 'PHASER'
  | 'CRUSH'
  | 'HIGH_PASS'
  | 'LOW_PASS'
  | 'BAND_PASS'
  | 'CHORUS'
  | 'TREMOLO'
  | 'AUTO_PAN'
  | 'BITCRUSH'
  | 'OVERDRIVE'
  | 'FILTER_SWEEP'
  | 'GATE';
export type TrackSourceType = 'youtube' | 'local';
export type PerformancePadMode = 'ONE_SHOT' | 'HOLD';
export type PerformancePadSourceType = 'youtube' | 'local' | 'empty';
export type YouTubeLoadingState =
  | 'idle'
  | 'searching'
  | 'resolving'
  | 'downloading'
  | 'decoding'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export interface PlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  videoId: string;
  sourceType: TrackSourceType;
  isReady: boolean;
  eqHigh: number;
  eqMid: number;
  eqLow: number;
  filter: number;
  hotCues: (number | null)[];
  loopActive: boolean;
  loopStart: number;
  loopEnd: number;

  /** Pro waveform data (multi-res + stereo + RMS + optional band mix) */
  waveform?: WaveformData;

  /** Legacy mono peaks (kept for backwards compatibility) */
  waveformPeaks?: number[];
}

export interface QueueItem {
  id: string;
  videoId: string;
  url: string;
  title: string;
  thumbnailUrl: string;
  addedAt: number;
  author?: string;
  album?: string;
  fileName?: string;
  sourceType?: TrackSourceType;
}

export interface LibraryTrack {
  id: string;
  videoId: string; // Used as unique identifier or YT ID
  url: string; // URL or ObjectURL
  title: string;
  author: string;
  album?: string;
  thumbnailUrl: string;
  addedAt: number;
  lastPlayed?: number;
  playCount: number;
  sourceType: TrackSourceType;
  fileName?: string;
}

export interface PerformancePadConfig {
  id: number;
  title: string;
  sourceType: PerformancePadSourceType;
  sourceId?: string;
  sourceLabel?: string;
  trimStart: number;
  trimEnd: number;
  trimLength?: number;
  trimLock?: boolean;
  volume: number;
  mode: PerformancePadMode;
  keyBinding: string;
  duration?: number;
  sampleName?: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  color?: string;
}

/**
 * Player Control Interface
 * Standardized interface for controlling both YouTube and local audio players
 * Fixes P2: Type Safety Improvements
 */
export interface PlayerControl {
  setVolume: (volume: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (time: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getVideoData?: () => { title: string; author: string };
}

/**
 * Auto DJ Error Types
 * Defines all possible error conditions in Auto DJ state machine
 */
export type AutoDJError = 
  | { code: 'DECK_NOT_READY'; deck: DeckId }
  | { code: 'QUEUE_EMPTY' }
  | { code: 'PRELOAD_FAILED'; videoId: string; reason: string }
  | { code: 'STALE_TRANSACTION'; transactionId: string }
  | { code: 'INVALID_TRANSITION'; from: string; to: string };

/**
 * YouTube API Error Types
 * Defines specific error conditions when interacting with YouTube API
 */
export type YouTubeAPIError =
  | { code: 'VIDEO_NOT_FOUND'; videoId: string }
  | { code: 'EMBED_NOT_ALLOWED'; videoId: string }
  | { code: 'NETWORK_ERROR'; message: string }
  | { code: 'API_KEY_INVALID' }
  | { code: 'QUOTA_EXCEEDED' };

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
    gtag?: (...args: any[]) => void;
  }
}
