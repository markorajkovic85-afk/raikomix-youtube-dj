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
  updateTrackMetadata,
  revokeLocalTrackUrls
} from './utils/libraryStorage';
import { makeId } from './utils/id';
import EffectsPanel from './components/EffectsPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useFitCentralStage } from './hooks/useFitCentralStage';

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

// ========================================
// TRANSACTION STATE MACHINE (P0-1 FIX)
// ========================================

/**
 * Unified transaction state for Auto DJ transitions.
 * Replaces separate preloadedTrackRef/earlyStartedTrackRef to prevent race conditions.
 */
interface TransitionTransaction {
  id: string;                    // Unique transaction ID
  state: 'PRELOADING' | 'READY' | 'PLAYING' | 'MIXING';
  targetDeck: DeckId;           // Deck receiving new track
  sourceDeck: DeckId;           // Deck currently playing
  queueItem: QueueItem;         // Track being loaded
  startedAt: number;            // Timestamp for timeout detection
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
  const libraryRef = useRef(library);
  const lastAutoDeckRef = useRef<DeckId>('B');
  const autoLoadDeckRef = useRef<DeckId | null>(null);
  const lastMixVideoRef = useRef<{ A?: string | null; B?: string | null }>({});
  
  // REPLACED: preloadedTrackRef, earlyStartedTrackRef → activeTransactionRef
  const activeTransactionRef = useRef<TransitionTransaction | null>(null);
  
  const manualPauseRef = useRef<{ A: boolean; B: boolean }>({ A: false, B: false });
  const prevPlayingRef = useRef<{ A: boolean; B: boolean }>({ A: false, B: false });
  const autoStopRef = useRef<{ A: boolean; B: boolean }>({ A: false, B: false });
  const masterGainA = useRef<GainNode | null>(null);
  const masterGainB = useRef<GainNode | null>(null);
  
  // Scaling system refs - properly typed for the hook
  const centralStageContainerRef = useRef<HTMLDivElement>(null);
  const centralStagePanelRef = useRef<HTMLDivElement>(null);
  
