import { LibraryTrack, Playlist } from '../types';
import { safeSetStorageItem } from './storage';

const STORAGE_KEY = 'raikomix_library';
const PLAYLISTS_KEY = 'raikomix_playlists';
const STORAGE_VERSION = 2;

export const loadLibrary = (): LibraryTrack[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const data = JSON.parse(saved);
      const tracks = Array.isArray(data)
      ? data
      : Array.isArray(data?.tracks)
        ? data.tracks
        : [];
    if (!Array.isArray(tracks)) return [];
    // Migration: normalize entries and ensure required fields exist
    return tracks
      .filter(track => track && typeof track === 'object')
      .map(track => {
        const videoId = track.videoId || extractVideoId(track.url || '') || `unknown_${Date.now()}`;
        return {
          id: track.id || `${Date.now()}_${videoId}`,
          videoId,
          url: track.url || `https://www.youtube.com/watch?v=${videoId}`,
          title: track.title || `Track ${videoId}`,
          author: track.author || 'Unknown Artist',
          album: track.album,
          thumbnailUrl: track.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          addedAt: track.addedAt || Date.now(),
          playCount: typeof track.playCount === 'number' ? track.playCount : 0,
          lastPlayed: track.lastPlayed,
          sourceType: track.sourceType || 'youtube',
          fileName: track.fileName
        } as LibraryTrack;
      });
  } catch (e) {
    console.error('Failed to load library:', e);
    return [];
  }
};

export const saveLibrary = (tracks: LibraryTrack[]): boolean => {
  try {
    // Only save tracks that are not local (since ObjectURLs are temporary)
    // Or save them, but know URLs might break
    const persistedTracks = tracks.filter(track => track.sourceType !== 'local');
    return safeSetStorageItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, tracks: persistedTracks })
    );
  } catch (e) {
    console.error('Failed to save library:', e);
    return false;
  }
};

export const loadPlaylists = (): Playlist[] => {
  try {
    const saved = localStorage.getItem(PLAYLISTS_KEY);
    if (!saved) return [];
      const data = JSON.parse(saved);
    if (!Array.isArray(data)) return [];
    return data
      .filter((playlist) => playlist && typeof playlist === 'object')
      .map((playlist) => ({
        id: playlist.id || `pl_${Date.now()}`,
        name: playlist.name || 'Untitled Playlist',
        trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds : [],
        createdAt: playlist.createdAt || Date.now(),
        color: playlist.color
      })) as Playlist[];
  } catch (e) {
    console.error('Failed to load playlists:', e);
    return [];
  }
};

export const savePlaylists = (playlists: Playlist[]): boolean => {
  return safeSetStorageItem(PLAYLISTS_KEY, JSON.stringify(playlists));
};

export const exportLibrary = (library: LibraryTrack[]): void => {
  const dataStr = JSON.stringify(library, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `raikomix-library-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

export const extractVideoId = (url: string): string | null => {
  const match1 = url.match(/[?&]v=([^&]+)/);
  if (match1) return match1[1];
  const match2 = url.match(/youtu\.be\/([^?]+)/);
  if (match2) return match2[1];
  const match3 = url.match(/youtube\.com\/embed\/([^?]+)/);
  if (match3) return match3[1];
  return null;
};

export const addTrackToLibrary = (
  url: string,
  library: LibraryTrack[]
): { success: boolean; track?: LibraryTrack; error?: string } => {
  const videoId = extractVideoId(url);
  if (!videoId) return { success: false, error: 'Invalid YouTube URL' };
  if (library.some(t => t.videoId === videoId)) return { success: false, error: 'Track already in library' };
  
  const track: LibraryTrack = {
    id: `${Date.now()}_${videoId}`,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: `Track ${videoId}`,
    author: 'Unknown Artist',
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    addedAt: Date.now(),
    playCount: 0,
    sourceType: 'youtube'
  };
  return { success: true, track };
};

export const removeFromLibrary = (id: string, library: LibraryTrack[]): LibraryTrack[] => {
  return library.filter(t => t.id !== id);
};

export const revokeLocalTrackUrls = (tracks: LibraryTrack[]) => {
  tracks.forEach(track => {
    if (track.sourceType !== 'local') return;
    try {
      URL.revokeObjectURL(track.url);
    } catch (error) {
      console.warn('Failed to revoke local track URL', error);
    }
  });
};

export const updateTrackMetadata = (
  videoId: string,
  metadata: { title?: string; author?: string; album?: string },
  library: LibraryTrack[]
): LibraryTrack[] => {
  return library.map(track => {
    if (track.videoId === videoId) {
      return { 
        ...track, 
        title: metadata.title || track.title,
        author: metadata.author || track.author,
        album: metadata.album || track.album
      };
    }
    return track;
  });
};

export const incrementPlayCount = (videoId: string, library: LibraryTrack[]): LibraryTrack[] => {
  return library.map(track => {
    if (track.videoId === videoId) {
      return {
        ...track,
        playCount: track.playCount + 1,
        lastPlayed: Date.now()
      };
    }
    return track;
  });
};
