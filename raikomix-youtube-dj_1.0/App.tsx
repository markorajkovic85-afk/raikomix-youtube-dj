import React, { Component, useState, useCallback, useEffect, useRef, Suspense, ReactNode } from 'react';
import Deck, { DeckHandle } from './components/Deck';
import Mixer from './components/Mixer';
import LibraryPanel from './components/LibraryPanel';
import QueuePanel from './components/QueuePanel';
import SearchPanel from './components/SearchPanel';
import Toast, { ToastType } from './components/Toast';
import { PlayerState, DeckId, CrossfaderCurve, QueueItem, LibraryTrack, YouTubeSearchResult, TrackSourceType, EffectType } from './types';
import {
  loadLibrary,
  saveLibrary,
  addTrackToLibrary,
  removeFromLibrary,
  incrementPlayCount,
  updateTrackMetadata
} from './utils/libraryStorage';
import EffectsPanel from './components/EffectsPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// FIX: Explicitly using Component from named imports and providing constructor to ensure props are correctly initialized and recognized by the compiler
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState { 
    return { hasError: true }; 
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  public render() {
    const { hasError } = this.state;
    // Destructuring children from this.props; typing is now correctly inherited from the Component base class
    const { children } = this.props;

    if (hasError) return (
      <div className="h-screen bg-black flex items-center justify-center text-[#D0BCFF] p-10 text-center">
        <div className="max-w-md">
          <h1 className="text-4xl font-black mb-4 uppercase tracking-tighter">System Critical</h1>
          <p className="mb-6 opacity-60">The DJ Engine encountered a memory fault. Re-initializing the console.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-10 py-4 bg-[#D0BCFF] text-black font-black rounded-full hover:bg-white transition-all shadow-[0_0_20px_rgba(208,188,255,0.4)]"
          >
            REBOOT CONSOLE
          </button>
        </div>
      </div>
    );
    return children;
  }
}

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<'PERFORM' | 'LIBRARY'>('LIBRARY');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [queueOpen, setQueueOpen] = useState(true);
  const [library, setLibrary] = useState<LibraryTrack[]>(() => loadLibrary());
  const [deckAState, setDeckAState] = useState<PlayerState | null>(null);
  const [deckBState, setDeckBState] = useState<PlayerState | null>(null);
  const [masterPlayerA, setMasterPlayerA] = useState<any>(null);
  const [masterPlayerB, setMasterPlayerB] = useState<any>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [crossfader, setCrossfader] = useState(0);
  const [xFaderCurve, setXFaderCurve] = useState<CrossfaderCurve>('SMOOTH');
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [deckAVolume, setDeckAVolume] = useState(0.8);
  const [deckBVolume, setDeckBVolume] = useState(0.8);
  const [autoDjEnabled, setAutoDjEnabled] = useState(false);
  const [mixLeadSeconds, setMixLeadSeconds] = useState(12);
  const [mixDurationSeconds, setMixDurationSeconds] = useState(6);
  const [pendingMix, setPendingMix] = useState<{ deck: DeckId; fromDeck: DeckId; item: QueueItem } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState<{ msg: string, type: ToastType } | null>(null);
  const [deckAEffect, setDeckAEffect] = useState<EffectType | null>(null);
  const [deckAEffectWet, setDeckAEffectWet] = useState(0.5);
  const [deckAEffectIntensity, setDeckAEffectIntensity] = useState(0.5);
  const [deckBEffect, setDeckBEffect] = useState<EffectType | null>(null);
  const [deckBEffectWet, setDeckBEffectWet] = useState(0.5);
  const [deckBEffectIntensity, setDeckBEffectIntensity] = useState(0.5);
  const [padEffect, setPadEffect] = useState<EffectType | null>(null);
  const [padEffectWet, setPadEffectWet] = useState(0.5);
  const [padEffectIntensity, setPadEffectIntensity] = useState(0.5);
  const [fxTarget, setFxTarget] = useState<'A' | 'B' | 'AB' | 'PADS'>('A');

  const [deckAEq, setDeckAEq] = useState({ hi: 1, mid: 1, low: 1, filter: 0 });
  const [deckBEq, setDeckBEq] = useState({ hi: 1, mid: 1, low: 1, filter: 0 });

  const deckARef = useRef<DeckHandle>(null);
  const deckBRef = useRef<DeckHandle>(null);
  const mixAnimationRef = useRef<number | null>(null);
  const mixInProgressRef = useRef(false);
  const pendingMixRef = useRef<{ deck: DeckId; fromDeck: DeckId; item: QueueItem } | null>(null);
  const lastAutoDeckRef = useRef<DeckId>('B');
  const autoLoadDeckRef = useRef<DeckId | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => { saveLibrary(library); }, [library]);

  const showNotification = (msg: string, type: ToastType = 'info') => setToast({ msg, type });

  const getActiveDeck = useCallback(() => {
    if (deckAState?.playing && !deckBState?.playing) return 'A';
    if (deckBState?.playing && !deckAState?.playing) return 'B';
    if (deckAState?.playing && deckBState?.playing) return crossfader >= 0 ? 'B' : 'A';
    return null;
  }, [deckAState?.playing, deckBState?.playing, crossfader]);

  const handleDeckStateUpdate = useCallback((id: DeckId, state: PlayerState) => {
    id === 'A' ? setDeckAState(state) : setDeckBState(state);
    if (state.playing && autoLoadDeckRef.current === id) {
      autoLoadDeckRef.current = null;
    }
    if (state.isReady && state.title && state.videoId && state.sourceType === 'youtube') {
      setLibrary(prev => updateTrackMetadata(state.videoId, { title: state.title, author: state.author }, prev));
    }
  }, []);

  const handleLoadVideo = useCallback((
    videoId: string,
    url: string,
    deck: DeckId,
    sourceType: TrackSourceType = 'youtube',
    title?: string,
    author?: string,
    mode: 'load' | 'cue' = 'load'
  ) => {
    const ref = deck === 'A' ? deckARef : deckBRef;
    if (ref.current) {
      if (mode === 'cue') {
        ref.current.cueVideo(url, sourceType, { title, author });
      } else {
        ref.current.loadVideo(url, sourceType, { title, author });
      }
      setLibrary(prev => incrementPlayCount(videoId, prev));
      showNotification(`${sourceType === 'local' ? 'File' : 'Stream'} ${mode === 'cue' ? 'Queued' : 'Loaded'} to Deck ${deck}`, 'success');
    }
  }, []);

  const handleAddToQueue = useCallback((track: LibraryTrack | YouTubeSearchResult) => {
    const item: QueueItem = {
      id: `${Date.now()}_${track.videoId}`,
      videoId: track.videoId,
      url: 'addedAt' in track ? track.url : `https://www.youtube.com/watch?v=${track.videoId}`,
      title: track.title,
      thumbnailUrl: track.thumbnailUrl,
      addedAt: Date.now(),
      author: 'addedAt' in track ? track.author : (track as YouTubeSearchResult).channelTitle,
      sourceType: 'sourceType' in track ? track.sourceType : 'youtube'
    };
    setQueue(prev => [...prev, item]);
    showNotification('Added to Queue');
  }, []);

  const stopDeck = useCallback((deckId: DeckId) => {
    const state = deckId === 'A' ? deckAState : deckBState;
    const ref = deckId === 'A' ? deckARef : deckBRef;
    if (state?.playing) {
      ref.current?.togglePlay();
    }
  }, [deckAState, deckBState]);

  const startAutoMix = useCallback((fromDeck: DeckId, targetDeck: DeckId) => {
    if (mixInProgressRef.current) return;
    mixInProgressRef.current = true;
    const fromValue = crossfader;
    const targetValue = targetDeck === 'A' ? -1 : 1;
    const durationMs = Math.max(1, mixDurationSeconds) * 1000;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = t * t * (3 - 2 * t);
      setCrossfader(fromValue + (targetValue - fromValue) * eased);
      if (t < 1) {
        mixAnimationRef.current = requestAnimationFrame(step);
      } else {
        mixInProgressRef.current = false;
        mixAnimationRef.current = null;
        stopDeck(fromDeck);
      }
    };
    mixAnimationRef.current = requestAnimationFrame(step);
  }, [crossfader, mixDurationSeconds, stopDeck]);

  const loadNextQueueItem = useCallback((targetDeck: DeckId, mode: 'load' | 'cue' = 'load') => {
    const nextItem = queue[0];
    if (!nextItem) return null;
    handleLoadVideo(nextItem.videoId, nextItem.url, targetDeck, nextItem.sourceType || 'youtube', nextItem.title, nextItem.author, mode);
    setQueue(prev => prev.filter(item => item.id !== nextItem.id));
    lastAutoDeckRef.current = targetDeck;
    return nextItem;
  }, [queue, handleLoadVideo]);

  const triggerDeckPlay = useCallback((deck: DeckId) => {
    const ref = deck === 'A' ? deckARef : deckBRef;
    setTimeout(() => ref.current?.togglePlay(), 0);
  }, []);

  const queueAutoMix = useCallback((fromDeck: DeckId) => {
    if (mixInProgressRef.current || pendingMixRef.current) return;
    const targetDeck = fromDeck === 'A' ? 'B' : 'A';
    const targetState = targetDeck === 'A' ? deckAState : deckBState;
    if (targetState?.playing) return;
    const nextItem = loadNextQueueItem(targetDeck, 'load');
    if (!nextItem) return;
    const pending = { deck: targetDeck, fromDeck, item: nextItem };
    pendingMixRef.current = pending;
    setPendingMix(pending);
  }, [deckAState, deckBState, loadNextQueueItem]);

  const handleTrackEnd = useCallback((deckId: DeckId) => {
    if (!autoDjEnabled) return;
    queueAutoMix(deckId);
  }, [autoDjEnabled, queueAutoMix]);

  const handleMixLeadChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setMixLeadSeconds(Math.min(30, Math.max(4, value)));
  }, []);

  const handleMixDurationChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setMixDurationSeconds(Math.min(20, Math.max(2, value)));
  }, []);

  const muteDeck = (id: 'A' | 'B') => {
    if (id === 'A') setDeckAVolume(prev => prev > 0 ? 0 : 0.8);
    else setDeckBVolume(prev => prev > 0 ? 0 : 0.8);
  };

  const pitchDeck = (id: 'A' | 'B', delta: number) => {
    const ref = id === 'A' ? deckARef : deckBRef;
    const currentState = id === 'A' ? deckAState : deckBState;
    if (ref.current && currentState) {
      ref.current.setPlaybackRate(currentState.playbackRate + delta);
    }
  };

  const resetEq = () => {
    setDeckAEq({ hi: 1, mid: 1, low: 1, filter: 0 });
    setDeckBEq({ hi: 1, mid: 1, low: 1, filter: 0 });
    showNotification('EQs Reset', 'info');
  };

  const toggleEffect = (deck: 'A' | 'B', effect: EffectType | null) => {
    if (deck === 'A') {
      setDeckAEffect(prev => (prev === effect ? null : effect));
    } else {
      setDeckBEffect(prev => (prev === effect ? null : effect));
    }
  };

  const togglePadEffect = (effect: EffectType | null) => {
    setPadEffect(prev => (prev === effect ? null : effect));
  };

  const targetEffect = fxTarget === 'A'
    ? deckAEffect
    : fxTarget === 'B'
      ? deckBEffect
      : fxTarget === 'PADS'
        ? padEffect
        : deckAEffect === deckBEffect
          ? deckAEffect
          : null;
  const targetWet = fxTarget === 'A'
    ? deckAEffectWet
    : fxTarget === 'B'
      ? deckBEffectWet
      : fxTarget === 'PADS'
        ? padEffectWet
        : (deckAEffectWet + deckBEffectWet) / 2;
  const targetIntensity = fxTarget === 'A'
    ? deckAEffectIntensity
    : fxTarget === 'B'
      ? deckBEffectIntensity
      : fxTarget === 'PADS'
        ? padEffectIntensity
        : (deckAEffectIntensity + deckBEffectIntensity) / 2;
  const isMixedEffect = fxTarget === 'AB' && deckAEffect !== deckBEffect;
  const isMixedWet = fxTarget === 'AB' && Math.abs(deckAEffectWet - deckBEffectWet) > 0.01;
  const isMixedIntensity = fxTarget === 'AB' && Math.abs(deckAEffectIntensity - deckBEffectIntensity) > 0.01;
  const targetColor = fxTarget === 'A' ? '#D0BCFF' : fxTarget === 'B' ? '#F2B8B5' : fxTarget === 'PADS' ? '#B0E3D3' : '#E5D0F7';
  const streamingNotice = fxTarget === 'A'
    ? deckAState?.sourceType === 'youtube'
    : fxTarget === 'B'
      ? deckBState?.sourceType === 'youtube'
      : fxTarget === 'PADS'
        ? false
        : deckAState?.sourceType === 'youtube' || deckBState?.sourceType === 'youtube';

  const handleRemoveMultiple = useCallback((ids: string[]) => {
    setLibrary(prev => prev.filter(track => !ids.includes(track.id)));
    showNotification(`Removed ${ids.length} items from Library`);
  }, []);

  useKeyboardShortcuts(deckARef, deckBRef, crossfader, setCrossfader, () => setShowHelp(p => !p), {
    muteDeck, pitchDeck, resetEq
  });

  useEffect(() => {
    if (!autoDjEnabled) return;
    const interval = setInterval(() => {
      if (mixInProgressRef.current || pendingMixRef.current || queue.length === 0) return;
      const deckAPlaying = deckAState?.playing || false;
      const deckBPlaying = deckBState?.playing || false;
      if (!deckAPlaying && !deckBPlaying) {
        if (autoLoadDeckRef.current) return;
        const nextDeck = lastAutoDeckRef.current === 'A' ? 'B' : 'A';
        const nextItem = loadNextQueueItem(nextDeck, 'load');
        if (!nextItem) {
          autoLoadDeckRef.current = null;
          return;
        }
        autoLoadDeckRef.current = nextDeck;
        setCrossfader(nextDeck === 'A' ? -1 : 1);
        triggerDeckPlay(nextDeck);
        return;
      }
      const activeDeck = getActiveDeck();
      if (!activeDeck) return;
      const activeState = activeDeck === 'A' ? deckAState : deckBState;
      if (!activeState?.duration || !activeState.isReady) return;
      const remaining = activeState.duration - activeState.currentTime;
      if (remaining <= mixLeadSeconds) {
        queueAutoMix(activeDeck);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [autoDjEnabled, queue, deckAState, deckBState, mixLeadSeconds, getActiveDeck, loadNextQueueItem, triggerDeckPlay, queueAutoMix]);

  useEffect(() => {
    if (autoDjEnabled) return;
    pendingMixRef.current = null;
    autoLoadDeckRef.current = null;
    setPendingMix(null);
  }, [autoDjEnabled]);

  useEffect(() => {
    if (!pendingMix) return;
    const targetState = pendingMix.deck === 'A' ? deckAState : deckBState;
    const targetRef = pendingMix.deck === 'A' ? deckARef : deckBRef;
    if (!targetState?.isReady) return;
    if (!targetState.playing) {
      targetRef.current?.togglePlay();
    }
    startAutoMix(pendingMix.fromDeck, pendingMix.deck);
    pendingMixRef.current = null;
    setPendingMix(null);
  }, [pendingMix, deckAState, deckBState, startAutoMix]);

useEffect(() => {
    if (!autoDjEnabled || !autoLoadDeckRef.current) return;
    const autoDeck = autoLoadDeckRef.current;
    const targetState = autoDeck === 'A' ? deckAState : deckBState;
    const targetRef = autoDeck === 'A' ? deckARef : deckBRef;
    if (!targetState?.isReady || targetState.playing) return;
    targetRef.current?.togglePlay();
  }, [autoDjEnabled, deckAState, deckBState]);
  
  useEffect(() => {
    return () => {
      if (mixAnimationRef.current) cancelAnimationFrame(mixAnimationRef.current);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      [{ p: masterPlayerA, bv: deckAVolume, id: 'A' }, { p: masterPlayerB, bv: deckBVolume, id: 'B' }].forEach(({ p, bv, id }) => {
        if (!p || typeof p.setVolume !== 'function') return;
        const t = (crossfader + 1) / 2;
        let gain = id === 'A' ? (xFaderCurve === 'CUT' ? (t > 0.9 ? 0 : 1) : Math.cos((t * Math.PI) / 2)) : (xFaderCurve === 'CUT' ? (t < 0.1 ? 0 : 1) : Math.sin((t * Math.PI) / 2));
        try { p.setVolume(Math.round(bv * masterVolume * gain * 100)); } catch (e) {}
      });
    }, 50);
    return () => clearInterval(interval);
  }, [crossfader, xFaderCurve, masterVolume, deckAVolume, deckBVolume, masterPlayerA, masterPlayerB]);

  return (
    <ErrorBoundary>
       <div className="h-screen bg-[#1C1B1F] text-white flex overflow-hidden font-['Roboto']" data-theme={theme}>
        <nav className="w-16 bg-black/40 border-r border-white/5 flex flex-col items-center py-8 gap-10 shrink-0">
          <button onClick={() => setViewMode('PERFORM')} className={`flex flex-col items-center gap-1 transition-all ${viewMode === 'PERFORM' ? 'text-[#D0BCFF] scale-110' : 'text-gray-600 hover:text-gray-400'}`}>
            <span className="material-icons text-3xl">speed</span>
            <span className="text-[7px] font-black uppercase tracking-widest">Perform</span>
          </button>
          <button onClick={() => setViewMode('LIBRARY')} className={`flex flex-col items-center gap-1 transition-all ${viewMode === 'LIBRARY' ? 'text-[#D0BCFF] scale-110' : 'text-gray-600 hover:text-gray-400'}`}>
            <span className="material-icons text-3xl">grid_view</span>
            <span className="text-[7px] font-black uppercase tracking-widest">Library</span>
          </button>
          <div className="flex flex-col gap-4 mt-auto">
            <button onClick={() => setLibraryOpen(!libraryOpen)} className={`text-gray-600 hover:text-white transition-transform ${libraryOpen ? '' : 'rotate-180'}`} title="Toggle Library">
              <span className="material-icons">chevron_left</span>
            </button>
            <button onClick={() => setQueueOpen(!queueOpen)} className={`text-gray-600 hover:text-white transition-transform ${queueOpen ? '' : 'rotate-180'}`} title="Toggle Queue">
              <span className="material-icons">playlist_play</span>
            </button>
            <button onClick={toggleTheme} className="text-gray-600 hover:text-white"><span className="material-icons">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
          </div>
        </nav>

        <div className="flex-1 flex overflow-hidden relative min-h-0">
             {viewMode === 'LIBRARY' ? (
            <section className={`bg-black/20 border-r border-white/5 overflow-hidden flex flex-col transition-all duration-300 flex-none h-full ${libraryOpen ? 'w-[420px]' : 'w-0 border-none'}`}>
              <div className={`p-4 flex flex-col gap-4 h-full min-w-[380px] min-h-0 ${!libraryOpen ? 'opacity-0' : 'opacity-100 transition-opacity'}`}>
                <SearchPanel 
                  onLoadToDeck={(vid, url, deck, title, author) => handleLoadVideo(vid, url, deck, 'youtube', title, author)} 
                  onAddToQueue={handleAddToQueue} 
                  onAddToLibrary={(result) => {
                    setLibrary(prev => {
                      const res = addTrackToLibrary(`https://www.youtube.com/watch?v=${result.videoId}`, prev);
                      if (res.success && res.track) {
                          showNotification('Added to Library', 'success');
                        const withTrack = [...prev, res.track];
                        return updateTrackMetadata(result.videoId, { title: result.title, author: result.channelTitle }, withTrack);
                      }
                      if (res.error) showNotification(res.error, 'error');
                      return prev;
                    });
                  }} 
                />
               <div className="flex-1 overflow-hidden border-t border-white/5 pt-4 min-h-0">
                  <LibraryPanel 
                    library={library} 
                    onAddSingle={url => {
                      setLibrary(prev => {
                        const res = addTrackToLibrary(url, prev);
                        if (res.success && res.track) {
                          showNotification('Added to Library', 'success');
                          return [...prev, res.track];
                        }
                        if (res.error) showNotification(res.error, 'error');
                        return prev;
                      });
                    }} 
                    onRemove={id => setLibrary(p => removeFromLibrary(id, p))} 
                    onRemoveMultiple={handleRemoveMultiple}
                    onLoadToDeck={(track, deck) => handleLoadVideo(track.videoId, track.url, deck, track.sourceType, track.title, track.author)} 
                    onAddToQueue={handleAddToQueue} 
                    onUpdateMetadata={(v, m) => { setLibrary(updateTrackMetadata(v, m, library)); showNotification('Metadata Saved'); }} 
                    onImportLibrary={setLibrary} 
                  />
                </div> 
              </div>
            </section>
          ) : (
           <section className="bg-black/20 border-r border-white/5 flex flex-col h-full w-[clamp(320px,25vw,420px)] shrink-0 overflow-hidden">
              <div className="p-4 flex flex-col gap-4 h-full min-h-0 overflow-y-auto">
                <EffectsPanel
                   activeEffect={targetEffect}
                  effectAmount={targetWet}
                  effectIntensity={targetIntensity}
                  onEffectToggle={(effect) => {
                    if (fxTarget === 'A') toggleEffect('A', effect);
                    else if (fxTarget === 'B') toggleEffect('B', effect);
                    else if (fxTarget === 'PADS') {
                      togglePadEffect(effect);
                    } else {
                      toggleEffect('A', effect);
                      toggleEffect('B', effect);
                    }
                  }}
                  onAmountChange={(amount) => {
                    if (fxTarget === 'A') setDeckAEffectWet(amount);
                    else if (fxTarget === 'B') setDeckBEffectWet(amount);
                    else if (fxTarget === 'PADS') setPadEffectWet(amount);
                    else {
                      setDeckAEffectWet(amount);
                      setDeckBEffectWet(amount);
                    }
                  }}
                  onIntensityChange={(amount) => {
                    if (fxTarget === 'A') setDeckAEffectIntensity(amount);
                    else if (fxTarget === 'B') setDeckBEffectIntensity(amount);
                    else if (fxTarget === 'PADS') setPadEffectIntensity(amount);
                    else {
                      setDeckAEffectIntensity(amount);
                      setDeckBEffectIntensity(amount);
                    }
                  }}
                  color={targetColor}
                  target={fxTarget}
                  onTargetChange={setFxTarget}
                  mixedEffect={isMixedEffect}
                  mixedAmount={isMixedWet}
                  mixedIntensity={isMixedIntensity}
                  showStreamingNotice={streamingNotice}
                  masterVolume={masterVolume}
                  padEffect={padEffect}
                  padEffectWet={padEffectWet}
                  padEffectIntensity={padEffectIntensity}
                  onNotify={showNotification}
                />
              </div>
            </section>
          )}

          <section className="flex-1 flex flex-col items-center justify-center overflow-auto min-h-0 perform-stage">
            <div className="flex flex-col lg:flex-row items-center perform-stage__inner">
             <Deck ref={deckARef} id="A" color="#D0BCFF" eq={deckAEq} effect={deckAEffect} effectWet={deckAEffectWet} effectIntensity={deckAEffectIntensity} onStateUpdate={s => handleDeckStateUpdate('A', s)} onPlayerReady={p => setMasterPlayerA(p)} onTrackEnd={() => handleTrackEnd('A')} />
            <Mixer
                crossfader={crossfader}
                onCrossfaderChange={setCrossfader}
                crossfaderCurve={xFaderCurve}
                onCurveChange={setXFaderCurve}
                masterVolume={masterVolume}
                onMasterVolumeChange={setMasterVolume}
                deckAVolume={deckAVolume}
                onDeckAVolumeChange={setDeckAVolume}
                deckBVolume={deckBVolume}
                onDeckBVolumeChange={setDeckBVolume}
                deckAPlaying={deckAState?.playing || false}
                deckBPlaying={deckBState?.playing || false}
                deckATrim={deckAEffectWet}
                deckBTrim={deckBEffectWet}
                onDeckATrimChange={setDeckAEffectWet}
                onDeckBTrimChange={setDeckBEffectWet}
                deckAEq={deckAEq}
                deckBEq={deckBEq}
                onDeckAEqChange={(k, v) => setDeckAEq(p => ({...p, [k]: v}))}
                onDeckBEqChange={(k, v) => setDeckBEq(p => ({...p, [k]: v}))}
              />
                 <Deck ref={deckBRef} id="B" color="#F2B8B5" eq={deckBEq} effect={deckBEffect} effectWet={deckBEffectWet} effectIntensity={deckBEffectIntensity} onStateUpdate={s => handleDeckStateUpdate('B', s)} onPlayerReady={p => setMasterPlayerB(p)} onTrackEnd={() => handleTrackEnd('B')} />
            </div>
          </section>

             {viewMode === 'LIBRARY' && (
            <>
              <aside className={`bg-black/10 flex-none border-l border-white/5 flex flex-col transition-all duration-300 overflow-hidden ${queueOpen ? 'w-80 p-4' : 'w-0 p-0 border-none'}`}>
                <div className={`h-full min-w-[280px] ${!queueOpen ? 'opacity-0 invisible' : 'opacity-100 visible transition-opacity'}`}>
                  <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2">
                    <span className="text-[10px] font-black uppercase text-gray-500 tracking-[0.2em]">Queue Console</span>
                    <button onClick={() => setQueueOpen(false)} className="text-gray-500 hover:text-white"><span className="material-symbols-outlined text-sm">close</span></button>
                  </div>
                  <QueuePanel 
                    queue={queue} 
                    autoDjEnabled={autoDjEnabled}
                    mixLeadSeconds={mixLeadSeconds}
                    mixDurationSeconds={mixDurationSeconds}
                    onToggleAutoDj={() => setAutoDjEnabled(prev => !prev)}
                    onMixLeadChange={handleMixLeadChange}
                    onMixDurationChange={handleMixDurationChange}
                    onLoadToDeck={(i, d) => { handleLoadVideo(i.videoId, i.url, d, i.sourceType || 'youtube', i.title, i.author); setQueue(p => p.filter(q => q.id !== i.id)); }} 
                    onRemove={id => setQueue(p => p.filter(i => i.id !== id))} 
                    onClear={() => setQueue([])} 
                    onReorder={() => {}} 
                  />
                </div>
              </aside>
              
              {!queueOpen && (
                <button 
                  onClick={() => setQueueOpen(true)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 bg-[#D0BCFF] text-black w-8 h-20 rounded-l-xl flex items-center justify-center z-50 shadow-xl hover:w-10 transition-all"
                >
                  <span className="material-icons rotate-180">chevron_left</span>
                </button>
              )}
            </>
          )}
        </div>

        {showHelp && (
          <div className="fixed inset-0 z-[4000] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6" onClick={() => setShowHelp(false)}>
            <div className="m3-card bg-[#1D1B20] p-12 max-w-2xl w-full border-[#D0BCFF]/30 shadow-[0_0_100px_rgba(208,188,255,0.15)]">
               <div className="flex justify-between items-center mb-10">
                 <h2 className="text-3xl font-black text-[#D0BCFF] tracking-[0.3em] uppercase">Shortcut Engine</h2>
                 <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest border border-white/10 px-3 py-1 rounded-full">Pro Mode Active</span>
               </div>
               <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm">
                  <div>
                    <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">Deck A (Left)</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">PLAY/PAUSE / CUE</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-[#D0BCFF]">Q / 1-4</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">LOOP / MUTE</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-[#D0BCFF]">S / M</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">PITCH +/-</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-[#D0BCFF]">[ / ]</span></div>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">Deck B (Right)</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">PLAY/PAUSE / CUE</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-[#F2B8B5]">P / 7-0</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">LOOP / MUTE</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-[#F2B8B5]">K / N</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">PITCH +/-</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-[#F2B8B5]">; / '</span></div>
                    </div>
                  </div>
                  <div className="col-span-2 pt-4">
                    <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">Global Mixer</h3>
                    <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">CROSSFADER</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-white">← / →</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">RESET EQs</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-white">R</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">CENTER X-FADER</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-white">Space</span></div>
                      <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-400">KNOB FINE-TUNE</span><span className="bg-white/10 px-3 py-1 rounded-lg mono text-white">Wheel</span></div>
                    </div>
                  </div>
               </div>
               <button onClick={() => setShowHelp(false)} className="w-full mt-12 py-5 bg-[#D0BCFF] text-black font-black rounded-2xl tracking-[0.5em] hover:bg-white transition-all">RESUME PERFORMANCE</button>
            </div>
          </div>
        )}
        
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </ErrorBoundary>
  );
};

export default App;
