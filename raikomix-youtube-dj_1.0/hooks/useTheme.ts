
import { useState, useEffect } from 'react';
import { safeSetStorageItem } from '../utils/storage';

export const useTheme = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeSetStorageItem('theme', theme);
    // Also update body color for overall consistency
    document.body.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-background');
  }, [theme]);
  
  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  
  return { theme, setTheme, toggleTheme };
};
