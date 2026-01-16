
import React, { useEffect } from 'react';

export const useKeyboardShortcuts = (
  deckARef: React.RefObject<any>,
  deckBRef: React.RefObject<any>,
  crossfader: number,
  onCrossfaderChange: (value: number) => void,
  onToggleHelp: () => void,
  controls?: {
    resetEq?: () => void;
    muteDeck?: (id: 'A' | 'B') => void;
    pitchDeck?: (id: 'A' | 'B', delta: number) => void;
  }
) => {
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      // Help
      if (e.key === '?' || e.key === '/') {
        onToggleHelp();
      }

      // Deck A Controls
      if (e.key === 'q') deckARef.current?.togglePlay();
      if (e.key === 's') deckARef.current?.toggleLoop();
      if (e.key === 'm') controls?.muteDeck?.('A');
      if (e.key === '[') controls?.pitchDeck?.('A', -0.01);
      if (e.key === ']') controls?.pitchDeck?.('A', 0.01);
      if (e.key === '1') deckARef.current?.triggerHotCue(0);
      if (e.key === '2') deckARef.current?.triggerHotCue(1);
      if (e.key === '3') deckARef.current?.triggerHotCue(2);
      if (e.key === '4') deckARef.current?.triggerHotCue(3);
      
      // Deck B Controls
      if (e.key === 'p') deckBRef.current?.togglePlay();
      if (e.key === 'k') deckBRef.current?.toggleLoop();
      if (e.key === 'n') controls?.muteDeck?.('B');
      if (e.key === ';') controls?.pitchDeck?.('B', -0.01);
      if (e.key === "'") controls?.pitchDeck?.('B', 0.01);
      if (e.key === '7') deckBRef.current?.triggerHotCue(0);
      if (e.key === '8') deckBRef.current?.triggerHotCue(1);
      if (e.key === '9') deckBRef.current?.triggerHotCue(2);
      if (e.key === '0') deckBRef.current?.triggerHotCue(3);
      
      // Mixer
      if (e.key === 'r') controls?.resetEq?.();
      
      // Crossfader
      if (e.key === 'ArrowLeft') onCrossfaderChange(Math.max(-1, crossfader - 0.1));
      if (e.key === 'ArrowRight') onCrossfaderChange(Math.min(1, crossfader + 0.1));
      if (e.key === ' ') {
        e.preventDefault();
        onCrossfaderChange(0);
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [deckARef, deckBRef, crossfader, onCrossfaderChange, onToggleHelp, controls]);
};
