import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef
} from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { DeckId, EffectType, PlayerState, TrackSourceType } from '../types';
import Waveform from './Waveform';
import { detectBpmFromAudioBuffer, extractBPMFromTitle } from '../utils/bpmDetection';
import { parseYouTubeTitle } from '../utils/youtubeApi';
import { createEffectChain } from '../utils/effectsChain';
import { buildWaveformData } from '../utils/waveform';

interface DeckProps {
  id: DeckId;
  color: string;
  onStateUpdate: (state: PlayerState) => void;
  onPlayerReady: (player: any) => void;
  onTrackEnd?: () => void;
  eq: { hi: number, mid: number, low: number, filter: number };
  effect: EffectType | null;
  effectWet: number;
  effectIntensity: number;
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
  ({ id, color, onStateUpdate, onPlayerReady, onTrackEnd, eq, effect, effectWet, effectIntensity }, ref) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [tapHistory, setTapHistory] = useState<number[]>([]);
    const [showRemaining, setShowRemaining] = useState(false);

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

    const containerId = `yt-player-${id}`;

    const formatTime = useCallback((timeSeconds: number) => {
      const safeSeconds = Math.max(0, Math.floor(timeSeconds));
      const minutes = Math.floor(safeSeconds / 60);
      const seconds = safeSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, []);

    // Web Audio API Refs
    const audioCtxRef = useRef<AudioContext | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const nodesRef = useRef<{
      low: BiquadFilterNode;
      mid: BiquadFilterNode;
      hi: BiquadFilterNode;
      filter: BiquadFilterNode;
      gain: GainNode;
      dryGain: GainNode;
      wetGain: GainNode;
      mixGain: GainNode;
      effectInput: GainNode;
      effectOutput: GainNode;
    } | null>(null);

    const effectNodesRef = useRef<{
      nodes: AudioNode[];
      dispose?: () => void;
    } | null>(null);

    const initAudioEngine = useCallback(() => {
      if (sourceNodeRef.current || !localAudioRef.current) return;

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = ctx.createMediaElementSource(localAudioRef.current);

      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 200;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 1;

      const hi = ctx.createBiquadFilter();
      hi.type = 'highshelf';
      hi.frequency.value = 10000;

      const filter = ctx.createBiquadFilter();
      filter.type = 'allpass';

      const gainNode = ctx.createGain();
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const mixGain = ctx.createGain();
      const effectInput = ctx.createGain();
      const effectOutput = ctx.createGain();

      source.connect(low);
      low.connect(mid);
      mid.connect(hi);
      hi.connect(filter);
      filter.connect(dryGain);
      filter.connect(effectInput);
      dryGain.connect(mixGain);
      effectOutput.connect(wetGain);
      wetGain.connect(mixGain);
      mixGain.connect(gainNode);
      gainNode.connect(ctx.destination);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      nodesRef.current = { low, mid, hi, filter, gain: gainNode, dryGain, wetGain, mixGain, effectInput, effectOutput };
    }, []);

    const clearEffectChain = useCallback(() => {
      if (!nodesRef.current) return;
      const { effectInput } = nodesRef.current;
      try {
        effectInput.disconnect();
      } catch (e) { }
      if (effectNodesRef.current) {
        effectNodesRef.current.nodes.forEach(node => {
          try {
            node.disconnect();
          } catch (e) { }
        });
        effectNodesRef.current.dispose?.();
      }
      effectNodesRef.current = null;
    }, []);

    const applyEffectChain = useCallback((effectType: EffectType | null) => {
      if (!nodesRef.current || !audioCtxRef.current) return;
      const { effectInput, effectOutput } = nodesRef.current;
      clearEffectChain();

      if (!effectType) {
        effectInput.connect(effectOutput);
        return;
      }

      const chain = createEffectChain(audioCtxRef.current, effectType, effectIntensity);
      if (!chain) {
        effectInput.connect(effectOutput);
        return;
      }
      effectNodesRef.current = { nodes: chain.nodes, dispose: chain.dispose };
      effectInput.connect(chain.input);
      chain.output.connect(effectOutput);
    }, [clearEffectChain, effectIntensity]);

    useEffect(() => {
      if (nodesRef.current && audioCtxRef.current) {
        const { low, mid, hi, filter } = nodesRef.current;
        const now = audioCtxRef.current.currentTime;
        const ramp = 0.05;

        low.gain.setTargetAtTime((eq.low - 1.0) * 12, now, ramp);
        mid.gain.setTargetAtTime((eq.mid - 1.0) * 12, now, ramp);
        hi.gain.setTargetAtTime((eq.hi - 1.0) * 12, now, ramp);

        if (eq.filter < -0.05) {
          filter.type = 'highpass';
          filter.frequency.setTargetAtTime(Math.pow(10, Math.abs(eq.filter) * 2) * 20, now, ramp);
        } else if (eq.filter > 0.05) {
          filter.type = 'lowpass';
          filter.frequency.setTargetAtTime(20000 - (eq.filter * 19800), now, ramp);
        } else {
          filter.type = 'allpass';
        }
      }
    }, [eq]);

    useEffect(() => {
      if (!nodesRef.current || !audioCtxRef.current) return;
      const { dryGain, wetGain } = nodesRef.current;
      const wet = Math.min(1, Math.max(0, effectWet));
      const now = audioCtxRef.current.currentTime;
      const ramp = 0.05;
      dryGain.gain.setTargetAtTime(Math.cos(wet * Math.PI * 0.5), now, ramp);
      wetGain.gain.setTargetAtTime(Math.sin(wet * Math.PI * 0.5), now, ramp);
    }, [effectWet]);

    useEffect(() => {
      if (!nodesRef.current || !audioCtxRef.current) return;
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

    const analyzeLocalAudio = async (url: string) => {
      try {
        setIsScanning(true);
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const existingContext = audioCtxRef.current;
        const tempContext = existingContext ?? new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0));
        const bpm = detectBpmFromAudioBuffer(audioBuffer);
        const wf = buildWaveformData(audioBuffer);

        setState(s => ({
          ...s,
          bpm: bpm ?? s.bpm,
          waveform: wf.levels.length ? wf : undefined,
          waveformPeaks: undefined
        }));

        if (!existingContext) {
          await tempContext.close();
        }
      } catch (e) {
        console.warn('Local audio analysis failed:', e);
      } finally {
        setIsScanning(false);
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
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume();
      }

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
            onPlayerReady({
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

    const loadLocalFile = (
      url: string,
      metadata?: { title?: string, author?: string },
      loadMode: 'load' | 'cue' = 'load'
    ) => {
      console.log(`[Deck ${id}] loadLocalFile called:`, { url, loadMode, metadata });
      initAudioEngine();
      setIsLoading(loadMode !== 'cue');

      if (playerRef.current) {
        try { playerRef.current.pauseVideo(); } catch (e) { }
        try { playerRef.current.seekTo?.(0, true); } catch (e) { }
      }

      if (localAudioRef.current) {
        localAudioRef.current.pause();
        localAudioRef.current.src = url;
        localAudioRef.current.load();

        const stableVideoId = `local_${url}`;
        console.log(`[Deck ${id}] Set audio src, waiting for loadedmetadata. stableVideoId:`, stableVideoId);

        const onLoaded = () => {
          console.log(`[Deck ${id}] loadedmetadata fired! Duration:`, localAudioRef.current?.duration);
          setState(s => ({
            ...s,
            isReady: true,
            sourceType: 'local',
            duration: localAudioRef.current?.duration || 0,
            title: metadata?.title || url.split('/').pop() || 'Local Track',
            author: metadata?.author || 'Local File',
            videoId: stableVideoId,
            playbackRate: 1.0,
            playing: false,
            currentTime: 0,
            loopActive: false,
            waveform: undefined,
            waveformPeaks: undefined
          }));

          console.log(`[Deck ${id}] State updated, isReady: true, videoId:`, stableVideoId);

          if (loadMode !== 'cue') {
            analyzeLocalAudio(url);
          }

          onPlayerReady({
            setVolume: (v: number) => { if (localAudioRef.current) localAudioRef.current.volume = v / 100; },
            playVideo: () => localAudioRef.current?.play(),
            pauseVideo: () => localAudioRef.current?.pause(),
            seekTo: (t: number) => { if (localAudioRef.current) localAudioRef.current.currentTime = t; },
            setPlaybackRate: (r: number) => { if (localAudioRef.current) localAudioRef.current.playbackRate = r; }
          });

          setIsLoading(false);
          localAudioRef.current?.removeEventListener('loadedmetadata', onLoaded);
        };

        localAudioRef.current.addEventListener('loadedmetadata', onLoaded);
      } else {
        console.error(`[Deck ${id}] localAudioRef.current is null!`);
      }
    };

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
    }), [handleTap, initPlayer, togglePlay, handleHotCue, handleToggleLoop, updatePlaybackRate, initAudioEngine]);

    useEffect(() => {
      const interval = setInterval(() => {
        if (state.isReady) {
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
        }
      }, 100);
      return () => clearInterval(interval);
    }, [state.isReady, state.loopActive, state.loopStart, state.loopEnd, state.sourceType]);

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

    return (
      <div className="m3-card deck-card bg-[#1D1B20] border-white/5 shadow-2xl transition-all hover:border-[#D0BCFF]/20 relative overflow-hidden w-full min-w-0 max-w-none h-auto max-h-full min-h-0 p-2 flex flex-col gap-2">
        <div id={containerId} className="h-0 w-0 overflow-hidden" />

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

        {/* Waveform: primary + flexible (fills spare deck height) */}
        <div className="w-full min-w-0 flex-1 min-h-[clamp(56px,10vh,120px)]">
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

        {/* rest of file unchanged */}
      </div>
    );
  }
);

export default Deck;
