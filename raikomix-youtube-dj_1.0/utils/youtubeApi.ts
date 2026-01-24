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
    /Video Oficial/gi, /Audio Oficial/gi,
    /4K/g, /1080p/gi,
  ];
  const literalNoise = ['「Official」'];

  noise.forEach((pattern) => {
    title = title.replace(pattern, '');
  });
  literalNoise.forEach((token) => {
    title = title.replaceAll(token, '');
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
      /video\/[a-zA-Z0-9_-]+\?list=([a-zA-Z0-9_-]+)/,
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
const getYouTubeApiKey = (): string | undefined => {
  const env = (import.meta as any)?.env;
  const envKey = env?.VITE_YOUTUBE_API_KEY || env?.VITE_API_KEY;
  if (envKey) return envKey;
  return process.env.YOUTUBE_API_KEY || process.env.API_KEY;
};

export const hasYouTubeApiKey = (): boolean => Boolean(getYouTubeApiKey());

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://invidious.slipfox.xyz',
  'https://vid.puffyan.us',
];

const fetchFromInvidious = async (
  query: string,
  maxResults: number,
  signal?: AbortSignal
): Promise<YouTubeSearchResult[]> => {
  for (const baseUrl of INVIDIOUS_INSTANCES) {
    try {
      const params = new URLSearchParams({
        q: query,
        type: 'video',
      });
      const response = await fetch(`${baseUrl}/api/v1/search?${params.toString()}`, { signal });
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data)) continue;
      return data
        .filter((item) => item?.type === 'video' && item?.videoId)
        .slice(0, maxResults)
        .map((item) => ({
          videoId: item.videoId,
          title: item.title,
          channelTitle: item.author || 'Unknown Artist',
          thumbnailUrl: `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`,
        }));
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        return [];
      }
    }
  }
  return [];
};

export const fetchPlaylistItems = async (
  playlistId: string,
  onProgress?: (loaded: number, total?: number) => void
): Promise<Partial<LibraryTrack>[]> => {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) throw new Error('API Key missing. Please set VITE_YOUTUBE_API_KEY or YOUTUBE_API_KEY.');

  let allTracks: Partial<LibraryTrack>[] = [];
  let nextPageToken: string | undefined = '';
  let totalResults: number | undefined;

  try {
    do {
      const queryParams = new URLSearchParams({
        part: 'snippet,contentDetails',
        maxResults: '50',
        playlistId: playlistId,
        key: apiKey,
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

      const pageTracks = data.items
        .map((item: any) => {
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
            thumbnailUrl:
              snippet?.thumbnails?.medium?.url ||
              snippet?.thumbnails?.default?.url ||
              `https://img.youtube.com/vi/${vId}/mqdefault.jpg`,
          };
        })
        .filter((t: any) => t.videoId);

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
  maxResults: number = 15,
  signal?: AbortSignal,
  options: { restrictToMusic?: boolean } = {}
): Promise<YouTubeSearchResult[]> => {
  const apiKey = getYouTubeApiKey();

  try {
    if (!apiKey) {
      return await fetchFromInvidious(query, maxResults, signal);
    }
    const { restrictToMusic = true } = options;
    const queryParams = new URLSearchParams({
      part: 'snippet',
      maxResults: maxResults.toString(),
      q: query,
      type: 'video',
      videoEmbeddable: 'true',
      key: apiKey,
    });
    if (restrictToMusic) {
      queryParams.set('videoCategoryId', '10');
    }

    const response = await fetch(`${YOUTUBE_API_BASE}/search?${queryParams.toString()}`, { signal });
    if (!response.ok) {
      return await fetchFromInvidious(query, maxResults, signal);
    }
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
    if ((error as Error)?.name === 'AbortError') {
      return [];
    }
    return await fetchFromInvidious(query, maxResults, signal);
  }
};
