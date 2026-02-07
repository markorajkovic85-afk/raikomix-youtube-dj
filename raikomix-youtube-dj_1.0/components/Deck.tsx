import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo
} from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { DeckId, EffectType, PlayerState, TrackSourceType } from '../types';
import Waveform from './Waveform';
import { detectBpmFromAudioBuffer, extractBPMFromTitle } from '../utils/bpmDetection';
import { parseYouTubeTitle } from '../utils/youtubeApi';
import { buildWaveformData } from '../utils/waveform';
import { DeckAudioEngine } from '../utils/audioEngine';

interface DeckProps {
  id: DeckId;
  color: string;
  onStateUpdate: (state: PlayerState) => void;
  onPlayerReady?: (player: any) => void;
  onTrackEnd?: () => void;
  eq: { hi: number, mid: number, low: number, filter: number };
  effect: EffectType | null;
  effectWet: number;
  effectIntensity: number;
  audioContext: AudioContext | null;
  masterGainNode: GainNode | null;
}

export interface DeckHandle {
  loadVideo: (url: string, sourceType?: TrackSourceType, metadata?: { title?: string, author?: string }) => void;
  cueVideo: (url: string, sourceType?: TrackSourceType, metadata?: { title?: string, author?: string }) => void;
  togglePlay: () => void;
  triggerHotCue: (index: number, clear?: boolean) => void;
  toggleLoop: (beats?: number) => void;
  setPlaybackRate: (rate: number) => void;
  tapBpm: () => void;
}

const CUE_COLORS = [
  '#FFD700', // Gold / Yellow
  '#00E5FF', // Cyan / Light Blue
  '#FF4081', // Hot Pink
  '#76FF03', // Lime Green
];

type DeckVisualMode = 'wave' | 'video';

