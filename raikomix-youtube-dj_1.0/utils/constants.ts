/**
 * Shared application constants.
 * Centralises magic numbers that appear across multiple files.
 */

/** Timeout durations (milliseconds) */
export const TIMEOUTS = {
  /** Max wait for YouTube player to emit CUED/PLAYING after load command. */
  YOUTUBE_LOAD_MS: 20_000,
  /** Max time a YouTube player may remain in BUFFERING state before error. */
  YOUTUBE_BUFFERING_MS: 15_000,
  /** Max wait for a local audio file to be decoded and ready. */
  LOCAL_AUDIO_MS: 12_000,
  /** Delay before retrying YouTube player initialisation when YT API not yet ready. */
  PLAYER_INIT_RETRY_MS: 500,
  /** Per-request timeout when querying an Invidious fallback instance. */
  INVIDIOUS_REQUEST_MS: 5_000,
} as const;

/** Playback rate (tempo) bounds */
export const PLAYBACK_RATE = {
  MIN: 0.5,
  MAX: 1.5,
  DEFAULT: 1.0,
} as const;
