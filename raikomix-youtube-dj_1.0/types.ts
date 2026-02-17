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

// Auto DJ Transaction State Machine
export type AutoDJStage = 
  | 'preload'      // Track cued on target deck
  | 'ready'        // Deck reports isReady=true
  | 'playing'      // Deck confirmed playing
  | 'crossfading'  // Crossfade in progress
  | 'complete';    // Transition finished

export interface AutoDJTransaction {
  id: string;                    // Unique transaction ID (timestamp-based)
  targetDeck: DeckId;             // 'A' or 'B'
  sourceDeck: DeckId;             // Deck we're mixing from
  queueItem: QueueItem;           // Track being loaded
  stage: AutoDJStage;             // Current stage
  timestamp: number;              // Transaction start time (ms)
  videoId: string;                // Expected video ID
  retryCount: number;             // Failed attempt counter (max 3)
  stageTimestamps: Partial<Record<AutoDJStage, number>>; // Stage progression tracking
}

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

/** Minimal typed interface for a YouTube IFrame player instance. */
export interface YTPlayerInstance {
  loadVideoById(opts: string | { videoId: string; startSeconds?: number }): void;
  cueVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData(): { title?: string; author?: string; video_id?: string } | null | undefined;
  setVolume(volume: number): void;
  unMute(): void;
  mute(): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  destroy(): void;
}

/** Event objects emitted by the YouTube IFrame API. */
export interface YTPlayerEvent {
  target: YTPlayerInstance;
  data?: number;
}

/** Minimal typed interface for the YT namespace exposed by the IFrame API script. */
export interface YTNamespace {
  Player: new (
    elementId: string | HTMLElement,
    config: {
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: YTPlayerEvent) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
        onError?: (event: YTPlayerEvent) => void;
      };
    }
  ) => YTPlayerInstance;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: YTNamespace;
    gtag?: (...args: unknown[]) => void;
  }
}
