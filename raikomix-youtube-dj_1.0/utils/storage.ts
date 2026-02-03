export const safeSetStorageItem = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to persist ${key} in localStorage`, error);
    return false;
  }
};