  const { theme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  
  // Apply dynamic scaling hook with updated base dimensions matching index.html
  const centralStageScale = useFitCentralStage(centralStageContainerRef, centralStagePanelRef, {
    baseWidth: 1040,   // 380 + 20 + 224 + 20 + 380 + 36 (padding)
    baseHeight: 720,   // Natural height at comfortable density
    minScale: 0.72,    // Minimum usable scale
    maxScale: 1.0,     // No enlargement beyond design size
    padding: 32        // Breathing room
  });
  
  const defaultKeyboardMappings = [
    { action: 'Deck A: Play/Pause', keys: 'Q', detail: 'Toggle deck A playback' },
    { action: 'Deck A: Loop', keys: 'S', detail: 'Enable/disable loop' },
    { action: 'Deck A: Mute', keys: 'M', detail: 'Toggle deck A mute' },
    { action: 'Deck A: Pitch -', keys: '[', detail: 'Pitch down' },
    { action: 'Deck A: Pitch +', keys: ']', detail: 'Pitch up' },
    { action: 'Deck A: Hot Cues 1-4', keys: '1 2 3 4', detail: 'Trigger hot cues' },
    { action: 'Deck B: Play/Pause', keys: 'P', detail: 'Toggle deck B playback' },
    { action: 'Deck B: Loop', keys: 'K', detail: 'Enable/disable loop' },
    { action: 'Deck B: Mute', keys: 'N', detail: 'Toggle deck B mute' },
    { action: 'Deck B: Pitch -', keys: ';', detail: 'Pitch down' },
    { action: 'Deck B: Pitch +', keys: "'", detail: 'Pitch up' },
    { action: 'Deck B: Hot Cues 1-4', keys: '7 8 9 0', detail: 'Trigger hot cues' },
    { action: 'Crossfader', keys: '← / →', detail: 'Move crossfader left/right' },
    { action: 'Crossfader Center', keys: 'Space', detail: 'Snap to center' },
    { action: 'Reset EQ', keys: 'R', detail: 'Reset EQ to neutral' },
    { action: 'Help Overlay', keys: '? / /', detail: 'Toggle help overlay' }
  ];
  const defaultMidiMappings = [
    { group: 'Mixer', action: 'Crossfader', channel: '1', control: 'CC 8', detail: 'Full-range crossfader' },
    { group: 'Mixer', action: 'Crossfader Curve', channel: '1', control: 'Notes 20-22', detail: 'Smooth/Cut/Dip select' },
    { group: 'Mixer', action: 'Deck A Volume', channel: '1', control: 'CC 12', detail: 'Channel fader A' },
    { group: 'Mixer', action: 'Deck B Volume', channel: '1', control: 'CC 13', detail: 'Channel fader B' },
    { group: 'Mixer', action: 'Master Volume', channel: '1', control: 'CC 14', detail: 'Master output' },
    { group: 'Mixer', action: 'Deck A Trim', channel: '1', control: 'CC 16', detail: 'Input gain A' },
    { group: 'Mixer', action: 'Deck B Trim', channel: '1', control: 'CC 17', detail: 'Input gain B' },
    { group: 'Mixer', action: 'Deck A EQ High', channel: '1', control: 'CC 20', detail: 'High shelf A' },
    { group: 'Mixer', action: 'Deck A EQ Mid', channel: '1', control: 'CC 21', detail: 'Mid peaking A' },
    { group: 'Mixer', action: 'Deck A EQ Low', channel: '1', control: 'CC 22', detail: 'Low shelf A' },
    { group: 'Mixer', action: 'Deck A Filter', channel: '1', control: 'CC 23', detail: 'Color filter A' },
    { group: 'Mixer', action: 'Deck B EQ High', channel: '1', control: 'CC 24', detail: 'High shelf B' },
    { group: 'Mixer', action: 'Deck B EQ Mid', channel: '1', control: 'CC 25', detail: 'Mid peaking B' },
    { group: 'Mixer', action: 'Deck B EQ Low', channel: '1', control: 'CC 26', detail: 'Low shelf B' },
    { group: 'Mixer', action: 'Deck B Filter', channel: '1', control: 'CC 27', detail: 'Color filter B' },
    { group: 'Mixer', action: 'Auto DJ Toggle', channel: '1', control: 'Note 41', detail: 'Enable/disable Auto DJ' },
    { group: 'Mixer', action: 'Mix Lead Time', channel: '1', control: 'CC 30', detail: 'Mix lead seconds' },
    { group: 'Mixer', action: 'Mix Duration', channel: '1', control: 'CC 31', detail: 'Mix duration seconds' },
    { group: 'Deck A', action: 'Deck A Play/Pause', channel: '1', control: 'Note 36', detail: 'Transport A' },
    { group: 'Deck A', action: 'Deck A Tap BPM', channel: '1', control: 'Note 37', detail: 'Tap tempo' },
    { group: 'Deck A', action: 'Deck A Tempo Fader', channel: '1', control: 'CC 40', detail: 'Pitch/tempo control' },
    { group: 'Deck A', action: 'Deck A Pitch Reset', channel: '1', control: 'Note 38', detail: 'Reset tempo to 0%' },
    { group: 'Deck A', action: 'Deck A Hot Cue 1', channel: '1', control: 'Note 48', detail: 'Trigger cue 1' },
    { group: 'Deck A', action: 'Deck A Hot Cue 2', channel: '1', control: 'Note 49', detail: 'Trigger cue 2' },
    { group: 'Deck A', action: 'Deck A Hot Cue 3', channel: '1', control: 'Note 50', detail: 'Trigger cue 3' },
    { group: 'Deck A', action: 'Deck A Hot Cue 4', channel: '1', control: 'Note 51', detail: 'Trigger cue 4' },
    { group: 'Deck A', action: 'Deck A Loop 2', channel: '1', control: 'Note 56', detail: 'Trigger 2-beat loop' },
    { group: 'Deck A', action: 'Deck A Loop 4', channel: '1', control: 'Note 57', detail: 'Trigger 4-beat loop' },
    { group: 'Deck A', action: 'Deck A Loop 8', channel: '1', control: 'Note 58', detail: 'Trigger 8-beat loop' },
    { group: 'Deck A', action: 'Deck A Loop 16', channel: '1', control: 'Note 59', detail: 'Trigger 16-beat loop' },
    { group: 'Effects', action: 'FX Toggle', channel: '1', control: 'Note 40', detail: 'Engage FX' },
    { group: 'Effects', action: 'FX Target A', channel: '1', control: 'Note 60', detail: 'Route FX to deck A' },
    { group: 'Effects', action: 'FX Target B', channel: '1', control: 'Note 61', detail: 'Route FX to deck B' },
    { group: 'Effects', action: 'FX Target A+B', channel: '1', control: 'Note 62', detail: 'Route FX to both decks' },
    { group: 'Effects', action: 'FX Target Pads', channel: '1', control: 'Note 63', detail: 'Route FX to pads' },
    { group: 'Effects', action: 'FX Select Previous', channel: '1', control: 'Note 64', detail: 'Previous effect' },
    { group: 'Effects', action: 'FX Select Next', channel: '1', control: 'Note 65', detail: 'Next effect' },
    { group: 'Effects', action: 'FX Wet/Dry', channel: '1', control: 'CC 70', detail: 'Blend dry vs wet' },
    { group: 'Effects', action: 'FX Intensity', channel: '1', control: 'CC 71', detail: 'Effect depth' },
    { group: 'Effects', action: 'Pad FX Wet/Dry', channel: '1', control: 'CC 72', detail: 'Pads wet/dry' },
    { group: 'Effects', action: 'Pad FX Intensity', channel: '1', control: 'CC 73', detail: 'Pads intensity' },
    { group: 'Pads', action: 'Pad 1 Trigger', channel: '1', control: 'Note 72', detail: 'Fire pad 1' },
    { group: 'Pads', action: 'Pad 2 Trigger', channel: '1', control: 'Note 73', detail: 'Fire pad 2' },
    { group: 'Pads', action: 'Pad 3 Trigger', channel: '1', control: 'Note 74', detail: 'Fire pad 3' },
    { group: 'Pads', action: 'Pad 4 Trigger', channel: '1', control: 'Note 75', detail: 'Fire pad 4' },
    { group: 'Pads', action: 'Pad 5 Trigger', channel: '1', control: 'Note 76', detail: 'Fire pad 5' },
    { group: 'Pads', action: 'Pad 6 Trigger', channel: '1', control: 'Note 77', detail: 'Fire pad 6' },
    { group: 'Pads', action: 'Pad 7 Trigger', channel: '1', control: 'Note 78', detail: 'Fire pad 7' },
    { group: 'Pads', action: 'Pad 8 Trigger', channel: '1', control: 'Note 79', detail: 'Fire pad 8' },
    { group: 'Pads', action: 'Pad 9 Trigger', channel: '1', control: 'Note 80', detail: 'Fire pad 9' },
    { group: 'Pads', action: 'Pad 10 Trigger', channel: '1', control: 'Note 81', detail: 'Fire pad 10' },
    { group: 'Pads', action: 'Pad 11 Trigger', channel: '1', control: 'Note 82', detail: 'Fire pad 11' },
    { group: 'Pads', action: 'Pad 12 Trigger', channel: '1', control: 'Note 83', detail: 'Fire pad 12' }
  ];
  const [keyboardMappings, setKeyboardMappings] = useState(defaultKeyboardMappings);
  const [midiMappings, setMidiMappings] = useState(defaultMidiMappings);
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
  const [midiStatus, setMidiStatus] = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
  const [midiError, setMidiError] = useState<string | null>(null);
  const [lastMidiMessage, setLastMidiMessage] = useState<string | null>(null);
  const [midiLearnIndex, setMidiLearnIndex] = useState<number | null>(null);
  const midiLearnIndexRef = useRef<number | null>(null);
  const midiMappingsRef = useRef(defaultMidiMappings);
  const midiInputHandlersRef = useRef<Map<string, (event: MIDIMessageEvent) => void>>(new Map());
  const lastEffectRef = useRef<{ A: EffectType | null; B: EffectType | null; PADS: EffectType | null }>({
    A: null,
    B: null,
    PADS: null,
  });

  const updateKeyboardMapping = (index: number, value: string) => {
    setKeyboardMappings(prev => prev.map((item, i) => (i === index ? { ...item, keys: value } : item)));
  };

  const updateMidiMapping = (index: number, field: 'channel' | 'control', value: string) => {
    setMidiMappings(prev => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  useEffect(() => { saveLibrary(library); }, [library]);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);
  useEffect(() => {
    midiLearnIndexRef.current = midiLearnIndex;
  }, [midiLearnIndex]);
  useEffect(() => {
    midiMappingsRef.current = midiMappings;
  }, [midiMappings]);
  useEffect(() => {
    if (deckAEffect) lastEffectRef.current.A = deckAEffect;
  }, [deckAEffect]);
  useEffect(() => {
    if (deckBEffect) lastEffectRef.current.B = deckBEffect;
  }, [deckBEffect]);
  useEffect(() => {
    if (padEffect) lastEffectRef.current.PADS = padEffect;
  }, [padEffect]);

  useEffect(() => {
    return () => {
      revokeLocalTrackUrls(libraryRef.current);
    };
  }, []);

  const showNotification = (msg: string, type: ToastType = 'info') => setToast({ msg, type });
  const effectCycle: EffectType[] = [
    'HIGH_PASS',
    'LOW_PASS',
    'BAND_PASS',
    'ECHO',
    'DELAY',
    'REVERB',
    'FLANGER',
    'PHASER',
    'CHORUS',
    'TREMOLO',
    'AUTO_PAN',
    'CRUSH',
    'BITCRUSH',
    'OVERDRIVE',
    'FILTER_SWEEP',
    'GATE',
  ];

  const handleMixLeadChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setMixLeadSeconds(Math.min(30, Math.max(4, value)));
  }, []);

