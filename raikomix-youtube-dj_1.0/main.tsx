
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Environment validation — console-only, non-intrusive
if (!import.meta.env.VITE_YOUTUBE_API_KEY && !import.meta.env.VITE_API_KEY) {
  console.warn(
    '[RaikoMix] No API keys found. ' +
    'Copy .env.example to .env.local and set VITE_YOUTUBE_API_KEY ' +
    'for playlist import and VITE_API_KEY for AI BPM detection.'
  );
} else {
  if (!import.meta.env.VITE_YOUTUBE_API_KEY) {
    console.info(
      '[RaikoMix] VITE_YOUTUBE_API_KEY not set — ' +
      'playlist import will use Invidious fallback (slower).'
    );
  }
  if (!import.meta.env.VITE_API_KEY) {
    console.info(
      '[RaikoMix] VITE_API_KEY not set — AI BPM/key detection disabled.'
    );
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// Mount immediately to ensure visibility
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Global callback for YouTube API
window.onYouTubeIframeAPIReady = () => {
  console.log('YouTube IFrame API Ready');
  // Dispatch a custom event so App can respond if needed
  window.dispatchEvent(new CustomEvent('youtube-api-ready'));
};
