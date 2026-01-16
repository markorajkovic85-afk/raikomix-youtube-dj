
export type DeckId = 'A' | 'B';
export type CrossfaderCurve = 'SMOOTH' | 'CUT' | 'DIP';
export type EffectType = 'ECHO' | 'DELAY' | 'REVERB' | 'FLANGER' | 'PHASER' | 'CRUSH';
export type TrackSourceType = 'youtube' | 'local';

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
  bpm: number;
  musicalKey?: string;
  title?: string;
  author?: string;
}

export interface MixerState {
  crossfader: number;
  masterVolume: number;
  crossfaderCurve: CrossfaderCurve;
}

export interface QueueItem {
  id: string;
  videoId: string;
  url: string;
  title: string;
  thumbnailUrl: string;
  addedAt: number;
  author?: string;
  sourceType?: TrackSourceType;
}

export interface LibraryTrack {
  id: string;
  videoId: string; // Used as unique identifier or YT ID
  url: string;     // URL or ObjectURL
  title: string;
  author: string;
  thumbnailUrl: string;
  addedAt: number;
  lastPlayed?: number;
  playCount: number;
  sourceType: TrackSourceType;
  fileName?: string;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  color?: string;
}

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
    gtag?: (...args: any[]) => void;
  }
}
