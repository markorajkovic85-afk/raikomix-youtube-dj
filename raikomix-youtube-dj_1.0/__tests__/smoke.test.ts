/**
 * Smoke tests for pure utility functions.
 * Scope: utilities only — no Web Audio API, YouTube IFrame, or React components.
 * [TASK-001]
 */

import { describe, it, expect } from 'vitest';
import { makeId } from '../utils/id';
import {
  extractVideoId,
  addTrackToLibrary,
  removeFromLibrary,
  saveLibrary,
  loadLibrary,
  updateTrackMetadata,
  incrementPlayCount,
} from '../utils/libraryStorage';
import { LibraryTrack } from '../types';

// ─── makeId ────────────────────────────────────────────────────────────────

describe('makeId()', () => {
  it('returns a non-empty string', () => {
    expect(makeId()).toBeTruthy();
    expect(typeof makeId()).toBe('string');
  });

  it('returns unique values on successive calls', () => {
    const a = makeId();
    const b = makeId();
    expect(a).not.toBe(b);
  });
});

// ─── extractVideoId ─────────────────────────────────────────────────────────

describe('extractVideoId()', () => {
  it('extracts videoId from standard watch URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts videoId from youtu.be short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts videoId from embed URL', () => {
    expect(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URLs', () => {
    expect(extractVideoId('https://example.com/video')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractVideoId('')).toBeNull();
  });
});

// ─── addTrackToLibrary ──────────────────────────────────────────────────────

describe('addTrackToLibrary()', () => {
  it('returns success and a track for a valid YouTube URL', () => {
    const result = addTrackToLibrary('https://www.youtube.com/watch?v=dQw4w9WgXcQ', []);
    expect(result.success).toBe(true);
    expect(result.track).toBeDefined();
    expect(result.track?.videoId).toBe('dQw4w9WgXcQ');
  });

  it('returns failure for an invalid URL', () => {
    const result = addTrackToLibrary('https://example.com/not-youtube', []);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns failure when track already exists in library', () => {
    const existing: LibraryTrack = {
      id: makeId(),
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Test Track',
      author: 'Test Artist',
      thumbnailUrl: '',
      addedAt: Date.now(),
      playCount: 0,
      sourceType: 'youtube',
    };
    const result = addTrackToLibrary('https://www.youtube.com/watch?v=dQw4w9WgXcQ', [existing]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already/i);
  });
});

// ─── removeFromLibrary ──────────────────────────────────────────────────────

describe('removeFromLibrary()', () => {
  const makeTrack = (id: string): LibraryTrack => ({
    id,
    videoId: `vid_${id}`,
    url: `https://www.youtube.com/watch?v=vid_${id}`,
    title: `Track ${id}`,
    author: 'Artist',
    thumbnailUrl: '',
    addedAt: Date.now(),
    playCount: 0,
    sourceType: 'youtube',
  });

  it('removes the track with the given id', () => {
    const tracks = [makeTrack('aaa'), makeTrack('bbb'), makeTrack('ccc')];
    const result = removeFromLibrary('bbb', tracks);
    expect(result).toHaveLength(2);
    expect(result.find(t => t.id === 'bbb')).toBeUndefined();
  });

  it('leaves the array unchanged when id not found', () => {
    const tracks = [makeTrack('aaa')];
    const result = removeFromLibrary('zzz', tracks);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when removing from single-item library', () => {
    const tracks = [makeTrack('aaa')];
    expect(removeFromLibrary('aaa', tracks)).toHaveLength(0);
  });
});

// ─── saveLibrary / loadLibrary round-trip ───────────────────────────────────

describe('saveLibrary() + loadLibrary()', () => {
  it('round-trips an empty library', () => {
    saveLibrary([]);
    expect(loadLibrary()).toEqual([]);
  });

  it('round-trips a single YouTube track', () => {
    const track: LibraryTrack = {
      id: 'test-id-001',
      videoId: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      author: 'Rick Astley',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      addedAt: 1700000000000,
      playCount: 3,
      sourceType: 'youtube',
    };
    saveLibrary([track]);
    const loaded = loadLibrary();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].videoId).toBe('dQw4w9WgXcQ');
    expect(loaded[0].title).toBe('Rick Astley - Never Gonna Give You Up');
    expect(loaded[0].playCount).toBe(3);
  });

  it('omits local tracks from persistence (ObjectURLs are ephemeral)', () => {
    const localTrack: LibraryTrack = {
      id: 'local-001',
      videoId: 'local_file',
      url: 'blob:http://localhost/fake-object-url',
      title: 'My Local File',
      author: 'Me',
      thumbnailUrl: '',
      addedAt: Date.now(),
      playCount: 0,
      sourceType: 'local',
    };
    saveLibrary([localTrack]);
    expect(loadLibrary()).toHaveLength(0);
  });

  it('returns empty array when localStorage contains no entry', () => {
    expect(loadLibrary()).toEqual([]);
  });
});

// ─── updateTrackMetadata ─────────────────────────────────────────────────────

describe('updateTrackMetadata()', () => {
  it('updates title and author for the matching videoId', () => {
    const track: LibraryTrack = {
      id: makeId(), videoId: 'abc123', url: '', title: 'Old Title',
      author: 'Old Artist', thumbnailUrl: '', addedAt: 0, playCount: 0, sourceType: 'youtube',
    };
    const updated = updateTrackMetadata('abc123', { title: 'New Title', author: 'New Artist' }, [track]);
    expect(updated[0].title).toBe('New Title');
    expect(updated[0].author).toBe('New Artist');
  });

  it('does not modify other tracks', () => {
    const track1: LibraryTrack = {
      id: makeId(), videoId: 'aaa', url: '', title: 'Track A',
      author: 'Artist A', thumbnailUrl: '', addedAt: 0, playCount: 0, sourceType: 'youtube',
    };
    const track2: LibraryTrack = {
      id: makeId(), videoId: 'bbb', url: '', title: 'Track B',
      author: 'Artist B', thumbnailUrl: '', addedAt: 0, playCount: 0, sourceType: 'youtube',
    };
    const updated = updateTrackMetadata('aaa', { title: 'Changed' }, [track1, track2]);
    expect(updated[1].title).toBe('Track B');
  });
});

// ─── incrementPlayCount ──────────────────────────────────────────────────────

describe('incrementPlayCount()', () => {
  it('increments playCount by 1 for the matching track', () => {
    const track: LibraryTrack = {
      id: makeId(), videoId: 'xyz', url: '', title: 'T',
      author: 'A', thumbnailUrl: '', addedAt: 0, playCount: 5, sourceType: 'youtube',
    };
    const result = incrementPlayCount('xyz', [track]);
    expect(result[0].playCount).toBe(6);
  });

  it('sets lastPlayed to a recent timestamp', () => {
    const before = Date.now();
    const track: LibraryTrack = {
      id: makeId(), videoId: 'xyz', url: '', title: 'T',
      author: 'A', thumbnailUrl: '', addedAt: 0, playCount: 0, sourceType: 'youtube',
    };
    const result = incrementPlayCount('xyz', [track]);
    expect(result[0].lastPlayed).toBeGreaterThanOrEqual(before);
  });
});
