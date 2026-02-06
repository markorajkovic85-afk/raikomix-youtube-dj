import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { PlayerState, DeckId, TrackSourceType, EffectType, PlayerControl, AutoDJError, YouTubeAPIError } from '../types';
import DeckAudioEngine from '../utils/audioEngine';

export interface DeckProps {
  id: DeckId;
  color: string;
  eq: { hi: number; mid: number; low: number; filter: number };
  effect: EffectType | null;
  effectWet: number;
  effectIntensity: number;
  sharedAudioContext: AudioContext | null;
  masterGainNode: GainNode | null;
  onStateUpdate: (state: PlayerState) => void;
  onPlayerReady: (player: PlayerControl) => void;
  onTrackEnd: () => void;
}

export interface DeckHandle {
  loadVideo: (url: string, sourceType: TrackSourceType, metadata?: { title?: string; author?: string }) => void;
  cueVideo: (url: string, sourceType: TrackSourceType, metadata?: { title?: string; author?: string }) => void;
  togglePlay: () => void;
  tapBpm: () => void;
  setPlaybackRate: (rate: number) => void;
  triggerHotCue: (index: number) => void;
  toggleLoop: (beats: number) => void;
}

const Deck = forwardRef<DeckHandle, DeckProps>(({
  id,
  color,
  eq,
  effect,
  effectWet,
  effectIntensity,
  sharedAudioContext,
  masterGainNode,
  onStateUpdate,
  onPlayerReady,
  onTrackEnd
}, ref) => {
  // State
  const [audioEngine, setAudioEngine] = useState<DeckAudioEngine | null>(null);
  const [state, setState] = useState<PlayerState>({
    playing: false,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 0.8,
    playbackRate: 1,
    loop: false,
    isReady: false,
    videoId: '',
    title: '',
    author: '',
    sourceType: 'youtube'
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLAudioElement | null>(null);
  const lastPlaybackRateRef = useRef(1);
  const animationFrameIdRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);

  // BPM Detection State
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null);
  const [loopActive, setLoopActive] = useState(false);
  const [loopLength, setLoopLength] = useState(4);
  const [hotCues, setHotCues] = useState<(number | null)[]>([null, null, null, null]);

  // Refs for loop tracking
  const loopStartRef = useRef<number | null>(null);
  const loopEndRef = useRef<number | null>(null);

  const initAudioEngine = useCallback(() => {
    if (!sharedAudioContext || !masterGainNode) {
      console.warn(`[Deck ${id}] Cannot init audio engine: missing sharedAudioContext or masterGainNode`);
      return;
    }

    const engine = new DeckAudioEngine(sharedAudioContext, masterGainNode);
    setAudioEngine(engine);

    const newAudio = new Audio();
    newAudio.crossOrigin = 'anonymous';
    newAudio.preload = 'auto';
    mediaRef.current = newAudio;

    engine.connectMediaElement(newAudio);

    // Emit player control interface
    const playerControl: PlayerControl = {
      play: () => newAudio.play().catch(() => {}),
      pause: () => newAudio.pause(),
      getCurrentTime: () => newAudio.currentTime,
      getDuration: () => newAudio.duration,
      setVolume: (v) => { newAudio.volume = v; },
      getVolume: () => newAudio.volume,
      setPlaybackRate: (r) => { newAudio.playbackRate = r; },
      getPlaybackRate: () => newAudio.playbackRate
    };
    onPlayerReady(playerControl);
  }, [id, sharedAudioContext, masterGainNode, onPlayerReady]);

  useEffect(() => {
    if (sharedAudioContext && masterGainNode && !audioEngine) {
      initAudioEngine();
    }
  }, [sharedAudioContext, masterGainNode, audioEngine, initAudioEngine]);

  useEffect(() => {
    if (!audioEngine) return;
    audioEngine.setEQ(eq.hi, eq.mid, eq.low);
    audioEngine.setFilter(eq.filter);
  }, [eq, audioEngine]);

  useEffect(() => {
    if (!audioEngine) return;
    audioEngine.setEffect(effect, effectWet, effectIntensity);
  }, [effect, effectWet, effectIntensity, audioEngine]);

  useEffect(() => {
    return () => {
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
      if (audioEngine) audioEngine.disconnect();
      if (mediaRef.current) {
        mediaRef.current.pause();
        mediaRef.current.src = '';
      }
    };
  }, [audioEngine]);

  const updateState = useCallback((updates: Partial<PlayerState>) => {
    setState(prev => {
      const next = { ...prev, ...updates };
      onStateUpdate(next);
      return next;
    });
  }, [onStateUpdate]);

  const syncState = useCallback(() => {
    const audio = mediaRef.current;
    if (!audio) return;

    const buffered = audio.buffered.length > 0 ? audio.buffered.end(audio.buffered.length - 1) : 0;
    updateState({
      playing: !audio.paused,
      currentTime: audio.currentTime,
      duration: audio.duration || 0,
      buffered,
      playbackRate: audio.playbackRate,
      loop: loopActive,
      isReady: audio.readyState >= 3
    });

    animationFrameIdRef.current = requestAnimationFrame(syncState);
  }, [updateState, loopActive]);

  useEffect(() => {
    syncState();
    return () => {
      if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
    };
  }, [syncState]);

  const loadLocalFile = useCallback(async (file: File, mode: 'play' | 'cue', metadata?: { title?: string; author?: string }) => {
    const audio = mediaRef.current;
    if (!audio || !audioEngine) {
      throw new Error('Audio engine not initialized');
    }

    setLoading(true);

    // Cleanup previous audio
    if (audio.src) {
      audio.pause();
      audio.currentTime = 0;
      URL.revokeObjectURL(audio.src);
    }

    const objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    audio.load();

    await new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        audio.removeEventListener('canplaythrough', onCanPlay);
        audio.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        audio.removeEventListener('canplaythrough', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Failed to load audio file'));
      };
      audio.addEventListener('canplaythrough', onCanPlay);
      audio.addEventListener('error', onError);
    });

    updateState({
      videoId: file.name,
      title: metadata?.title || file.name,
      author: metadata?.author || 'Local File',
      sourceType: 'local',
      isReady: true,
      currentTime: 0,
      playing: false
    });

    setLoading(false);

    if (mode === 'play') {
      await audio.play();
    }
  }, [audioEngine, updateState]);

  useImperativeHandle(ref, () => ({
    loadVideo: async (url, sourceType, metadata) => {
      if (sourceType === 'local') {
        throw new Error('Use loadLocalFile for local files');
      }
      const audio = mediaRef.current;
      if (!audio) return;

      setLoading(true);
      if (audio.src) audio.pause();
      audio.src = url;
      audio.load();

      updateState({
        videoId: url,
        title: metadata?.title || 'Unknown',
        author: metadata?.author || '',
        sourceType,
        isReady: false,
        currentTime: 0
      });

      await new Promise<void>((resolve) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          updateState({ isReady: true });
          setLoading(false);
          resolve();
        };
        audio.addEventListener('canplaythrough', onCanPlay);
      });

      await audio.play();
    },

    cueVideo: async (url, sourceType, metadata) => {
      if (sourceType === 'local') {
        throw new Error('Use loadLocalFile for local files');
      }
      const audio = mediaRef.current;
      if (!audio) return;

      setLoading(true);
      if (audio.src) audio.pause();
      audio.src = url;
      audio.load();

      updateState({
        videoId: url,
        title: metadata?.title || 'Unknown',
        author: metadata?.author || '',
        sourceType,
        isReady: false,
        currentTime: 0,
        playing: false
      });

      await new Promise<void>((resolve) => {
        const onCanPlay = () => {
          audio.removeEventListener('canplaythrough', onCanPlay);
          updateState({ isReady: true });
          setLoading(false);
          resolve();
        };
        audio.addEventListener('canplaythrough', onCanPlay);
      });
    },

    togglePlay: async () => {
      const audio = mediaRef.current;
      if (!audio) return;
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    },

    tapBpm: () => {
      const now = Date.now();
      setTapTimes(prev => {
        const recent = [...prev, now].filter(t => now - t < 3000);
        if (recent.length >= 2) {
          const intervals = recent.slice(1).map((t, i) => t - recent[i]);
          const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const bpm = Math.round(60000 / avgInterval);
          setDetectedBpm(bpm);
        }
        return recent;
      });
    },

    setPlaybackRate: (rate) => {
      const audio = mediaRef.current;
      if (!audio) return;
      audio.playbackRate = rate;
      lastPlaybackRateRef.current = rate;
    },

    triggerHotCue: (index) => {
      const audio = mediaRef.current;
      if (!audio) return;
      const cueTime = hotCues[index];
      if (cueTime !== null) {
        audio.currentTime = cueTime;
        if (audio.paused) audio.play();
      } else {
        const newCues = [...hotCues];
        newCues[index] = audio.currentTime;
        setHotCues(newCues);
      }
    },

    toggleLoop: (beats) => {
      const audio = mediaRef.current;
      if (!audio || !detectedBpm) return;

      if (loopActive && loopLength === beats) {
        setLoopActive(false);
        loopStartRef.current = null;
        loopEndRef.current = null;
      } else {
        const beatDuration = 60 / detectedBpm;
        const loopDuration = beats * beatDuration;
        const start = audio.currentTime;
        const end = start + loopDuration;

        loopStartRef.current = start;
        loopEndRef.current = end;
        setLoopActive(true);
        setLoopLength(beats);
      }
    }
  }), [hotCues, loopActive, loopLength, detectedBpm, updateState, loadLocalFile]);

  useEffect(() => {
    const audio = mediaRef.current;
    if (!audio || !loopActive || loopStartRef.current === null || loopEndRef.current === null) return;

    const checkLoop = () => {
      if (audio.currentTime >= loopEndRef.current!) {
        audio.currentTime = loopStartRef.current!;
      }
    };

    const interval = setInterval(checkLoop, 50);
    return () => clearInterval(interval);
  }, [loopActive]);

  useEffect(() => {
    const audio = mediaRef.current;
    if (!audio) return;

    const handleEnded = () => {
      onTrackEnd();
    };

    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [onTrackEnd]);

  return (
    <div ref={containerRef} className="deck-container" style={{ borderColor: color }}>
      <div className="deck-header" style={{ backgroundColor: color }}>
        <h2>DECK {id}</h2>
        {loading && <span className="loading-indicator">Loading...</span>}
      </div>
      <div className="deck-waveform">
        <canvas width="400" height="100" />
      </div>
      <div className="deck-info">
        <div className="track-title">{state.title || 'No Track Loaded'}</div>
        <div className="track-artist">{state.author}</div>
      </div>
      <div className="deck-controls">
        <div className="time-display">
          {Math.floor(state.currentTime / 60)}:{String(Math.floor(state.currentTime % 60)).padStart(2, '0')} / {Math.floor(state.duration / 60)}:{String(Math.floor(state.duration % 60)).padStart(2, '0')}
        </div>
        {detectedBpm && <div className="bpm-display">{detectedBpm} BPM</div>}
      </div>
    </div>
  );
});

Deck.displayName = 'Deck';

export default Deck;