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
