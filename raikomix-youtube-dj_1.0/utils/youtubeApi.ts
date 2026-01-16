
import { LibraryTrack, YouTubeSearchResult } from '../types';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Advanced parser for YouTube titles to separate Artist and Song.
 */
export const parseYouTubeTitle = (rawTitle: string, rawAuthor: string) => {
  let title = rawTitle;
  let author = rawAuthor;

  // Clean common noise first
  const noise = [
    /\(Official Video\)/gi, /\[Official Video\]/gi,
    /\(Official Audio\)/gi, /\[Official Audio\]/gi,
    /\(Lyric Video\)/gi, /\[Lyric Video\]/gi,
    /\(Official Music Video\)/gi, /\[Official Music Video\]/gi,
    /\(Lyrics\)/gi, /\[Lyrics\]/gi,
    /\(HD\)/gi, /\[HD\]/gi, /\(HQ\)/gi, /\[HQ\]/gi,
    /【Official】/gi, /「Official」/gi,
    /Video Oficial/gi, /Audio Oficial/gi,
    /4K/g, /1080p/gi
  ];
  
  noise.forEach(pattern => {
    title = title.replace(pattern, '');
  });

  // Common separators for YouTube titles
  const separators = [' - ', ' – ', ' — ', ' | ', ' // ', ' : ', ' ~ ', ' * '];
  
  for (const sep of separators) {
    if (title.includes(sep)) {
      const parts = title.split(sep);
      author = parts[0].trim();
      title = parts.slice(1).join(sep).trim();
      break;
    }
  }

  // If after splitting the author is just a generic channel name like "VEVO", 
  // we keep the original author but use the cleaned title.
  if (author.toLowerCase().includes('vevo') || author.toLowerCase().includes('records')) {
    author = rawAuthor;
  }

  return { title: title.trim(), author: author.trim() };
};

/**
 * Extracts the playlist ID from various YouTube URL formats or raw IDs.
 */
export const extractPlaylistId = (url: string): string | null => {
  const trimmed = url.trim();
  
  // Direct ID check
  if (/^[a-zA-Z0-9-_]{10,64}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const urlObj = new URL(trimmed);
    const listId = urlObj.searchParams.get('list');
    if (listId) return listId;
    
    if (urlObj.pathname.includes('/playlist')) {
      return urlObj.searchParams.get('list');
    }
  } catch (e) {
    const patterns = [
      /[?&]list=([^#&?]+)/,
      /youtube\.com\/playlist\?list=([^&]+)/,
      /video\/[a-zA-Z0-9_-]+\?list=([a-zA-Z0-9_-]+)/
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) return match[1];
    }
  }
  return null;
};

/**
 * Fetches all videos from a YouTube playlist using pagination.
 */
export const fetchPlaylistItems = async (
  playlistId: string,
  onProgress?: (loaded: number, total?: number) => void
): Promise<Partial<LibraryTrack>[]> => {
  // FIX: Using process.env.API_KEY exclusively as mandated by guidelines to avoid ImportMeta errors
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error('API Key missing. Please check your system configuration.');

  let allTracks: Partial<LibraryTrack>[] = [];
  let nextPageToken: string | undefined = '';
  let totalResults: number | undefined;

  try {
    do {
      const queryParams = new URLSearchParams({
        part: 'snippet,contentDetails',
        maxResults: '50',
        playlistId: playlistId,
        key: apiKey
      });

      if (nextPageToken) {
        queryParams.append('pageToken', nextPageToken);
      }

      const response = await fetch(`${YOUTUBE_API_BASE}/playlistItems?${queryParams.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        const msg = errorData.error?.message || 'YouTube API Error';
        throw new Error(msg);
      }

      const data = await response.json();
      
      if (totalResults === undefined) {
        totalResults = data.pageInfo?.totalResults;
      }

      const pageTracks = data.items.map((item: any) => {
        const snippet = item.snippet;
        const vId = item.contentDetails?.videoId || snippet?.resourceId?.videoId;
        
        const { title, author } = parseYouTubeTitle(
          snippet?.title || 'Unknown Title', 
          snippet?.videoOwnerChannelTitle || snippet?.channelTitle || 'Unknown Artist'
        );
        
        return {
          videoId: vId,
          title,
          author,
          thumbnailUrl: snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || `https://img.youtube.com/vi/${vId}/mqdefault.jpg`,
        };
      }).filter((t: any) => t.videoId);

      allTracks = [...allTracks, ...pageTracks];
      nextPageToken = data.nextPageToken;
      
      if (onProgress) onProgress(allTracks.length, totalResults);
    } while (nextPageToken);

    return allTracks;
  } catch (error: any) {
    console.error('fetchPlaylistItems error:', error);
    throw error;
  }
};

/**
 * Searches YouTube for music videos.
 */
export const searchYouTube = async (
  query: string,
  maxResults: number = 15
): Promise<YouTubeSearchResult[]> => {
  // FIX: Using process.env.API_KEY exclusively as mandated by guidelines to avoid ImportMeta errors
  const apiKey = process.env.API_KEY;
  if (!apiKey) return [];

  try {
    const queryParams = new URLSearchParams({
      part: 'snippet',
      maxResults: maxResults.toString(),
      q: query,
      type: 'video',
      videoCategoryId: '10', 
      videoEmbeddable: 'true',
      key: apiKey
    });

    const response = await fetch(`${YOUTUBE_API_BASE}/search?${queryParams.toString()}`);
    if (!response.ok) return [];
    const data = await response.json();
    
    return data.items.map((item: any) => {
      const { title, author } = parseYouTubeTitle(item.snippet.title, item.snippet.channelTitle);
      return {
        videoId: item.id.videoId,
        title,
        channelTitle: author,
        thumbnailUrl: item.snippet.thumbnails?.medium?.url,
      };
    });
  } catch (error) {
    return [];
  }
};
