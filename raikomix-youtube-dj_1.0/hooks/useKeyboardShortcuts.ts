
import React, { useEffect, useRef } from 'react';

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
  const deckARefRef = useRef(deckARef);
  const deckBRefRef = useRef(deckBRef);
  const crossfaderRef = useRef(crossfader);
  const onCrossfaderChangeRef = useRef(onCrossfaderChange);
  const onToggleHelpRef = useRef(onToggleHelp);
  const controlsRef = useRef(controls);

  useEffect(() => {
    deckARefRef.current = deckARef;
    deckBRefRef.current = deckBRef;
    crossfaderRef.current = crossfader;
    onCrossfaderChangeRef.current = onCrossfaderChange;
    onToggleHelpRef.current = onToggleHelp;
    controlsRef.current = controls;
  }, [deckARef, deckBRef, crossfader, onCrossfaderChange, onToggleHelp, controls]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      const deckA = deckARefRef.current?.current;
      const deckB = deckBRefRef.current?.current;
      const nextControls = controlsRef.current;

      // Help
      if (e.key === '?' || e.key === '/') {
        onToggleHelpRef.current();
      }

      // Deck A Controls
      if (e.key === 'q') deckA?.togglePlay();
      if (e.key === 's') deckA?.toggleLoop();
      if (e.key === 'm') nextControls?.muteDeck?.('A');
      if (e.key === '[') nextControls?.pitchDeck?.('A', -0.01);
      if (e.key === ']') nextControls?.pitchDeck?.('A', 0.01);
      if (e.key === '1') deckA?.triggerHotCue(0);
      if (e.key === '2') deckA?.triggerHotCue(1);
      if (e.key === '3') deckA?.triggerHotCue(2);
      if (e.key === '4') deckA?.triggerHotCue(3);

      // Deck B Controls
      if (e.key === 'p') deckB?.togglePlay();
      if (e.key === 'k') deckB?.toggleLoop();
      if (e.key === 'n') nextControls?.muteDeck?.('B');
      if (e.key === ';') nextControls?.pitchDeck?.('B', -0.01);
      if (e.key === "'") nextControls?.pitchDeck?.('B', 0.01);
      if (e.key === '7') deckB?.triggerHotCue(0);
      if (e.key === '8') deckB?.triggerHotCue(1);
      if (e.key === '9') deckB?.triggerHotCue(2);
      if (e.key === '0') deckB?.triggerHotCue(3);

      // Mixer
      if (e.key === 'r') nextControls?.resetEq?.();

      // Crossfader
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onCrossfaderChangeRef.current(Math.max(-1, crossfaderRef.current - 0.1));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onCrossfaderChangeRef.current(Math.min(1, crossfaderRef.current + 0.1));
      }
      if (e.key === ' ') {
        e.preventDefault();
        onCrossfaderChangeRef.current(0);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);
};