const MarqueeText: React.FC<{ text: string; className: string }> = ({ text, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (containerRef.current && textRef.current) {
      setShouldAnimate(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [text]);

  return (
    <div ref={containerRef} className="marquee-container w-full min-w-0 overflow-hidden">
      <div
        ref={textRef}
        className={`${className} marquee-text ${shouldAnimate ? 'animate-marquee' : 'truncate'}`}
      >
        {text}
        {shouldAnimate && <span className="ml-12">{text}</span>}
      </div>
    </div>
  );
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const Deck = forwardRef<DeckHandle, DeckProps>(
  ({ id, color, onStateUpdate, onPlayerReady, onTrackEnd, eq, effect, effectWet, effectIntensity, audioContext, masterGainNode }, ref) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [tapHistory, setTapHistory] = useState<number[]>([]);
    const [showRemaining, setShowRemaining] = useState(false);

    const storageKey = useMemo(() => `raikomix.deck.${id}.visual`, [id]);
    const [visualMode, setVisualMode] = useState<DeckVisualMode>(() => {
      try {
        const v = localStorage.getItem(storageKey);
        return v === 'video' ? 'video' : 'wave';
      } catch (e) {
        return 'wave';
      }
    });

    useEffect(() => {
      try {
        localStorage.setItem(storageKey, visualMode);
      } catch (e) { }
    }, [storageKey, visualMode]);

    const [state, setState] = useState<PlayerState>({
      playing: false,
      currentTime: 0,
      duration: 0,
      volume: 80,
      playbackRate: 1.0,
      videoId: '',
      sourceType: 'youtube',
      isReady: false,
      bpm: 120,
      musicalKey: '-',
      title: '',
      author: '',
      hotCues: [null, null, null, null],
      loopActive: false,
      loopStart: 0,
      loopEnd: 0,
      eqHigh: eq.hi,
      eqMid: eq.mid,
      eqLow: eq.low,
      filter: eq.filter,
      waveform: undefined,
      waveformPeaks: undefined
    } as any);

    const playerRef = useRef<any>(null);
    const localAudioRef = useRef<HTMLAudioElement>(null);

    // Tempo (horizontal) pointer handling
    const tempoContainerRef = useRef<HTMLDivElement>(null);
    const tempoPointerIdRef = useRef<number | null>(null);
    const tempoDraggingRef = useRef(false);

    // Video seek line pointer handling (thin scrub strip)
    const videoSeekRef = useRef<HTMLDivElement>(null);
    const videoSeekPointerIdRef = useRef<number | null>(null);
    const videoSeekDraggingRef = useRef(false);

    const containerId = `yt-player-${id}`;

    const formatTime = useCallback((timeSeconds: number) => {
      const safeSeconds = Math.max(0, Math.floor(timeSeconds));
      const minutes = Math.floor(safeSeconds / 60);
      const seconds = safeSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, []);

    // Audio Engine (manages all Web Audio nodes)
    const audioEngine = useRef(new DeckAudioEngine(id));
    const isLoadingRef = useRef(false);
    const isConnectingRef = useRef(false);

    const connectAudioEngine = useCallback(() => {
      if (!localAudioRef.current || isConnectingRef.current) return;
      isConnectingRef.current = true;
      try {
        audioEngine.current.initialize(localAudioRef.current, {
          context: audioContext ?? undefined,
          destination: masterGainNode ?? undefined
        });
      } catch (error) {
        console.error(`[Deck ${id}] audio engine init failed`, error);
      } finally {
        isConnectingRef.current = false;
      }
    }, [audioContext, masterGainNode]);

    useEffect(() => {
      audioEngine.current.setOutputNode(masterGainNode ?? null);
    }, [masterGainNode]);

    const applyEffectChain = useCallback((effectType: EffectType | null) => {
      audioEngine.current.applyEffect(effectType, effectIntensity);
    }, [effectIntensity]);

    // Sync EQ nodes with props
    useEffect(() => {
      audioEngine.current.updateEQ({
        low: eq.low,
        mid: eq.mid,
        hi: eq.hi,
        filter: eq.filter
      });
    }, [eq]);

    useEffect(() => {
      audioEngine.current.updateWetDryMix(effectWet);
    }, [effectWet]);

    useEffect(() => {
      applyEffectChain(effect);
    }, [applyEffectChain, effect]);

    useEffect(() => {
      setState(s => ({
        ...s,
        eqHigh: eq.hi,
        eqMid: eq.mid,
        eqLow: eq.low,
        filter: eq.filter
      }));
    }, [eq]);

    useEffect(() => {
      // Only allow "Video" visual mode for YouTube sources.
      if (state.sourceType !== 'youtube' && visualMode === 'video') {
        setVisualMode('wave');
      }
    }, [state.sourceType, visualMode]);

    const updatePlaybackRate = useCallback((rate: number) => {
      const newRate = clamp(rate, 0.5, 1.5);

      if (playerRef.current && typeof playerRef.current.setPlaybackRate === 'function') {
        try {
          playerRef.current.setPlaybackRate(newRate);
        } catch (e) {
          console.warn("YouTube player setPlaybackRate failed", e);
        }
      }

      if (localAudioRef.current) {
        localAudioRef.current.playbackRate = newRate;
      }

      setState(s => ({ ...s, playbackRate: newRate }));
    }, []);

    const getPlaybackRateFromPointer = useCallback((clientX: number) => {
      if (!tempoContainerRef.current) return null;
      const rect = tempoContainerRef.current.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const rate = 0.5 + ratio * 1.0; // 0.5..1.5
      return clamp(rate, 0.5, 1.5);
    }, []);

    const handleTempoPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (!tempoContainerRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      tempoContainerRef.current.setPointerCapture(event.pointerId);
      tempoPointerIdRef.current = event.pointerId;
      tempoDraggingRef.current = true;

      const rate = getPlaybackRateFromPointer(event.clientX);
      if (rate !== null) updatePlaybackRate(rate);
    }, [getPlaybackRateFromPointer, updatePlaybackRate]);

    const handleTempoPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (!tempoDraggingRef.current) return;
      if (tempoPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const rate = getPlaybackRateFromPointer(event.clientX);
      if (rate !== null) updatePlaybackRate(rate);
    }, [getPlaybackRateFromPointer, updatePlaybackRate]);

    const handleTempoPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (tempoPointerIdRef.current !== event.pointerId) return;
      tempoDraggingRef.current = false;
      tempoPointerIdRef.current = null;
      if (tempoContainerRef.current?.hasPointerCapture(event.pointerId)) {
        tempoContainerRef.current.releasePointerCapture(event.pointerId);
      }
    }, []);

    const seekToTime = useCallback((time: number) => {
      if (!state.duration || !Number.isFinite(time)) return;
      const t = clamp(time, 0, state.duration);
      if (state.sourceType === 'youtube') playerRef.current?.seekTo(t, true);
      else if (localAudioRef.current) localAudioRef.current.currentTime = t;
      // Optimistic update so the playhead feels responsive
      setState(s => ({ ...s, currentTime: t }));
    }, [state.duration, state.sourceType]);

    const getSeekTimeFromPointer = useCallback((clientX: number) => {
      if (!videoSeekRef.current || !state.duration) return null;
      const rect = videoSeekRef.current.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const clampedRatio = clamp(ratio, 0, 1);
      return clampedRatio * state.duration;
    }, [state.duration]);

    const handleVideoSeekPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (!videoSeekRef.current || !state.duration) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      videoSeekRef.current.setPointerCapture(event.pointerId);
      videoSeekPointerIdRef.current = event.pointerId;
      videoSeekDraggingRef.current = true;

      const time = getSeekTimeFromPointer(event.clientX);
      if (time !== null) seekToTime(time);
    }, [getSeekTimeFromPointer, seekToTime, state.duration]);

    const handleVideoSeekPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (!videoSeekDraggingRef.current) return;
      if (videoSeekPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();

      const time = getSeekTimeFromPointer(event.clientX);
      if (time !== null) seekToTime(time);
    }, [getSeekTimeFromPointer, seekToTime]);

    const handleVideoSeekPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (videoSeekPointerIdRef.current !== event.pointerId) return;
      videoSeekDraggingRef.current = false;
      videoSeekPointerIdRef.current = null;
      if (videoSeekRef.current?.hasPointerCapture(event.pointerId)) {
        videoSeekRef.current.releasePointerCapture(event.pointerId);
      }
    }, []);

    const analyzeTrackMetadata = async (title: string, author: string) => {
      const apiKey = (import.meta as any)?.env?.VITE_API_KEY || process.env.API_KEY;
      if (!title || title === 'Unknown Track' || !apiKey) return;
      setIsScanning(true);
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Identify the BPM and Musical Key (Camelot scale) for: "${title}" by "${author}". Return valid JSON.`,
          config: {
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                bpm: { type: Type.NUMBER },
                key: { type: Type.STRING }
              },
              required: ["bpm", "key"]
            }
          }
        });
        const data = JSON.parse(response.text || '{}');
        if (data.bpm) setState(s => ({ ...s, bpm: data.bpm, musicalKey: data.key || '-' }));
      } catch (e) {
        console.error("AI Analysis failed:", e);
      } finally {
        setIsScanning(false);
      }
    };

    const loadSeqRef = useRef(0);
    const analysisAbortRef = useRef<AbortController | null>(null);
    const loadTimeoutRef = useRef<number | null>(null);
    type PendingLocalLoad = {
      url: string;
      metadata?: { title?: string; author?: string };
      loadMode: 'load' | 'cue';
    };
    const pendingLocalLoadRef = useRef<PendingLocalLoad | null>(null);

    const analyzeLocalAudio = async (url: string, seq: number, signal?: AbortSignal) => {
      try {
        setIsScanning(true);
        const response = await fetch(url, signal ? { signal } : undefined);
        const arrayBuffer = await response.arrayBuffer();
        const existingContext = audioEngine.current.getContext();
        const tempContext = existingContext ?? new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0));
        const bpm = detectBpmFromAudioBuffer(audioBuffer);
        const waveform = buildWaveformData(audioBuffer);

        if (seq !== loadSeqRef.current) {
          if (!existingContext) {
            await tempContext.close();
          }
          return;
        }

        setState(s => ({
          ...s,
          bpm: bpm ?? s.bpm,
          waveform: waveform.levels.length ? waveform : undefined,
          waveformPeaks: undefined
        }));

        if (!existingContext) {
          await tempContext.close();
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.warn('Local audio analysis failed:', e);
        }
      } finally {
        if (seq === loadSeqRef.current) {
          setIsScanning(false);
        }
      }
    };

    const updateMetadata = useCallback((player: any) => {
      if (!player) return;
      const data = player.getVideoData ? player.getVideoData() : {};
      const { title, author } = parseYouTubeTitle(data.title || 'Unknown Track', data.author || 'YouTube Stream');
      const initialBpm = extractBPMFromTitle(data.title || '') || 120;

      setState(s => ({
        ...s,
        isReady: true,
        duration: player.getDuration() || 0,
        title,
        author,
        bpm: initialBpm
      }));

      analyzeTrackMetadata(title, author);
    }, []);

    const handleToggleLoop = useCallback((beats: number = 4) => {
      const beatDuration = 60 / state.bpm;
      const loopDuration = beats * beatDuration;
      const isThisLoopActive = state.loopActive && Math.abs((state.loopEnd - state.loopStart) - loopDuration) < 0.1;
      setState(s => ({
        ...s,
        loopActive: !isThisLoopActive,
        loopStart: !isThisLoopActive ? state.currentTime : 0,
        loopEnd: !isThisLoopActive ? state.currentTime + loopDuration : 0
      }));
    }, [state.bpm, state.loopActive, state.loopStart, state.loopEnd, state.currentTime]);

    const handleHotCue = useCallback((index: number, clear: boolean = false) => {
      if (clear) {
        const newCues = [...state.hotCues];
        newCues[index] = null;
        setState(s => ({ ...s, hotCues: newCues }));
        return;
      }

      const cue = state.hotCues[index];
      if (cue === null) {
        const newCues = [...state.hotCues];
        newCues[index] = state.currentTime;
        setState(s => ({ ...s, hotCues: newCues }));
      } else {
        if (state.sourceType === 'youtube') {
          playerRef.current?.seekTo(cue, true);
          playerRef.current?.playVideo();
        } else if (localAudioRef.current) {
          localAudioRef.current.currentTime = cue;
          localAudioRef.current.play();
        }
      }
    }, [state.hotCues, state.currentTime, state.sourceType]);

    const handleClearAllHotCues = useCallback(() => {
      setState(s => ({ ...s, hotCues: [null, null, null, null] }));
    }, []);

    const togglePlay = useCallback(() => {
      // Resume context if suspended (browser policy)
      audioEngine.current.resumeContext();

      if (state.sourceType === 'youtube') {
        state.playing ? playerRef.current?.pauseVideo() : playerRef.current?.playVideo();
      } else {
        state.playing ? localAudioRef.current?.pause() : localAudioRef.current?.play();
      }
    }, [state.playing, state.sourceType]);

    const initPlayer = useCallback((videoId: string, loadMode: 'load' | 'cue' = 'load') => {
      if (!window.YT || !window.YT.Player) {
        setTimeout(() => initPlayer(videoId, loadMode), 500);
        return;
      }

      if (playerRef.current) {
        try {
          // Reset state for existing player to avoid GUI freeze/glitch
          // IMPORTANT: Keep isReady=true for cue mode so Auto DJ can trigger playback
          setState(s => ({
            ...s,
            videoId,
            isReady: loadMode === 'cue' ? true : false,
            sourceType: 'youtube',
            playbackRate: 1.0,
            playing: false,
            currentTime: 0,
            loopActive: false,
            waveform: undefined,
            waveformPeaks: undefined
          }));
          if (loadMode === 'cue') {
            playerRef.current.cueVideoById(videoId);
          } else {
            playerRef.current.loadVideoById(videoId);
          }
          setIsLoading(loadMode !== 'cue');
        } catch (e) {
          setIsLoading(false);
        }
        return;
      }

      playerRef.current = new window.YT.Player(containerId, {
        height: '1', width: '1', videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, origin: window.location.origin, enablejsapi: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (event: any) => {
            const p = event.target;
            updateMetadata(p);
            onPlayerReady?.({
              setVolume: (v: number) => p.setVolume(v),
              playVideo: () => p.playVideo(),
              pauseVideo: () => p.pauseVideo(),
              seekTo: (t: number) => p.seekTo(t, true),
              setPlaybackRate: (r: number) => p.setPlaybackRate(r)
            });
            setIsLoading(false);
          },
          onStateChange: (event: any) => {
            const playerState = event.data;
            setState(s => ({ ...s, playing: playerState === window.YT.PlayerState.PLAYING }));

            if (playerState === window.YT.PlayerState.CUED || playerState === window.YT.PlayerState.PLAYING) {
              updateMetadata(event.target);
              event.target.setPlaybackRate(state.playbackRate);
              setIsLoading(false);
            }

            if (playerState === window.YT.PlayerState.ENDED) {
              setState(s => ({ ...s, playing: false }));
              onTrackEnd?.();
            }
          },
        }
      });
    }, [containerId, onPlayerReady, onTrackEnd, updateMetadata, state.playbackRate]);

    const pumpLocalLoad = useCallback(async () => {
      if (isLoadingRef.current || isConnectingRef.current) return;
      const next = pendingLocalLoadRef.current;
      if (!next) return;

      pendingLocalLoadRef.current = null;

      isLoadingRef.current = true;
      const seq = ++loadSeqRef.current;

      try { analysisAbortRef.current?.abort(); } catch (e) { }
      analysisAbortRef.current = null;
      setIsScanning(false);

      const finalize = () => {
        isLoadingRef.current = false;
        isConnectingRef.current = false;
        setIsLoading(false);
        if (loadTimeoutRef.current) {
          window.clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        if (pendingLocalLoadRef.current) {
          void pumpLocalLoad();
        }
      };

      const audio = localAudioRef.current;
      if (!audio) {
        console.error(`[Deck ${id}] localAudioRef.current is null!`);
        finalize();
        return;
      }

      console.log(`[Deck ${id}] loadLocalFile start:`, {
        url: next.url,
        loadMode: next.loadMode,
        metadata: next.metadata,
        seq
      });

      loadTimeoutRef.current = window.setTimeout(() => {
        if (seq !== loadSeqRef.current) return;
        console.warn(`[Deck ${id}] local load timeout, releasing lock`, { seq });
        setState(s => ({
          ...s,
          isReady: false,
          playing: false,
          sourceType: 'local',
          title: next.metadata?.title || 'Local Track',
          author: next.metadata?.author || 'Local File'
        }));
        finalize();
      }, 12000);

      if (state.sourceType === 'youtube') {
        try { playerRef.current?.pauseVideo(); } catch (e) { }
        try { playerRef.current?.stopVideo(); } catch (e) { }
      }

      if (state.sourceType === 'youtube') {
        try {
          await audioEngine.current.cleanup();
        } catch (e) {
          console.warn(`[Deck ${id}] audio engine cleanup failed:`, e);
        }
      }

      setIsLoading(next.loadMode !== 'cue');

      const stableVideoId = `local_${next.url}`;

      const onLoaded = () => {
        if (seq !== loadSeqRef.current) return;

        setState(s => ({
          ...s,
          isReady: true,
          sourceType: 'local',
          duration: audio.duration || 0,
          title: next.metadata?.title || next.url.split('/').pop() || 'Local Track',
          author: next.metadata?.author || 'Local File',
          videoId: stableVideoId,
          playbackRate: 1.0,
          playing: false,
          currentTime: 0,
          loopActive: false,
          waveform: undefined,
          waveformPeaks: undefined
        }));

        if (next.loadMode !== 'cue') {
          const controller = new AbortController();
          analysisAbortRef.current = controller;
          void analyzeLocalAudio(next.url, seq, controller.signal);
        }

        onPlayerReady?.({
          setVolume: (v: number) => { audio.volume = v / 100; },
          playVideo: () => audio.play(),
          pauseVideo: () => audio.pause(),
          seekTo: (t: number) => { audio.currentTime = t; },
          setPlaybackRate: (r: number) => { audio.playbackRate = r; }
        });

        finalize();
      };

      const onErrorLike = (ev?: any) => {
        if (seq !== loadSeqRef.current) return;
        console.warn(`[Deck ${id}] local audio load failed`, ev);
        setState(s => ({
          ...s,
          isReady: false,
          playing: false,
          sourceType: 'local',
          title: next.metadata?.title || next.url.split('/').pop() || 'Local Track',
          author: next.metadata?.author || 'Local File'
        }));
        finalize();
      };

      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      audio.addEventListener('error', onErrorLike, { once: true });
      audio.addEventListener('stalled', onErrorLike, { once: true });

      try { audio.pause(); } catch (e) { }
      audio.src = '';
      try { audio.load(); } catch (e) { }
      audio.src = next.url;
      try { audio.load(); } catch (e) { }

      connectAudioEngine();
    }, [connectAudioEngine, id, onPlayerReady, state.sourceType]);

    const loadLocalFile = useCallback((
      url: string,
      metadata?: { title?: string; author?: string },
      loadMode: 'load' | 'cue' = 'load'
    ) => {
      pendingLocalLoadRef.current = { url, metadata, loadMode };
      void pumpLocalLoad();
    }, [pumpLocalLoad]);

    const handleTap = useCallback(() => {
      const now = Date.now();
      const newHistory = [...tapHistory, now].slice(-4);
      setTapHistory(newHistory);
      if (newHistory.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < newHistory.length; i++) intervals.push(newHistory[i] - newHistory[i - 1]);
        const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
        setState(s => ({ ...s, bpm: Math.round(60000 / avgInterval) }));
      }
    }, [tapHistory]);

    useImperativeHandle(ref, () => ({
      loadVideo: (url: string, sourceType: TrackSourceType = 'youtube', metadata?: { title?: string, author?: string }) => {
        if (sourceType === 'local') {
          loadLocalFile(url, metadata, 'load');
        } else {
          // Stop local audio when switching to YouTube to avoid double-audio
          if (localAudioRef.current) {
            try { localAudioRef.current.pause(); } catch (e) { }
            try { localAudioRef.current.currentTime = 0; } catch (e) { }
          }
          const vid = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
          if (vid) {
            initPlayer(vid, 'load');
            if (metadata) {
              setState(s => ({ ...s, title: metadata.title, author: metadata.author }));
            }
          }
        }
      },
      cueVideo: (url: string, sourceType: TrackSourceType = 'youtube', metadata?: { title?: string, author?: string }) => {
        if (sourceType === 'local') {
          loadLocalFile(url, metadata, 'cue');
        } else {
          // Stop local audio when switching to YouTube to avoid double-audio
          if (localAudioRef.current) {
            try { localAudioRef.current.pause(); } catch (e) { }
            try { localAudioRef.current.currentTime = 0; } catch (e) { }
          }
          const vid = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
          if (vid) {
            initPlayer(vid, 'cue');
            if (metadata) {
              setState(s => ({ ...s, title: metadata.title, author: metadata.author }));
            }
          }
        }
      },
      togglePlay,
      triggerHotCue: handleHotCue,
      toggleLoop: handleToggleLoop,
      setPlaybackRate: updatePlaybackRate,
      tapBpm: handleTap
    }), [handleTap, initPlayer, loadLocalFile, togglePlay, handleHotCue, handleToggleLoop, updatePlaybackRate]);

    useEffect(() => {
      if (!state.isReady) {
        return;
      }
      if (!state.playing && !state.loopActive) {
        return;
      }

      const intervalMs = state.playing ? 100 : 500;
      const interval = setInterval(() => {
        let t = 0;
        let nextDuration: number | null = null;
        if (state.sourceType === 'youtube' && playerRef.current) {
          try {
            t = playerRef.current.getCurrentTime();
            nextDuration = playerRef.current.getDuration?.() || null;
          } catch (e) { }
        } else if (state.sourceType === 'local' && localAudioRef.current) {
          t = localAudioRef.current.currentTime;
          nextDuration = localAudioRef.current.duration || null;
        }

        if (state.loopActive && t >= state.loopEnd) {
          if (state.sourceType === 'youtube') playerRef.current?.seekTo(state.loopStart, true);
          else if (localAudioRef.current) localAudioRef.current.currentTime = state.loopStart;
        }
        setState(s => {
          const duration = nextDuration && Math.abs(nextDuration - s.duration) > 0.5
            ? nextDuration
            : s.duration;
          const timeChanged = Math.abs(t - s.currentTime) > 0.05;
          if (!timeChanged && duration === s.duration) return s;
          return { ...s, currentTime: t, duration };
        });
      }, intervalMs);
      return () => clearInterval(interval);
    }, [state.isReady, state.playing, state.loopActive, state.loopStart, state.loopEnd, state.sourceType]);

    useEffect(() => { onStateUpdate(state); }, [state, onStateUpdate]);

    useEffect(() => {
      const handleVisibilityChange = () => {
        if (!document.hidden || !state.playing) return;
        if (state.sourceType === 'youtube') {
          playerRef.current?.playVideo?.();
        } else {
          localAudioRef.current?.play?.().catch(() => { });
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [state.playing, state.sourceType]);

    // Cleanup audio engine on unmount
    useEffect(() => {
      return () => {
        try { analysisAbortRef.current?.abort(); } catch (e) { }
        analysisAbortRef.current = null;
        if (loadTimeoutRef.current) {
          window.clearTimeout(loadTimeoutRef.current);
          loadTimeoutRef.current = null;
        }
        void audioEngine.current.cleanup();
      };
    }, []);

    const playRingStyle = state.playing
      ? { borderColor: color, boxShadow: `0 0 18px ${color}55` }
      : undefined;

    const tempoPct = ((state.playbackRate - 0.5) / 1.0) * 100;
    const tempoIsZero = Math.abs(state.playbackRate - 1.0) < 0.001;
    const tempoPercentText = ((state.playbackRate - 1.0) * 100).toFixed(2);

    const loopIsActiveForBeats = (beats: number) => {
      const beatDuration = 60 / state.bpm;
      return state.loopActive && Math.abs((state.loopEnd - state.loopStart) - beats * beatDuration) < 0.1;
    };

    const canShowVideo = state.sourceType === 'youtube';
    const showVideo = visualMode === 'video' && canShowVideo;
    const transportHeightPx = 12;

    const playheadPct = state.duration > 0
      ? clamp(state.currentTime / state.duration, 0, 1) * 100
      : 0;

    const loopStartPct = state.loopActive && state.duration > 0
      ? clamp(state.loopStart / state.duration, 0, 1) * 100
      : null;

    const loopEndPct = state.loopActive && state.duration > 0
      ? clamp(state.loopEnd / state.duration, 0, 1) * 100
      : null;

    const loopLeftPct = (loopStartPct !== null && loopEndPct !== null)
      ? Math.min(loopStartPct, loopEndPct)
      : null;

    const loopRightPct = (loopStartPct !== null && loopEndPct !== null)
      ? Math.max(loopStartPct, loopEndPct)
      : null;

    return (
      <div className="m3-card deck-card bg-[#1D1B20] border-white/5 shadow-2xl transition-all hover:border-[#D0BCFF]/20 relative overflow-hidden w-full min-w-0 max-w-none h-auto max-h-full min-h-0 p-2 flex flex-col gap-2">
        <audio
          ref={localAudioRef}
          style={{ display: 'none' }}
          onPlay={() => setState(s => ({ ...s, playing: true }))}
          onPause={() => setState(s => ({ ...s, playing: false }))}
          onEnded={() => {
            setState(s => ({ ...s, playing: false }));
            onTrackEnd?.();
          }}
        />

        {/* Visual Stage (Waveform + optional Artistic Video overlay) */}
        <div className="w-full min-w-0 flex-1 min-h-[clamp(56px,10vh,120px)]">
          <div className="deck-visual-stage relative">
            <div
              className={`deck-video-shell ${showVideo ? 'deck-video-shell--on' : ''}`}
              style={{ ['--deck-accent' as any]: color } as React.CSSProperties}
              aria-hidden={!showVideo}
            >
              {/* IMPORTANT: prevent pointer events from reaching the YouTube iframe */}
              <div id={containerId} className="deck-yt-host" style={{ pointerEvents: 'none' }} />

              <div className="deck-video-overlay deck-video-tint" />
              <div className="deck-video-overlay deck-video-scanlines" />
              <div className="deck-video-overlay deck-video-noise" />
              <div className="deck-video-overlay deck-video-glitch" />
              <div className="deck-video-overlay deck-video-vignette" />

              {/* Interaction shield: catches mouse/touch so YT never receives input (leave thin seek line free) */}
              {showVideo && (
                <div
                  className="deck-video-overlay deck-video-interaction-shield"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: `${transportHeightPx}px`,
                    zIndex: 50,
                    pointerEvents: 'auto',
                    background: 'transparent'
                  }}
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onPointerMove={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onPointerCancel={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  aria-hidden
                />
              )}
            </div>

            {/* Waveform (full-height in wave mode; thin seek line in video mode) */}
            {showVideo ? (
              <div
                ref={videoSeekRef}
                className="absolute left-0 right-0 bottom-0 z-50 touch-none select-none"
                style={{ height: `${transportHeightPx}px`, cursor: 'ew-resize' }}
                onPointerDown={handleVideoSeekPointerDown}
                onPointerMove={handleVideoSeekPointerMove}
                onPointerUp={handleVideoSeekPointerUp}
                onPointerCancel={handleVideoSeekPointerUp}
                title="Scrub / Seek"
                aria-label="Scrub / Seek"
                role="slider"
                aria-valuemin={0}
                aria-valuemax={state.duration || 0}
                aria-valuenow={state.currentTime || 0}
              >
                <div
                  className="relative w-full h-full"
                  style={{
                    background: 'rgba(0,0,0,0.15)',
                    borderTop: '1px solid rgba(255,255,255,0.08)'
                  }}
                >
                  {/* Loop region */}
                  {state.loopActive && loopLeftPct !== null && loopRightPct !== null && (
                    <>
                      <div
                        className="absolute inset-y-0 pointer-events-none"
                        style={{
                          left: `${loopLeftPct}%`,
                          width: `${Math.max(0, loopRightPct - loopLeftPct)}%`,
                          background: 'rgba(34,197,94,0.16)'
                        }}
                      />
                      <div
                        className="absolute inset-y-0 pointer-events-none"
                        style={{
                          left: `${loopLeftPct}%`,
                          width: '1px',
                          background: 'rgba(34,197,94,0.95)',
                          boxShadow: '0 0 10px rgba(34,197,94,0.35)'
                        }}
                      />
                      <div
                        className="absolute inset-y-0 pointer-events-none"
                        style={{
                          left: `${loopRightPct}%`,
                          width: '1px',
                          background: 'rgba(34,197,94,0.95)',
                          boxShadow: '0 0 10px rgba(34,197,94,0.35)'
                        }}
                      />
                    </>
                  )}

                  {/* Hot cue markers */}
                  {state.duration > 0 && state.hotCues.map((cue, i) => {
                    if (cue === null) return null;
                    const pct = clamp(cue / state.duration, 0, 1) * 100;
                    const cueColor = CUE_COLORS[i] || '#fff';
                    return (
                      <button
                        key={i}
                        type="button"
                        className="absolute top-0 bottom-0"
                        style={{
                          left: `${pct}%`,
                          transform: 'translateX(-50%)',
                          width: '12px',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          margin: 0,
                          cursor: 'pointer'
                        }}
                        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          seekToTime(cue);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleHotCue(i, true);
                        }}
                        title={`Hot Cue ${i + 1} (Right-click to clear)`}
                        aria-label={`Hot Cue ${i + 1}`}
                      >
                        <div
                          className="absolute left-1/2"
                          style={{
                            top: '1px',
                            transform: 'translateX(-50%)',
                            width: '9px',
                            height: '9px',
                            background: cueColor,
                            clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
                            boxShadow: `0 0 10px ${cueColor}55`
                          }}
                        />
                      </button>
                    );
                  })}

                  {/* Playhead */}
                  <div
                    className="absolute inset-y-0"
                    style={{
                      left: `${playheadPct}%`,
                      width: '2px',
                      transform: 'translateX(-1px)',
                      background: color,
                      boxShadow: `0 0 10px ${color}88`
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className={'opacity-100'} style={{ height: '100%' }}>
                <Waveform
                  isPlaying={state.playing}
                  volume={state.volume * (0.5 + state.eqLow * 0.5)}
                  color={color}
                  playbackRate={state.playbackRate}
                  currentTime={state.currentTime}
                  duration={state.duration}
                  waveform={state.waveform}
                  peaks={state.waveformPeaks}
                  sourceType={state.sourceType}
                  hotCues={state.hotCues}
                  cueColors={CUE_COLORS}
                  eq={{ low: state.eqLow, mid: state.eqMid, high: state.eqHigh }}
                  loop={{
                    active: state.loopActive,
                    start: state.loopStart,
                    end: state.loopEnd
                  }}
                  onSeek={(time) => {
                    if (state.sourceType === 'youtube') playerRef.current?.seekTo(time, true);
                    else if (localAudioRef.current) localAudioRef.current.currentTime = time;
                  }}
                  timeLabel={showRemaining
                    ? `-${formatTime(state.duration - state.currentTime)}`
                    : formatTime(state.currentTime)}
                  onTimeToggle={() => setShowRemaining(prev => !prev)}
                  minHeightPx={56}
                />
              </div>
            )}
          </div>
        </div>

        {/* Row 1: Title + Play */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-stretch min-w-0">
          <div className="bg-black/30 rounded-lg border border-white/5 px-2 py-1.5 min-w-0 overflow-hidden flex items-center">
            <div className="flex items-start justify-between gap-2 min-w-0 w-full">
              <div className="min-w-0">
                <MarqueeText
                  text={state.title || 'Deck Ready'}
                  className="text-[clamp(10px,1.15vw,12px)] font-black text-white uppercase tracking-tight whitespace-nowrap"
                />
                <MarqueeText
                  text={state.author || (state.sourceType === 'local' ? 'Local Media' : 'Insert Media')}
                  className="text-[clamp(8px,1vw,10px)] text-gray-500 font-black uppercase tracking-widest opacity-80 whitespace-nowrap"
                />
              </div>

              <div className="shrink-0 flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${state.playing ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
                  <div className="text-[11px] font-black tracking-tight" style={{ color }}>
                    {id}
                  </div>

                  {/* Small per-deck visual toggle */}
                  <div className="ml-2 flex items-center gap-1">
                    <span className="text-[8px] font-black uppercase tracking-widest text-white/30">VIS</span>
                    <button
                      type="button"
                      onClick={() => setVisualMode('wave')}
                      className={
                        `h-5 w-6 rounded-md border text-[9px] font-black uppercase tracking-widest transition ` +
                        (visualMode === 'wave'
                          ? 'text-black'
                          : 'text-white/50 hover:text-white hover:border-white/20')
                      }
                      style={visualMode === 'wave'
                        ? { background: color, borderColor: color }
                        : { borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)' }}
                      title="Waveform"
                      aria-label="Waveform"
                    >
                      W
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisualMode('video')}
                      disabled={!canShowVideo}
                      className={
                        `h-5 w-6 rounded-md border text-[9px] font-black uppercase tracking-widest transition ` +
                        (!canShowVideo
                          ? 'opacity-40 cursor-not-allowed text-white/30'
                          : visualMode === 'video'
                            ? 'text-black'
                            : 'text-white/50 hover:text-white hover:border-white/20')
                      }
                      style={visualMode === 'video'
                        ? { background: color, borderColor: color }
                        : { borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.02)' }}
                      title={canShowVideo ? 'Video' : 'Video available for YouTube sources only'}
                      aria-label="Video"
                    >
                      V
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-white/40">
                  <span>{state.sourceType === 'local' ? 'LOCAL' : 'YT'}</span>
                  <span className={`${isScanning ? 'animate-pulse text-gray-300' : 'text-white/60'}`}>
                    Key {state.musicalKey}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <button
              onClick={togglePlay}
              disabled={!state.isReady}
              className="w-10 h-10 rounded-lg bg-gradient-to-b from-[#2A2733] to-[#16151C] border-2 flex items-center justify-center transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
              style={playRingStyle}
              aria-label={state.playing ? 'Pause' : 'Play'}
              title="Play / Pause"
            >
              <span className="material-icons text-[22px] text-white leading-none">
                {state.playing ? 'pause' : 'play_arrow'}
              </span>
            </button>
          </div>
        </div>

        {/* Row 2: BPM + Tempo */}
        <div className="grid grid-cols-[minmax(0,148px)_minmax(0,1fr)] gap-2 items-stretch min-w-0">
          {/* BPM block */}
          <div className="bg-black/30 rounded-lg border border-white/5 px-2 py-1.5 min-w-0 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="min-w-0 flex items-baseline gap-1">
                <div
                  className={`text-[clamp(16px,2.2vw,22px)] font-black mono leading-none ${isScanning ? 'animate-pulse text-gray-400' : ''}`}
                  style={!isScanning ? { color } : {}}
                  title="Effective BPM (base BPM × playback rate)"
                >
                  {(state.bpm * state.playbackRate).toFixed(1)}
                </div>
                <div className="text-[9px] text-gray-500 font-black uppercase whitespace-nowrap">BPM</div>
              </div>

              <button
                onClick={handleTap}
                className="h-7 px-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-white shrink-0"
                title="Tap BPM"
              >
                TAP
              </button>
            </div>

            <div className="text-[8px] text-gray-600 font-black uppercase tracking-widest whitespace-nowrap">
              Base <span className="text-white/70">{state.bpm}</span> • Rate <span className="text-white/70">{state.playbackRate.toFixed(3)}x</span>
            </div>
          </div>

          {/* Tempo block (horizontal, drag + wheel + dblclick reset) */}
          <div
            ref={tempoContainerRef}
            className="bg-black/30 rounded-lg border border-white/5 px-2 py-1.5 min-w-0 flex flex-col gap-1 select-none hover:border-white/20 active:border-[#D0BCFF]/30 touch-none"
            onDoubleClick={() => updatePlaybackRate(1.0)}
            onPointerDown={handleTempoPointerDown}
            onPointerMove={handleTempoPointerMove}
            onPointerUp={handleTempoPointerUp}
            onPointerCancel={handleTempoPointerUp}
            onWheel={(e) => {
              e.preventDefault();
              const delta = -e.deltaY * 0.001; // Fine control with mouse wheel
              updatePlaybackRate(state.playbackRate + delta);
            }}
            title="Drag to Pitch • Scroll for Fine-Tune • Double-click to Reset"
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="text-[9px] font-black uppercase tracking-widest text-gray-500 whitespace-nowrap">
                Tempo
              </div>
              <div className={`text-[10px] font-black mono transition-all whitespace-nowrap ${tempoIsZero ? 'text-[#D0BCFF]' : 'text-gray-400'}`}>
                {tempoPercentText}%
              </div>
            </div>

            <div className="relative h-7 rounded-md border border-white/10 bg-black/20 overflow-hidden">
              {/* Detent (1.0x) */}
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
              <div className={`absolute inset-y-0 left-1/2 w-[3px] -ml-[1px] ${tempoIsZero ? 'bg-[#D0BCFF]/70 shadow-[0_0_10px_#D0BCFF]' : 'bg-transparent'}`} />

              {/* Tick marks */}
              <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none opacity-25">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className={`bg-white ${i === 4 ? 'h-4 w-[2px]' : 'h-2 w-px'}`} />
                ))}
              </div>

              {/* Knob */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-8 h-5 rounded-md bg-[#323038] border-2 border-white/20 shadow-[0_8px_16px_rgba(0,0,0,0.6)] flex items-center justify-center pointer-events-none"
                style={{
                  left: `calc(${tempoPct}% - 16px)`
                }}
              >
                <div className="w-5 h-[2px] bg-[#D0BCFF] shadow-[0_0_8px_#D0BCFF]" />
              </div>

              {/* Accessible input overlay */}
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.0001"
                value={state.playbackRate}
                onInput={(e) => updatePlaybackRate(parseFloat(e.currentTarget.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
                aria-label="Tempo / Pitch"
              />
            </div>

            <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest text-gray-600 whitespace-nowrap">
              <span>-50%</span>
              <span>0</span>
              <span>+50%</span>
            </div>
          </div>
        </div>

        {/* Row 3: Hot Cues + Loops (flexes to fill spare height) */}
        <div className="grid grid-cols-2 gap-2 items-stretch min-w-0 flex-1 min-h-[120px]">
          {/* Hot Cues */}
          <div className="bg-black/20 rounded-lg border border-white/5 p-1.5 min-w-0 overflow-hidden flex flex-col h-full">
            <div className="flex items-center justify-between gap-2 min-w-0 h-6">
              <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest truncate">
                Hot Cues
              </div>
              <button
                type="button"
                onClick={handleClearAllHotCues}
                className="h-6 px-2 rounded-md text-[9px] font-black uppercase tracking-widest border border-white/5 text-gray-500 hover:text-white hover:border-white/20 transition-all shrink-0"
                title="Clear all hot cues"
              >
                Clear
              </button>
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center">
              <div className="grid grid-cols-2 grid-rows-2 gap-1 w-full aspect-square min-w-0">
                {[0, 1, 2, 3].map((i) => {
                  const isSet = state.hotCues[i] !== null;
                  const cueColor = CUE_COLORS[i];
                  return (
                    <button
                      key={i}
                      onClick={() => handleHotCue(i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleHotCue(i, true);
                      }}
                      title={`Hot Cue ${i + 1} (Right-click to clear)`}
                      aria-label={`Hot Cue ${i + 1}`}
                      className={[
                        "w-full h-full rounded-md font-black text-[clamp(11px,1.4vw,14px)] border transition-all select-none min-w-0 flex items-center justify-center leading-none",
                        "bg-transparent",
                        isSet
                          ? "border-2"
                          : "border-white/5 text-gray-600 hover:text-white hover:border-white/20"
                      ].join(" ")}
                      style={isSet
                        ? { borderColor: cueColor, boxShadow: `0 0 10px ${cueColor}22`, color: cueColor }
                        : {}
                      }
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Loops */}
          <div className="bg-black/20 rounded-lg border border-white/5 p-1.5 min-w-0 overflow-hidden flex flex-col h-full">
            <div className="flex items-center justify-between gap-2 min-w-0 h-6">
              <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest truncate">
                Loops
              </div>
              <div className="text-[9px] text-white/30 font-black uppercase tracking-widest whitespace-nowrap">
                Beats
              </div>
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center">
              <div className="grid grid-cols-2 grid-rows-2 gap-1 w-full aspect-square min-w-0">
                {[2, 4, 8, 16].map((b) => (
                  <button
                    key={b}
                    onClick={() => handleToggleLoop(b)}
                    className={[
                      "w-full h-full rounded-md text-[clamp(11px,1.4vw,14px)] font-black border transition-all select-none min-w-0 flex items-center justify-center leading-none",
                      "bg-transparent",
                      loopIsActiveForBeats(b)
                        ? "border-2 text-green-400"
                        : "border-white/5 text-gray-500 hover:text-white hover:border-white/20"
                    ].join(" ")}
                    style={loopIsActiveForBeats(b)
                      ? { borderColor: 'rgba(34,197,94,0.9)', boxShadow: '0 0 10px rgba(34,197,94,0.18)' }
                      : {}
                    }
                    title={`Loop ${b} beats`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="w-12 h-12 border-4 border-[#D0BCFF] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  }
);

export default Deck;