  const handleMixDurationChange = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setMixDurationSeconds(Math.min(20, Math.max(2, value)));
  }, []);

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

  const formatMidiMessage = (event: MIDIMessageEvent) => {
    const [status, data1, data2] = event.data;
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (messageType === 0x90 && data2 > 0) {
      return `Note ${data1} • Ch ${channel}`;
    }
    if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
      return `Note Off ${data1} • Ch ${channel}`;
    }
    if (messageType === 0xb0) {
      return `CC ${data1} (${data2}) • Ch ${channel}`;
    }
    if (messageType === 0xe0) {
      const value = ((data2 ?? 0) << 7) + (data1 ?? 0);
      return `Pitch ${value} • Ch ${channel}`;
    }
    return `MIDI ${status?.toString(16).toUpperCase()} ${data1 ?? ''} ${data2 ?? ''} • Ch ${channel}`;
  };

  const extractMappingFromMessage = (event: MIDIMessageEvent) => {
    const [status, data1, data2] = event.data;
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (messageType === 0xb0) {
      return { channel: String(channel), control: `CC ${data1}` };
    }
    if (messageType === 0x90 && data2 > 0) {
      return { channel: String(channel), control: `Note ${data1}` };
    }
    if (messageType === 0x80) {
      return { channel: String(channel), control: `Note ${data1}` };
    }
    return null;
  };

  const parseMidiControl = (control: string) => {
    const trimmed = control.trim();
    const ccMatch = /^CC\s*(\d+)/i.exec(trimmed);
    if (ccMatch) return { type: 'cc' as const, value: Number(ccMatch[1]) };
    const noteRangeMatch = /^Notes?\s*(\d+)\s*-\s*(\d+)/i.exec(trimmed);
    if (noteRangeMatch) {
      return { type: 'note-range' as const, start: Number(noteRangeMatch[1]), end: Number(noteRangeMatch[2]) };
    }
    const noteMatch = /^Note\s*(\d+)/i.exec(trimmed);
    if (noteMatch) return { type: 'note' as const, value: Number(noteMatch[1]) };
    return null;
  };

  const toMidiRange = (value: number, min: number, max: number) => min + (value / 127) * (max - min);

  const applyEffectToTarget = (effect: EffectType | null) => {
    if (fxTarget === 'A') toggleEffect('A', effect);
    else if (fxTarget === 'B') toggleEffect('B', effect);
    else if (fxTarget === 'PADS') {
      togglePadEffect(effect);
    } else {
      toggleEffect('A', effect);
      toggleEffect('B', effect);
    }
  };

  const handleMidiAction = useCallback((action: string, data1: number, data2: number) => {
    const velocity = data2 ?? 0;
    const isNoteOn = velocity > 0;
    const normalizedValue = Math.max(0, Math.min(127, data2 ?? 0));
    switch (action) {
      case 'Crossfader':
        setCrossfader(toMidiRange(normalizedValue, -1, 1));
        return;
      case 'Crossfader Curve':
        if (!isNoteOn) return;
        if (data1 === 20) setXFaderCurve('SMOOTH');
        if (data1 === 21) setXFaderCurve('CUT');
        if (data1 === 22) setXFaderCurve('DIP');
        return;
      case 'Deck A Volume':
        setDeckAVolume(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Deck B Volume':
        setDeckBVolume(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Master Volume':
        setMasterVolume(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Deck A Trim':
        setDeckAEffectWet(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Deck B Trim':
        setDeckBEffectWet(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Deck A EQ High':
        setDeckAEq(prev => ({ ...prev, hi: toMidiRange(normalizedValue, 0, 2) }));
        return;
      case 'Deck A EQ Mid':
        setDeckAEq(prev => ({ ...prev, mid: toMidiRange(normalizedValue, 0, 2) }));
        return;
      case 'Deck A EQ Low':
        setDeckAEq(prev => ({ ...prev, low: toMidiRange(normalizedValue, 0, 2) }));
        return;
      case 'Deck A Filter':
        setDeckAEq(prev => ({ ...prev, filter: toMidiRange(normalizedValue, -1, 1) }));
        return;
      case 'Deck B EQ High':
        setDeckBEq(prev => ({ ...prev, hi: toMidiRange(normalizedValue, 0, 2) }));
        return;
      case 'Deck B EQ Mid':
        setDeckBEq(prev => ({ ...prev, mid: toMidiRange(normalizedValue, 0, 2) }));
        return;
      case 'Deck B EQ Low':
        setDeckBEq(prev => ({ ...prev, low: toMidiRange(normalizedValue, 0, 2) }));
        return;
      case 'Deck B Filter':
        setDeckBEq(prev => ({ ...prev, filter: toMidiRange(normalizedValue, -1, 1) }));
        return;
      case 'Auto DJ Toggle':
        if (isNoteOn) setAutoDjEnabled(prev => !prev);
        return;
      case 'Mix Lead Time':
        handleMixLeadChange(toMidiRange(normalizedValue, 4, 30));
        return;
      case 'Mix Duration':
        handleMixDurationChange(toMidiRange(normalizedValue, 2, 20));
        return;
      case 'Deck A Play/Pause':
        if (isNoteOn) deckARef.current?.togglePlay();
        return;
      case 'Deck A Tap BPM':
        if (isNoteOn) deckARef.current?.tapBpm();
        return;
      case 'Deck A Tempo Fader':
        deckARef.current?.setPlaybackRate(toMidiRange(normalizedValue, 0.5, 1.5));
        return;
      case 'Deck A Pitch Reset':
        if (isNoteOn) deckARef.current?.setPlaybackRate(1);
        return;
      case 'Deck A Hot Cue 1':
        if (isNoteOn) deckARef.current?.triggerHotCue(0);
        return;
      case 'Deck A Hot Cue 2':
        if (isNoteOn) deckARef.current?.triggerHotCue(1);
        return;
      case 'Deck A Hot Cue 3':
        if (isNoteOn) deckARef.current?.triggerHotCue(2);
        return;
      case 'Deck A Hot Cue 4':
        if (isNoteOn) deckARef.current?.triggerHotCue(3);
        return;
      case 'Deck A Loop 2':
        if (isNoteOn) deckARef.current?.toggleLoop(2);
        return;
      case 'Deck A Loop 4':
        if (isNoteOn) deckARef.current?.toggleLoop(4);
        return;
      case 'Deck A Loop 8':
        if (isNoteOn) deckARef.current?.toggleLoop(8);
        return;
      case 'Deck A Loop 16':
        if (isNoteOn) deckARef.current?.toggleLoop(16);
        return;
      case 'FX Toggle': {
        if (!isNoteOn) return;
        if (fxTarget === 'PADS') {
          const next = padEffect ? null : (lastEffectRef.current.PADS ?? effectCycle[0]);
          togglePadEffect(next);
          return;
        }
        if (fxTarget === 'AB') {
          const nextA = deckAEffect ? null : (lastEffectRef.current.A ?? effectCycle[0]);
          const nextB = deckBEffect ? null : (lastEffectRef.current.B ?? effectCycle[0]);
          toggleEffect('A', nextA);
          toggleEffect('B', nextB);
          return;
        }
        const current = fxTarget === 'A' ? deckAEffect : deckBEffect;
        const next = current ? null : (lastEffectRef.current[fxTarget] ?? effectCycle[0]);
        toggleEffect(fxTarget, next);
        return;
      }
      case 'FX Target A':
        if (isNoteOn) setFxTarget('A');
        return;
      case 'FX Target B':
        if (isNoteOn) setFxTarget('B');
        return;
      case 'FX Target A+B':
        if (isNoteOn) setFxTarget('AB');
        return;
      case 'FX Target Pads':
        if (isNoteOn) setFxTarget('PADS');
        return;
      case 'FX Select Previous':
      case 'FX Select Next': {
        if (!isNoteOn) return;
        const direction = action === 'FX Select Next' ? 1 : -1;
        const current = fxTarget === 'A'
          ? deckAEffect
          : fxTarget === 'B'
            ? deckBEffect
            : fxTarget === 'PADS'
              ? padEffect
              : targetEffect;
        const currentIndex = effectCycle.findIndex(effect => effect === current);
        const nextIndex = currentIndex === -1
          ? (direction === 1 ? 0 : effectCycle.length - 1)
          : (currentIndex + direction + effectCycle.length) % effectCycle.length;
        applyEffectToTarget(effectCycle[nextIndex]);
        return;
      }
      case 'FX Wet/Dry': {
        const amount = toMidiRange(normalizedValue, 0, 1);
        if (fxTarget === 'A') setDeckAEffectWet(amount);
        else if (fxTarget === 'B') setDeckBEffectWet(amount);
        else if (fxTarget === 'PADS') setPadEffectWet(amount);
        else {
          setDeckAEffectWet(amount);
          setDeckBEffectWet(amount);
        }
        return;
      }
      case 'FX Intensity': {
        const amount = toMidiRange(normalizedValue, 0, 1);
        if (fxTarget === 'A') setDeckAEffectIntensity(amount);
        else if (fxTarget === 'B') setDeckBEffectIntensity(amount);
        else if (fxTarget === 'PADS') setPadEffectIntensity(amount);
        else {
          setDeckAEffectIntensity(amount);
          setDeckBEffectIntensity(amount);
        }
        return;
      }
      case 'Pad FX Wet/Dry':
        setPadEffectWet(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Pad FX Intensity':
        setPadEffectIntensity(toMidiRange(normalizedValue, 0, 1));
        return;
      case 'Pad 1 Trigger':
      case 'Pad 2 Trigger':
      case 'Pad 3 Trigger':
      case 'Pad 4 Trigger':
      case 'Pad 5 Trigger':
      case 'Pad 6 Trigger':
      case 'Pad 7 Trigger':
      case 'Pad 8 Trigger':
      case 'Pad 9 Trigger':
      case 'Pad 10 Trigger':
      case 'Pad 11 Trigger':
      case 'Pad 12 Trigger': {
        if (!isNoteOn) return;
        const padIndex = Number(action.replace('Pad ', '').replace(' Trigger', '')) - 1;
        if (padIndex >= 0) {
          window.dispatchEvent(new CustomEvent('performance-pad-trigger', { detail: { padId: padIndex } }));
        }
        return;
      }
      default:
        return;
    }
  }, [
    applyEffectToTarget,
    deckAEffect,
    deckBEffect,
    fxTarget,
    handleMixDurationChange,
    handleMixLeadChange,
    padEffect,
    targetEffect,
    toggleEffect,
    togglePadEffect,
  ]);

  const matchMidiMapping = useCallback((mapping: { channel: string; control: string }, event: MIDIMessageEvent) => {
    const [status, data1, data2] = event.data;
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const mappingChannel = Number(mapping.channel);
    if (Number.isFinite(mappingChannel) && mappingChannel > 0 && mappingChannel !== channel) return false;
    const control = parseMidiControl(mapping.control);
    if (!control) return false;
    if (control.type === 'cc') {
      return messageType === 0xb0 && data1 === control.value;
    }
    if (control.type === 'note') {
      return messageType === 0x90 && data1 === control.value && data2 > 0;
    }
    if (control.type === 'note-range') {
      return messageType === 0x90 && data1 >= control.start && data1 <= control.end && data2 > 0;
    }
    return false;
  }, []);

  const attachMidiInputListeners = useCallback((inputs: MIDIInput[]) => {
    midiInputHandlersRef.current.forEach((handler, id) => {
      const input = inputs.find((entry) => entry.id === id);
      if (input) input.onmidimessage = null;
    });
    midiInputHandlersRef.current.clear();

    inputs.forEach((input) => {
      const handler = (event: MIDIMessageEvent) => {
        setLastMidiMessage(`${input.name ?? 'MIDI'}: ${formatMidiMessage(event)}`);
        if (midiLearnIndexRef.current !== null) {
          const mapping = extractMappingFromMessage(event);
          if (mapping) {
            const learnIndex = midiLearnIndexRef.current;
            setMidiMappings((prev) =>
              prev.map((item, i) => (i === learnIndex ? { ...item, ...mapping } : item))
            );
            setMidiLearnIndex(null);
            showNotification(`Mapped ${mapping.control} on channel ${mapping.channel}`, 'success');
          }
          return;
        }
        const [, data1, data2] = event.data;
        const matches = midiMappingsRef.current.filter((mapping) => matchMidiMapping(mapping, event));
        if (!matches.length) return;
        matches.forEach((mapping) => handleMidiAction(mapping.action, data1, data2 ?? 0));
      };
      input.onmidimessage = handler;
      midiInputHandlersRef.current.set(input.id, handler);
    });
  }, [extractMappingFromMessage, formatMidiMessage, handleMidiAction, matchMidiMapping, showNotification]);

  const syncMidiInputs = useCallback(
    (access: MIDIAccess) => {
      const inputs = Array.from(access.inputs.values());
      setMidiInputs(inputs);
      attachMidiInputListeners(inputs);
      setMidiStatus(inputs.length ? 'ready' : 'idle');
      setMidiError(null);
    },
    [attachMidiInputListeners]
  );

  const handleScanMidiDevices = useCallback(async () => {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('error');
      setMidiError('Web MIDI not supported in this browser.');
      return;
    }
    setMidiStatus('scanning');
    setMidiError(null);
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      setMidiAccess(access);
      syncMidiInputs(access);
      access.onstatechange = () => syncMidiInputs(access);
    } catch (error) {
      setMidiStatus('error');
      setMidiError('MIDI access was denied or unavailable.');
    }
  }, [syncMidiInputs]);

  const handleLearnMidi = (index: number) => {
    setMidiLearnIndex((prev) => (prev === index ? null : index));
  };

  useEffect(() => {
    return () => {
      midiInputHandlersRef.current.forEach((_, id) => {
        const input = midiInputs.find((entry) => entry.id === id);
        if (input) input.onmidimessage = null;
      });
      midiInputHandlersRef.current.clear();
      if (midiAccess) midiAccess.onstatechange = null;
    };
  }, [midiAccess, midiInputs]);

  const getActiveDeck = useCallback(() => {
    const aPlaying = deckAState?.playing;
    const bPlaying = deckBState?.playing;

    if (aPlaying && !bPlaying) return 'A';
    if (bPlaying && !aPlaying) return 'B';

    if (aPlaying && bPlaying) {
      const aRemaining = (deckAState?.duration || 0) - (deckAState?.currentTime || 0);
      const bRemaining = (deckBState?.duration || 0) - (deckBState?.currentTime || 0);

      return aRemaining <= bRemaining ? 'A' : 'B';
    }

    return null;
  }, [
    deckAState?.playing,
    deckAState?.duration,
    deckAState?.currentTime,
    deckBState?.playing,
    deckBState?.duration,
    deckBState?.currentTime,
  ]);

  const handleDeckStateUpdate = useCallback((id: DeckId, state: PlayerState) => {
    id === 'A' ? setDeckAState(state) : setDeckBState(state);
    if (state.playing && autoLoadDeckRef.current === id) {
      autoLoadDeckRef.current = null;
    }
    const prevPlaying = prevPlayingRef.current[id];
    if (prevPlaying && !state.playing) {
      if (autoStopRef.current[id]) {
        autoStopRef.current[id] = false;
      } else {
        const nearEnd = state.duration > 0 && state.currentTime >= state.duration - 0.5;
        if (!nearEnd) {
          manualPauseRef.current[id] = true;
        }
      }
    }
    if (!prevPlaying && state.playing) {
      manualPauseRef.current[id] = false;
      autoStopRef.current[id] = false;
    }
    prevPlayingRef.current[id] = state.playing;
    if (state.isReady && state.title && state.videoId && state.sourceType === 'youtube') {
      setLibrary(prev => updateTrackMetadata(state.videoId, { title: state.title, author: state.author }, prev));
    }
    
    // AUTO DJ TRANSACTION: Advance transaction when deck becomes ready
    const txn = activeTransactionRef.current;
    if (txn && txn.targetDeck === id && txn.state === 'PRELOADING' && state.isReady && !state.playing) {
      console.log(`[TXN ${txn.id}] Deck ${id} ready → advancing to READY state`);
      txn.state = 'READY';
    }
    
    // AUTO DJ TRANSACTION: Advance transaction when deck starts playing
    if (txn && txn.targetDeck === id && txn.state === 'READY' && state.playing) {
      console.log(`[TXN ${txn.id}] Deck ${id} playing → advancing to PLAYING state`);
      txn.state = 'PLAYING';
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
      // AUTO DJ TRANSACTION: Cancel transaction if manual load to that deck
      const txn = activeTransactionRef.current;
      if (txn && txn.targetDeck === deck && txn.state !== 'MIXING') {
        console.log(`[TXN ${txn.id}] Manual load to ${deck} → canceling transaction`);
        activeTransactionRef.current = null;
      }
      
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
      id: makeId(),
      videoId: track.videoId,
      url: 'addedAt' in track ? track.url : `https://www.youtube.com/watch?v=${track.videoId}`,
      title: track.title,
      thumbnailUrl: track.thumbnailUrl,
      addedAt: Date.now(),
      author: 'addedAt' in track ? track.author : (track as YouTubeSearchResult).channelTitle,
      album: 'addedAt' in track ? track.album : undefined,
      fileName: 'addedAt' in track ? track.fileName : undefined,
      sourceType: 'sourceType' in track ? track.sourceType : 'youtube'
    };
    setQueue(prev => [...prev, item]);
    showNotification('Added to Queue');
  }, []);

  const handleQueueReorder = useCallback((from: number, to: number) => {
    setQueue(prev => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const stopDeck = useCallback((deckId: DeckId) => {
    const state = deckId === 'A' ? deckAState : deckBState;
    const ref = deckId === 'A' ? deckARef : deckBRef;
    if (state?.playing) {
      autoStopRef.current[deckId] = true;
      ref.current?.togglePlay();
    }
  }, [deckAState, deckBState]);

  const startAutoMix = useCallback((fromDeck: DeckId, targetDeck: DeckId) => {
    if (mixInProgressRef.current) return;
    
    // AUTO DJ TRANSACTION: Advance to MIXING state
    const txn = activeTransactionRef.current;
    if (txn && txn.targetDeck === targetDeck && txn.state === 'PLAYING') {
      console.log(`[TXN ${txn.id}] Starting crossfade → advancing to MIXING state`);
      txn.state = 'MIXING';
    }
    
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
        
        // AUTO DJ TRANSACTION: Complete transaction after crossfade
        const completedTxn = activeTransactionRef.current;
        if (completedTxn && completedTxn.targetDeck === targetDeck && completedTxn.state === 'MIXING') {
          console.log(`[TXN ${completedTxn.id}] Crossfade complete → transaction finished`);
          activeTransactionRef.current = null;
        }
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

  // ========================================
  // TRANSACTION HELPER FUNCTIONS (P0-1 FIX)
  // ========================================
  
  /**
   * Start a new Auto DJ transition transaction.
   * Replaces preloadNextQueueItem with atomic transaction lifecycle.
   */
  const startTransition = useCallback((targetDeck: DeckId, sourceDeck: DeckId): TransitionTransaction | null => {
    const nextItem = queue[0];
    if (!nextItem) {
      console.warn('[TXN] No queue item to start transition');
      return null;
    }
    
    // Cancel any existing transaction first
    if (activeTransactionRef.current) {
      console.warn(`[TXN] Canceling existing transaction ${activeTransactionRef.current.id}`);
      activeTransactionRef.current = null;
    }
    
    const txnId = makeId();
    const transaction: TransitionTransaction = {
      id: txnId,
      state: 'PRELOADING',
      targetDeck,
      sourceDeck,
      queueItem: nextItem,
      startedAt: Date.now()
    };
    
    activeTransactionRef.current = transaction;
    console.log(`[TXN ${txnId}] Started: ${nextItem.title} → ${targetDeck} (from ${sourceDeck})`);
    
    // Load track to target deck in CUE mode
    handleLoadVideo(
      nextItem.videoId,
      nextItem.url,
      targetDeck,
      nextItem.sourceType || 'youtube',
      nextItem.title,
      nextItem.author,
      'cue'
    );
    
    return transaction;
  }, [queue, handleLoadVideo]);
  
  /**
   * Validate that transaction is still active and in expected state.
   * Returns true if transaction is valid for the given deck and state.
   */
  const validateTransaction = useCallback((expectedDeck?: DeckId, expectedState?: TransitionTransaction['state']): boolean => {
    const txn = activeTransactionRef.current;
    if (!txn) return false;
    
    if (expectedDeck && txn.targetDeck !== expectedDeck) {
      console.warn(`[TXN ${txn.id}] Validation failed: expected deck ${expectedDeck}, got ${txn.targetDeck}`);
      return false;
    }
    
    if (expectedState && txn.state !== expectedState) {
      console.warn(`[TXN ${txn.id}] Validation failed: expected state ${expectedState}, got ${txn.state}`);
      return false;
    }
    
    return true;
  }, []);
  
  /**
   * Remove queue item for completed transaction.
   */
  const completeTransaction = useCallback((txnId: string) => {
    const txn = activeTransactionRef.current;
    if (!txn || txn.id !== txnId) {
      console.warn(`[TXN] Cannot complete: transaction ${txnId} not active`);
      return;
    }
    
    console.log(`[TXN ${txnId}] Completing: removing queue item ${txn.queueItem.id}`);
    setQueue(prev => prev.filter(item => item.id !== txn.queueItem.id));
  }, []);

  const queueAutoMix = useCallback((fromDeck: DeckId) => {
    if (mixInProgressRef.current || pendingMixRef.current) return;
    const targetDeck = fromDeck === 'A' ? 'B' : 'A';
    const targetState = targetDeck === 'A' ? deckAState : deckBState;
    if (targetState?.playing) {
      startAutoMix(fromDeck, targetDeck);
      return;
    }
    
    // AUTO DJ TRANSACTION: Use transaction if it's in READY or PLAYING state
    const txn = activeTransactionRef.current;
    if (txn && txn.targetDeck === targetDeck && (txn.state === 'READY' || txn.state === 'PLAYING')) {
      console.log(`[TXN ${txn.id}] Queue mix: transaction in ${txn.state} state`);
      
      if (txn.state === 'READY') {
        // Track is ready but not playing yet - start it
        const targetRef = targetDeck === 'A' ? deckARef : deckBRef;
        setTimeout(() => targetRef.current?.togglePlay(), 0);
      }
      
      // Complete the transaction (remove from queue)
      completeTransaction(txn.id);
      
      // Set pending mix to trigger crossfade when ready
      const pending = { deck: targetDeck, fromDeck, item: txn.queueItem };
      pendingMixRef.current = pending;
      setPendingMix(pending);
      return;
    }
    
    // Fallback: no valid transaction, load directly
    console.log('[AUTO DJ] No valid transaction, loading directly');
    const nextItem = loadNextQueueItem(targetDeck, 'load');
    if (!nextItem) return;
    const pending = { deck: targetDeck, fromDeck, item: nextItem };
    pendingMixRef.current = pending;
    setPendingMix(pending);
  }, [deckAState, deckBState, loadNextQueueItem, startAutoMix, completeTransaction]);

  const handleTrackEnd = useCallback((deckId: DeckId) => {
    if (!autoDjEnabled) return;
    lastMixVideoRef.current[deckId] = null;
    queueAutoMix(deckId);
  }, [autoDjEnabled, queueAutoMix]);

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

  const handleRemoveMultiple = useCallback((ids: string[]) => {
    setLibrary(prev => prev.filter(track => !ids.includes(track.id)));
    showNotification(`Removed ${ids.length} items from Library`);
  }, []);

  useKeyboardShortcuts(deckARef, deckBRef, crossfader, setCrossfader, () => setShowHelp(p => !p), {
    muteDeck, pitchDeck, resetEq
  });

  // ========================================
  // AUTO DJ MAIN LOOP (P0-1 REFACTORED)
  // ========================================
  
  useEffect(() => {
    if (!autoDjEnabled) return;
    const interval = setInterval(() => {
      if (mixInProgressRef.current || pendingMixRef.current || queue.length === 0) return;
      const deckAPlaying = deckAState?.playing || false;
      const deckBPlaying = deckBState?.playing || false;

      // CASE 1: No decks playing - start first track
      if (!deckAPlaying && !deckBPlaying) {
        if (manualPauseRef.current.A || manualPauseRef.current.B) return;
        if (autoLoadDeckRef.current) return;
        
        const nextDeck = lastAutoDeckRef.current === 'A' ? 'B' : 'A';
        const txn = activeTransactionRef.current;
        
        // Check if we have a ready transaction for this deck
        if (txn && txn.targetDeck === nextDeck && txn.state === 'READY') {
          console.log(`[TXN ${txn.id}] No decks playing → starting ${nextDeck} with ready transaction`);
          completeTransaction(txn.id);
          autoLoadDeckRef.current = nextDeck;
          setCrossfader(nextDeck === 'A' ? -1 : 1);
          const targetRef = nextDeck === 'A' ? deckARef : deckBRef;
          setTimeout(() => targetRef.current?.togglePlay(), 0);
          return;
        }
        
        // No transaction - load directly
        console.log('[AUTO DJ] No decks playing → loading next track');
        const nextItem = loadNextQueueItem(nextDeck, 'load');
        if (!nextItem) {
          autoLoadDeckRef.current = null;
          return;
        }
        autoLoadDeckRef.current = nextDeck;
        setCrossfader(nextDeck === 'A' ? -1 : 1);
        const targetRef = nextDeck === 'A' ? deckARef : deckBRef;
        setTimeout(() => targetRef.current?.togglePlay(), 0);
        return;
      }

      // CASE 2: One deck playing - manage transition
      const activeDeck = getActiveDeck();
      if (!activeDeck) return;
      const activeState = activeDeck === 'A' ? deckAState : deckBState;
      if (!activeState?.duration || !activeState.isReady) return;
      if (activeState.videoId && lastMixVideoRef.current[activeDeck] === activeState.videoId) return;

      const remaining = activeState.duration - activeState.currentTime;
      const leadTime = Math.min(Math.max(1, mixLeadSeconds), activeState.duration);
      const preloadTime = Math.min(activeState.duration, Math.max(leadTime + 6, leadTime * 2));
      const playStartTime = leadTime + Math.max(2, mixDurationSeconds);
      const targetDeck = activeDeck === 'A' ? 'B' : 'A';
      const targetState = targetDeck === 'A' ? deckAState : deckBState;

      // STAGE 1: PRELOAD (at preloadTime seconds remaining)
      if (remaining <= preloadTime && !targetState?.playing) {
        const txn = activeTransactionRef.current;
        
        // Only start new transaction if no transaction exists
        if (!txn) {
          console.log(`[AUTO DJ] ${remaining.toFixed(1)}s remaining → starting preload to ${targetDeck}`);
          startTransition(targetDeck, activeDeck);
        }
      }

      // STAGE 2: START PLAYING (at playStartTime seconds remaining)
      if (remaining <= playStartTime && remaining > leadTime && !targetState?.playing) {
        const txn = activeTransactionRef.current;
        
        if (txn && txn.targetDeck === targetDeck && txn.state === 'READY') {
          console.log(`[TXN ${txn.id}] ${remaining.toFixed(1)}s remaining → starting playback early`);
          const targetRef = targetDeck === 'A' ? deckARef : deckBRef;
          setTimeout(() => targetRef.current?.togglePlay(), 150);
        } else if (txn && txn.targetDeck === targetDeck && txn.state === 'PRELOADING') {
          console.log(`[TXN ${txn.id}] Still preloading at ${remaining.toFixed(1)}s - waiting for READY state`);
        } else if (!txn) {
          console.warn(`[AUTO DJ] FAILSAFE: No transaction at ${remaining.toFixed(1)}s - loading directly`);
          const nextItem = loadNextQueueItem(targetDeck, 'load');
          if (nextItem) {
            const targetRef = targetDeck === 'A' ? deckARef : deckBRef;
            setTimeout(() => targetRef.current?.togglePlay(), 500);
          }
        }
      }

      // STAGE 3: START CROSSFADE (at leadTime seconds remaining)
      if (remaining <= leadTime) {
        lastMixVideoRef.current[activeDeck] = activeState.videoId;
        
        // Check if target deck is already playing (from early start)
        if (targetState?.playing) {
          console.log(`[AUTO DJ] ${remaining.toFixed(1)}s remaining → starting crossfade (target already playing)`);
          startAutoMix(activeDeck, targetDeck);
        } else {
          console.log(`[AUTO DJ] ${remaining.toFixed(1)}s remaining → queueing mix`);
          queueAutoMix(activeDeck);
        }
      }
    }, 250);
    return () => clearInterval(interval);
  }, [autoDjEnabled, queue, deckAState, deckBState, mixLeadSeconds, mixDurationSeconds, getActiveDeck, loadNextQueueItem, queueAutoMix, startAutoMix, startTransition, completeTransaction]);

  useEffect(() => {
    if (autoDjEnabled) return;
    pendingMixRef.current = null;
    autoLoadDeckRef.current = null;
    setPendingMix(null);
    lastMixVideoRef.current = {};
    activeTransactionRef.current = null; // Clear transaction when Auto DJ disabled
    manualPauseRef.current = { A: false, B: false };
    prevPlayingRef.current = { A: false, B: false };
    autoStopRef.current = { A: false, B: false };
  }, [autoDjEnabled]);

  useEffect(() => {
    // AUTO DJ TRANSACTION: Invalidate transaction if queue changes
    const txn = activeTransactionRef.current;
    if (!txn) return;
    const queuedItem = queue[0];
    if (!queuedItem || queuedItem.id !== txn.queueItem.id) {
      console.log(`[TXN ${txn.id}] Queue changed → canceling transaction`);
      activeTransactionRef.current = null;
    }
  }, [queue]);

  useEffect(() => {
    if (!pendingMix) return;
    const targetState = pendingMix.deck === 'A' ? deckAState : deckBState;
    const targetRef = pendingMix.deck === 'A' ? deckARef : deckBRef;

    if (!targetState?.isReady) return;

    console.log(`Auto DJ: pendingMix executing for deck ${pendingMix.deck}, isPlaying=${targetState.playing}`);

    // Start playing if not already
    if (!targetState.playing) {
      targetRef.current?.togglePlay();
    }

    // Start crossfade immediately (this is emergency fallback or instant mix mode)
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

  // Initialize master gain nodes on mount
  useEffect(() => {
    if (!masterGainA.current && masterPlayerA) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      gainA.connect(ctx.destination);
      gainB.connect(ctx.destination);
      masterGainA.current = gainA;
      masterGainB.current = gainB;
    }
  }, [masterPlayerA, masterPlayerB]);

  // Web Audio API crossfader volume control (replaces 50ms interval)
  const updateCrossfaderVolumes = useCallback(() => {
    if (!masterGainA.current || !masterGainB.current) return;

    const t = (crossfader + 1) / 2; // Normalize to 0..1
    const curveMap: Record<CrossfaderCurve, (t: number) => [number, number]> = {
      'SMOOTH': (t) => [Math.cos(t * Math.PI * 0.5), Math.sin(t * Math.PI * 0.5)],
      'CUT': (t) => [t <= 0.5 ? 1 : 0, t >= 0.5 ? 1 : 0],
      'DIP': (t) => [
        t <= 0.5 ? 1.0 : 2.0 * (1.0 - t),
        t >= 0.5 ? 1.0 : 2.0 * t
      ]
    };

    const [gainA, gainB] = curveMap[xFaderCurve](t);

    // Apply deck volumes and master volume
    const finalA = gainA * (deckAVolume / 100) * (masterVolume / 100);
    const finalB = gainB * (deckBVolume / 100) * (masterVolume / 100);

    // Smooth ramp for audio quality
    const now = masterGainA.current.context.currentTime;
    masterGainA.current.gain.setTargetAtTime(finalA, now, 0.02);
    masterGainB.current.gain.setTargetAtTime(finalB, now, 0.02);
  }, [crossfader, xFaderCurve, deckAVolume, deckBVolume, masterVolume]);

  // Update on any volume change
  useEffect(() => {
    updateCrossfaderVolumes();
  }, [updateCrossfaderVolumes]);

  return (
    <ErrorBoundary>
       <div className="app-shell bg-[#1C1B1F] text-white overflow-hidden font-['Roboto']" data-theme={theme}>
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
            <button
              onClick={() => setShowSettings(true)}
              className="text-gray-600 hover:text-white transition-transform hover:rotate-12"
              title="Settings"
            >
              <span className="material-icons">settings</span>
            </button>
          </div>
        </nav>

        <div
          className="app-shell__main min-h-0"
          style={{
            '--left-w': libraryOpen ? 'clamp(320px,26vw,420px)' : '0px',
            '--right-w': queueOpen ? 'clamp(240px,18vw,300px)' : '0px'
          } as React.CSSProperties}
        >
             {viewMode === 'LIBRARY' ? (
            <section
              className={`app-shell__panel app-shell__panel--left bg-black/20 flex flex-col transition-all duration-300 flex-none h-full ${
                libraryOpen ? 'app-shell__panel--open border-r border-white/5' : 'app-shell__panel--closed'
              }`}
            >
              <div className={`flex flex-col gap-4 h-full min-h-0 ${libraryOpen ? 'p-4 opacity-100 transition-opacity' : 'p-0 opacity-0'}`}>
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
           <section className={`app-shell__panel app-shell__panel--left bg-black/20 flex flex-col h-full shrink-0 ${
            libraryOpen ? 'app-shell__panel--open border-r border-white/5' : 'app-shell__panel--closed'
           }`}>
              <div className={`flex flex-col gap-3 h-full min-h-0 overflow-y-auto scrollbar-slim ${libraryOpen ? 'p-3 opacity-100' : 'p-0 opacity-0'}`}>
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

          <section className="perform-stage min-h-0 min-w-0" ref={centralStageContainerRef}>
            <div className="perform-stage__inner w-full min-h-0">
              <div 
                className="central-stage" 
                style={{
                  '--central-stage-scale': centralStageScale
                } as React.CSSProperties}
              >
                <div className="central-stage__panel" ref={centralStagePanelRef}>
                  <div className="perform-stage__deck central-stage__deck">
                    <Deck ref={deckARef} id="A" color="#D0BCFF" eq={deckAEq} effect={deckAEffect} effectWet={deckAEffectWet} effectIntensity={deckAEffectIntensity} onStateUpdate={s => handleDeckStateUpdate('A', s)} onPlayerReady={p => setMasterPlayerA(p)} onTrackEnd={() => handleTrackEnd('A')} />
                  </div>
                  <Mixer
                    crossfader={crossfader}
                    onCrossfaderChange={setCrossfader}
                    crossfaderCurve={xFaderCurve}
                    onCurveChange={setXFaderCurve}
                    autoDjEnabled={autoDjEnabled}
                    onToggleAutoDj={() => setAutoDjEnabled(prev => !prev)}
                    mixLeadSeconds={mixLeadSeconds}
                    mixDurationSeconds={mixDurationSeconds}
                    onMixLeadChange={handleMixLeadChange}
                    onMixDurationChange={handleMixDurationChange}
                    queueLength={queue.length}
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
                  <div className="perform-stage__deck central-stage__deck">
                    <Deck ref={deckBRef} id="B" color="#F2B8B5" eq={deckBEq} effect={deckBEffect} effectWet={deckBEffectWet} effectIntensity={deckBEffectIntensity} onStateUpdate={s => handleDeckStateUpdate('B', s)} onPlayerReady={p => setMasterPlayerB(p)} onTrackEnd={() => handleTrackEnd('B')} />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside
            className={`app-shell__panel app-shell__panel--right bg-black/10 flex-none flex flex-col transition-all duration-300 overflow-x-hidden ${
              queueOpen ? 'app-shell__panel--open border-l border-white/5' : 'app-shell__panel--closed'
            }`}
          >
                <div className={`h-full ${queueOpen ? 'p-4 opacity-100 visible transition-opacity' : 'p-0 opacity-0 invisible'}`}>
                  <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2 pr-1">
                    <span className="text-[10px] font-black uppercase text-gray-500 tracking-[0.2em]">Queue Console</span>
                    <button onClick={() => setQueueOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:text-white hover:bg-white/5">
                      <span className="material-symbols-outlined text-sm leading-none">close</span>
                    </button>
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
                    onReorder={handleQueueReorder} 
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

        {showSettings && (
          <div className="fixed inset-0 z-[3500] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
            <div className="relative w-full max-w-5xl bg-[#14131A] border border-white/10 rounded-3xl shadow-[0_0_80px_rgba(208,188,255,0.15)] overflow-hidden">
              <div className="flex items-center justify-between px-8 py-6 border-b border-white/10 bg-gradient-to-r from-[#1A1822] via-[#15131B] to-[#111018]">
                <div className="flex items-center gap-4">
                  <span className="material-icons text-[#D0BCFF] text-3xl">settings</span>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Configuration</p>
                    <h2 className="text-2xl font-black text-white">Performance Settings</h2>
                  </div>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <span className="material-icons text-xl">close</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-8 py-6">
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#D0BCFF]">Keyboard Shortcuts</p>
                      <p className="text-xs text-white/60">Map core DJ actions to your preferred key layout.</p>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40 border border-white/10 px-3 py-1 rounded-full">Live</span>
                  </div>
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-2 scrollbar-slim">
                    {keyboardMappings.map((item, index) => (
                      <div key={`${item.action}-${index}`} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">{item.action}</p>
                          <p className="text-[11px] text-white/50">{item.detail}</p>
                        </div>
                        <input
                          value={item.keys}
                          onChange={(event) => updateKeyboardMapping(index, event.target.value)}
                          className="w-28 bg-[#0F0E13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white text-center uppercase tracking-widest focus:border-[#D0BCFF] focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/40">Changes apply immediately. Avoid conflicting assignments across decks.</p>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#D0BCFF]">MIDI Mapping</p>
                      <p className="text-xs text-white/60">Route controller knobs, faders, and pads to mix actions.</p>
                    </div>
                    <button
                      onClick={handleScanMidiDevices}
                      className="text-[10px] font-black uppercase tracking-widest text-white/60 border border-white/10 px-3 py-1 rounded-full hover:text-white"
                    >
                      {midiStatus === 'scanning' ? 'Scanning...' : 'Scan Devices'}
                    </button>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                    <p className="text-xs text-white/70">Status</p>
                    <p className="text-sm font-semibold text-white mt-1">
                      {midiStatus === 'error' && (midiError || 'MIDI unavailable')}
                      {midiStatus !== 'error' && midiInputs.length === 0 && 'No MIDI device connected'}
                      {midiStatus !== 'error' && midiInputs.length > 0 && `Connected: ${midiInputs.length} device${midiInputs.length > 1 ? 's' : ''}`}
                    </p>
                    {midiLearnIndex !== null && (
                      <div className="mt-2 text-[10px] text-[#D0BCFF] uppercase tracking-widest font-black">
                        Learning: {midiMappings[midiLearnIndex]?.action || 'MIDI Control'}
                      </div>
                    )}
                    {midiInputs.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {midiInputs.map((input) => (
                          <div key={input.id} className="text-[11px] text-white/60">
                            {input.name || 'Unnamed MIDI Device'}
                          </div>
                        ))}
                      </div>
                    )}
                    {lastMidiMessage && (
                      <div className="mt-2 text-[10px] text-white/50">
                        Last input: <span className="text-white/80">{lastMidiMessage}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 max-h-[320px] overflow-y-auto pr-2 scrollbar-slim">
                    {midiMappings.map((item, index) => {
                      const previousGroup = index > 0 ? midiMappings[index - 1].group : null;
                      const showGroup = item.group && item.group !== previousGroup;
                      return (
                        <React.Fragment key={`${item.action}-${index}`}>
                          {showGroup && (
                            <div className={`flex items-center gap-2 px-1 ${index === 0 ? '' : 'pt-2'}`}>
                              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-gray-500">{item.group}</span>
                              <div className="flex-1 h-px bg-white/5" />
                            </div>
                          )}
                          <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-white">{item.action}</p>
                              <p className="text-[11px] text-white/50">{item.detail}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleLearnMidi(index)}
                                className={`text-[9px] font-black uppercase tracking-widest px-2 py-2 rounded-xl border transition ${
                                  midiLearnIndex === index
                                    ? 'bg-[#D0BCFF] text-black border-[#D0BCFF]'
                                    : 'text-white/60 border-white/10 hover:text-white'
                                }`}
                              >
                                {midiLearnIndex === index ? 'Listening' : 'Learn'}
                              </button>
                              <input
                                value={item.channel}
                                onChange={(event) => updateMidiMapping(index, 'channel', event.target.value)}
                                className="w-12 bg-[#0F0E13] border border-white/10 rounded-xl px-2 py-2 text-xs text-white text-center focus:border-[#D0BCFF] focus:outline-none"
                              />
                              <input
                                value={item.control}
                                onChange={(event) => updateMidiMapping(index, 'control', event.target.value)}
                                className="w-24 bg-[#0F0E13] border border-white/10 rounded-xl px-2 py-2 text-xs text-white text-center uppercase focus:border-[#D0BCFF] focus:outline-none"
                              />
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-white/40">Tip: match your controller layout to keep performance muscle memory intact.</p>
                </section>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-8 py-5 border-t border-white/10 bg-[#121018]">
                <button
                  onClick={() => {
                    setKeyboardMappings(defaultKeyboardMappings);
                    setMidiMappings(defaultMidiMappings);
                  }}
                  className="text-[10px] font-black uppercase tracking-widest text-[#F2B8B5] border border-[#F2B8B5]/40 px-4 py-2 rounded-full hover:bg-[#F2B8B5]/10"
                >
                  Reset Defaults
                </button>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-4 py-2 rounded-full hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="text-[10px] font-black uppercase tracking-widest bg-[#D0BCFF] text-black px-6 py-2 rounded-full hover:bg-white"
                  >
                    Save Settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </ErrorBoundary>
  );
};

export default App;
