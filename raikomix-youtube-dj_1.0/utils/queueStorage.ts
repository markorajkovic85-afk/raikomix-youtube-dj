import { QueueItem } from '../types';

export const exportQueue = (queue: QueueItem[]): void => {
  const dataStr = JSON.stringify(queue, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `raikomix-queue-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

const formatArtistTitleLine = (item: QueueItem): string => {
  const artist = String(item.author || '').replace(/\s+/g, ' ').trim();
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  if (artist && title) return `${artist} - ${title}`;
  return title || artist || String(item.videoId || '').trim() || 'Unknown';
};

// Export format compatible with playlist importers like TuneMyMusic: one line per track in the form "Artist - Track Name".
export const exportQueueAsText = (queue: QueueItem[]): void => {
  const lines = queue.map(formatArtistTitleLine).filter(Boolean);
  const dataStr = lines.join('\n');
  const blob = new Blob([dataStr], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `raikomix-queue-${new Date().toISOString().split('T')[0]}.txt`;
  link.click();
  URL.revokeObjectURL(url);
};
