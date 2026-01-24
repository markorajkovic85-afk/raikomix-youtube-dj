import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

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
