import { PerformancePadConfig } from '../types';
import { safeSetStorageItem } from './storage';

const STORAGE_KEY = 'performancePads_v1';
const DB_NAME = 'raikomix-performance-pads';
const STORE_NAME = 'samples';

interface StoredPadSample {
  id: string;
  arrayBuffer: ArrayBuffer;
  name: string;
  mimeType: string;
  updatedAt: number;
}

const openDatabase = (): Promise<IDBDatabase | null> =>
  new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open database'));
  });

export const loadPerformancePads = (): PerformancePadConfig[] | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pads: PerformancePadConfig[] };
    return parsed?.pads ?? null;
  } catch (error) {
    console.warn('Failed to load performance pads', error);
    return null;
  }
};

export const savePerformancePads = (pads: PerformancePadConfig[]) => {
  return safeSetStorageItem(STORAGE_KEY, JSON.stringify({ pads }));
};

export const storePerformancePadSample = async (
  id: string,
  file: File
): Promise<StoredPadSample | null> => {
  const arrayBuffer = await file.arrayBuffer();
  const record: StoredPadSample = {
    id,
    arrayBuffer,
    name: file.name,
    mimeType: file.type || 'audio/mpeg',
    updatedAt: Date.now(),
  };

  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
  } catch (error) {
    console.warn('Failed to open performance pad database', error);
    return null;
  }
  if (!db) {
    return null;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to store sample'));
    });
    return record;
  } finally {
    db.close();
  }
};

export const loadPerformancePadSample = async (id: string): Promise<StoredPadSample | null> => {
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
  } catch (error) {
    console.warn('Failed to open performance pad database', error);
    return null;
  }
  if (!db) {
    return null;
  }
  try {
    const record = await new Promise<StoredPadSample | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error('Failed to load sample'));
    });
    return record;
  } finally {
    db.close();
  }
};

export const removePerformancePadSample = async (id: string) => {
  let db: IDBDatabase | null = null;
  try {
    db = await openDatabase();
  } catch (error) {
    console.warn('Failed to open performance pad database', error);
    return false;
  }
  if (!db) {
    return false;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to delete sample'));
    });
    return true;
  } finally {
    db.close();
  }
};
