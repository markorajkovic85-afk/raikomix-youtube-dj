import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { DeckId, EffectType, PlayerState, TrackSourceType } from '../types';
import Waveform from './Waveform';
import { detectBpmFromAudioBuffer, extractBPMFromTitle } from '../utils/bpmDetection';
import { parseYouTubeTitle } from '../utils/youtubeApi';

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
  togglePlay: () => void;
  triggerHotCue: (index: number, clear?: boolean) => void;
  toggleLoop: (beats?: number) => void;
  setPlaybackRate: (rate: number) => void;
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
    <div ref={containerRef} className="marquee-container w-full">
      <div 
        ref={textRef} 
        className={`${className} marquee-text ${shouldAnimate ? 'animate-marquee' : ''}`}
      >
        {text}
        {shouldAnimate && <span className="ml-12">{text}</span>}
      </div>
    </div>
  );
};

const Deck = forwardRef<DeckHandle, DeckProps>(({ id, color, onStateUpdate, onPlayerReady, onTrackEnd, eq, effect, effectWet, effectIntensity }, ref) => {
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
    filter: eq.filter
  });

  const playerRef = useRef<any>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
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
  
  // Initialize Audio Engine - Safe version that doesn't re-create source node
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

    // Connection chain: source -> low -> mid -> hi -> filter -> dry/wet -> mix -> destination
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
    const { effectInput, effectOutput } = nodesRef.current;
    try {
      effectInput.disconnect();
    } catch (e) {}
    if (effectNodesRef.current) {
      effectNodesRef.current.nodes.forEach(node => {
        try {
          node.disconnect();
        } catch (e) {}
      });
      effectNodesRef.current.dispose?.();
    }
    effectNodesRef.current = null;
  }, []);

 const buildReverbImpulse = useCallback((ctx: AudioContext, duration: number, decay: number) => {
    const rate = ctx.sampleRate;
    const length = rate * duration;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }, []);

 const createDistortionCurve = useCallback((drive: number) => {
    const samples = 44100;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }, []);

  const createEffectChain = useCallback((ctx: AudioContext, effectType: EffectType, intensity: number) => {
    const amount = Math.min(1, Math.max(0, intensity));
    switch (effectType) {
      case 'ECHO': {
         const input = ctx.createGain();
        const delay = ctx.createDelay(1);
        delay.delayTime.value = 0.18 + amount * 0.35;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.25 + amount * 0.5;
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 2000 + amount * 4000;
        input.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(tone);
        return { input, output: tone, nodes: [input, delay, feedback, tone] };
      }
      case 'DELAY': {
        const input = ctx.createGain();
        const delay = ctx.createDelay(1);
        delay.delayTime.value = 0.08 + amount * 0.25;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.18 + amount * 0.45;
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 1500 + amount * 3500;
        input.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(tone);
        return { input, output: tone, nodes: [input, delay, feedback, tone] };
      }
      case 'REVERB': {
        const input = ctx.createGain();
        const preDelay = ctx.createDelay(0.3);
        const convolver = ctx.createConvolver();
        const duration = 1.4 + amount * 2.2;
        const decay = 1.6 + amount * 2.2;
        preDelay.delayTime.value = 0.02 + amount * 0.12;
        convolver.buffer = buildReverbImpulse(ctx, duration, decay);
        input.connect(preDelay);
        preDelay.connect(convolver);
        return { input, output: convolver, nodes: [input, preDelay, convolver] };
      }
      case 'FLANGER': {
        const input = ctx.createGain();
        const delay = ctx.createDelay(0.02);
        delay.delayTime.value = 0.002 + amount * 0.004;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.15 + amount * 0.8;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.0008 + amount * 0.003;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.1 + amount * 0.45;
        input.connect(delay);
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        delay.connect(feedback);
        feedback.connect(delay);
        lfo.start();
        return {
          input,
          output: delay,
          nodes: [input, delay, lfo, lfoGain, feedback],
          dispose: () => lfo.stop()
        };
      }
      case 'PHASER': {
        const input = ctx.createGain();
        const stages = Array.from({ length: 4 }, () => {
          const filter = ctx.createBiquadFilter();
          filter.type = 'allpass';
          filter.frequency.value = 400 + amount * 900;
          filter.Q.value = 0.6 + amount * 0.8;
          return filter;
        });
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.1 + amount * 0.9;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 200 + amount * 1200;
        lfo.connect(lfoGain);
        stages.forEach(stage => lfoGain.connect(stage.frequency));
        lfo.start();
        input.connect(stages[0]);
        stages.reduce((prev, current) => {
          prev.connect(current);
          return current;
        });
        return {
          input,
          output: stages[stages.length - 1],
          nodes: [input, ...stages, lfo, lfoGain],
          dispose: () => lfo.stop()
        };
      }
      case 'CRUSH': {
        const input = ctx.createGain();
        const shaper = ctx.createWaveShaper();
        const drive = 1 + amount * 18;
        shaper.curve = createDistortionCurve(drive);
        shaper.oversample = '4x';
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 1200 + (1 - amount) * 5000;
        input.connect(shaper);
        shaper.connect(tone);
        return { input, output: tone, nodes: [input, shaper, tone] };
      }
      default:
        return [];
        return null;
    }
  }, [buildReverbImpulse, createDistortionCurve]);

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
  }, [clearEffectChain, createEffectChain, effectIntensity]);

  // Sync EQ nodes with props
   useEffect(() => {
    if (nodesRef.current && audioCtxRef.current) {
      const { low, mid, hi, filter } = nodesRef.current;
      const now = audioCtxRef.current.currentTime;
      const ramp = 0.05;

      // Map 0-2 to -12dB to +12dB
      low.gain.setTargetAtTime((eq.low - 1.0) * 12, now, ramp);
      mid.gain.setTargetAtTime((eq.mid - 1.0) * 12, now, ramp);
      hi.gain.setTargetAtTime((eq.hi - 1.0) * 12, now, ramp);

      // Bi-polar filter knob
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
  }, [applyEffectChain, effect, effectIntensity]);
  
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
    const newRate = Math.min(1.5, Math.max(0.5, rate));
    
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

  const getPlaybackRateFromPointer = useCallback((clientY: number) => {
    if (!tempoContainerRef.current) return null;
    const rect = tempoContainerRef.current.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    const rate = 1.5 - ratio;
    return Math.min(1.5, Math.max(0.5, rate));
  }, []);

  const handleTempoPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!tempoContainerRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    tempoContainerRef.current.setPointerCapture(event.pointerId);
    tempoPointerIdRef.current = event.pointerId;
    tempoDraggingRef.current = true;
    const rate = getPlaybackRateFromPointer(event.clientY);
    if (rate !== null) updatePlaybackRate(rate);
  }, [getPlaybackRateFromPointer, updatePlaybackRate]);

  const handleTempoPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!tempoDraggingRef.current) return;
    if (tempoPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    const rate = getPlaybackRateFromPointer(event.clientY);
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

    const analyzeLocalBpm = async (url: string) => {
    try {
      setIsScanning(true);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const existingContext = audioCtxRef.current;
      const tempContext = existingContext ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0));
      const bpm = detectBpmFromAudioBuffer(audioBuffer);
      if (bpm) {
        setState(s => ({ ...s, bpm }));
      }
      if (!existingContext) {
        await tempContext.close();
      }
    } catch (e) {
      console.warn('Local BPM detection failed:', e);
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

  const togglePlay = useCallback(() => {
    // Resume context if suspended (browser policy)
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    
    if (state.sourceType === 'youtube') {
      state.playing ? playerRef.current?.pauseVideo() : playerRef.current?.playVideo();
    } else {
      state.playing ? localAudioRef.current?.pause() : localAudioRef.current?.play();
    }
  }, [state.playing, state.sourceType]);

  const initPlayer = useCallback((videoId: string) => {
    if (!window.YT || !window.YT.Player) {
      setTimeout(() => initPlayer(videoId), 500);
      return;
    }

    if (playerRef.current) {
      try {
        // Reset state for existing player to avoid GUI freeze/glitch
        setState(s => ({ 
          ...s, 
          videoId, 
          isReady: false, 
          sourceType: 'youtube', 
          playbackRate: 1.0,
          playing: false,
          currentTime: 0,
          loopActive: false
        }));
        playerRef.current.loadVideoById(videoId);
        setIsLoading(true);
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
            setIsLoading(false); // Ensure loader clears
          }

          if (playerState === window.YT.PlayerState.ENDED) {
            setState(s => ({ ...s, playing: false }));
            onTrackEnd?.();
          }
        },
      }
    });
  }, [containerId, onPlayerReady, onTrackEnd, updateMetadata, state.playbackRate]);

  const loadLocalFile = (url: string, metadata?: { title?: string, author?: string }) => {
    // Only init if not already done
    initAudioEngine();
    setIsLoading(true);
    
    // Pause any existing YT stream
    if (playerRef.current && state.sourceType === 'youtube') {
      try { playerRef.current.pauseVideo(); } catch(e) {}
    }
    
    if (localAudioRef.current) {
      // Clear current source to prevent memory leak / ghost audio
      localAudioRef.current.pause();
      localAudioRef.current.src = url;
      localAudioRef.current.load();
      
      const onLoaded = () => {
        setState(s => ({
          ...s,
          isReady: true,
          sourceType: 'local',
          duration: localAudioRef.current?.duration || 0,
          title: metadata?.title || url.split('/').pop() || 'Local Track',
          author: metadata?.author || 'Local File',
          videoId: `local_${Date.now()}`,
          playbackRate: 1.0,
          playing: false,
          currentTime: 0,
          loopActive: false
        }));

        
        analyzeLocalBpm(url);
        
        onPlayerReady({
          setVolume: (v: number) => { if(localAudioRef.current) localAudioRef.current.volume = v / 100; },
          playVideo: () => localAudioRef.current?.play(),
          pauseVideo: () => localAudioRef.current?.pause(),
          seekTo: (t: number) => { if(localAudioRef.current) localAudioRef.current.currentTime = t; },
          setPlaybackRate: (r: number) => { if(localAudioRef.current) localAudioRef.current.playbackRate = r; }
        });
        
        setIsLoading(false);
        localAudioRef.current?.removeEventListener('loadedmetadata', onLoaded);
      };
      
      localAudioRef.current.addEventListener('loadedmetadata', onLoaded);
    }
  };

  useImperativeHandle(ref, () => ({
    loadVideo: (url: string, sourceType: TrackSourceType = 'youtube', metadata?: { title?: string, author?: string }) => {
      if (sourceType === 'local') {
        loadLocalFile(url, metadata);
      } else {
        const vid = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
        if (vid) { 
          initPlayer(vid); 
          if (metadata) {
            setState(s => ({ ...s, title: metadata.title, author: metadata.author }));
          }
        }
      }
    },
    togglePlay,
    triggerHotCue: handleHotCue,
    toggleLoop: handleToggleLoop,
    setPlaybackRate: updatePlaybackRate
  }), [initPlayer, togglePlay, handleHotCue, handleToggleLoop, updatePlaybackRate, initAudioEngine]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (state.isReady) {
        let t = 0;
        if (state.sourceType === 'youtube' && playerRef.current) {
          try { t = playerRef.current.getCurrentTime(); } catch (e) {}
        } else if (state.sourceType === 'local' && localAudioRef.current) {
          t = localAudioRef.current.currentTime;
        }

        if (state.loopActive && t >= state.loopEnd) {
          if (state.sourceType === 'youtube') playerRef.current?.seekTo(state.loopStart, true);
          else if (localAudioRef.current) localAudioRef.current.currentTime = state.loopStart;
        }
        setState(s => ({ ...s, currentTime: t }));
      }
    }, 100);
    return () => clearInterval(interval);
  }, [state.isReady, state.loopActive, state.loopStart, state.loopEnd, state.sourceType]);

  useEffect(() => { onStateUpdate(state); }, [state, onStateUpdate]);

  const handleTap = () => {
    const now = Date.now();
    const newHistory = [...tapHistory, now].slice(-4);
    setTapHistory(newHistory);
    if (newHistory.length >= 2) {
      const intervals = [];
      for (let i = 1; i < newHistory.length; i++) intervals.push(newHistory[i] - newHistory[i - 1]);
      const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
      setState(s => ({ ...s, bpm: Math.round(60000 / avgInterval) }));
    }
  };

  return (
    <div className="m3-card bg-[#1D1B20] border-white/5 flex flex-col gap-4 shadow-2xl transition-all hover:border-[#D0BCFF]/20 relative overflow-hidden min-w-[420px]">
      <div className="m3-card deck-card bg-[#1D1B20] border-white/5 flex flex-col gap-4 shadow-2xl transition-all hover:border-[#D0BCFF]/20 relative overflow-hidden">
        <div id={containerId} />
      </div>
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
      
      <div className="flex gap-4">
        {/* Main Deck Controls Area */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <div className={`w-3 h-3 rounded-full ${state.playing ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
              <div className="text-4xl font-black" style={{ color }}>{id}</div>
            </div>
            <div className="text-right min-w-0 flex-1 overflow-hidden">
              <MarqueeText text={state.title || 'Deck Ready'} className="text-sm font-bold text-white uppercase tracking-tight" />
              <MarqueeText 
                text={state.author || (state.sourceType === 'local' ? 'Local Media' : 'Insert Media')} 
                className="text-[10px] text-gray-500 font-bold uppercase tracking-widest opacity-80" 
              />
            </div>
          </div>

          <div className="flex justify-between items-center px-4 py-2 bg-black/30 rounded-2xl border border-white/5">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1">
                <div className={`text-3xl font-black mono ${isScanning ? 'animate-pulse text-gray-400' : ''}`} style={!isScanning ? { color } : {}}>
                  {(state.bpm * state.playbackRate).toFixed(1)}
                </div>
                <div className="text-[10px] text-gray-500 font-black uppercase">BPM</div>
              </div>
              <div className="text-[10px] text-gray-600 font-black uppercase tracking-widest">Key: <span className="text-white/80">{state.musicalKey}</span></div>
            </div>
            <button onClick={handleTap} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white">TAP</button>
          </div>

          <div className="flex items-center justify-center py-1">
            <button
              onClick={togglePlay}
              disabled={!state.isReady}
              className={`w-20 h-20 rounded-full bg-black border-[3px] flex items-center justify-center transition-all ${state.playing ? 'border-[#D0BCFF] shadow-[0_0_30px_rgba(208,188,255,0.2)]' : 'border-white/10'}`}
            >
              <span className="material-icons text-4xl text-white">{state.playing ? 'pause' : 'play_arrow'}</span>
            </button>
          </div>

          <Waveform 
            isPlaying={state.playing} 
            volume={state.volume * (0.5 + state.eqLow * 0.5)} 
            color={color} 
            playbackRate={state.playbackRate} 
          />

          <div className="space-y-1">
            <div className="flex justify-between text-[9px] font-black uppercase text-gray-600 px-1">
              <span>Timeline</span>
            <button
                type="button"
                onClick={() => setShowRemaining(prev => !prev)}
                className="mono text-gray-400 hover:text-white transition-colors"
                title="Toggle time display"
              >
                {showRemaining
                  ? `-${formatTime(state.duration - state.currentTime)}`
                  : formatTime(state.currentTime)}
              </button>
            </div>
            <div 
              className="h-6 bg-black/50 rounded-lg relative cursor-pointer overflow-hidden border border-white/10"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                const time = pct * state.duration;
                if (state.sourceType === 'youtube') playerRef.current?.seekTo(time, true);
                else if (localAudioRef.current) localAudioRef.current.currentTime = time;
              }}
            >
              <div className="absolute inset-y-0 left-0 opacity-20" style={{ width: `${(state.currentTime / (state.duration || 1)) * 100}%`, backgroundColor: color }} />
              {state.hotCues.map((cue, idx) => cue !== null && (
                <div key={idx} className="absolute inset-y-0 w-[3px] z-20" style={{ left: `${(cue / (state.duration || 1)) * 100}%`, backgroundColor: CUE_COLORS[idx] }} />
              ))}
              <div className="absolute inset-y-0 w-0.5 bg-white z-30 shadow-[0_0_10px_white]" style={{ left: `${(state.currentTime / (state.duration || 1)) * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Improved Pitch / Tempo Fader */}
        <div 
          ref={tempoContainerRef}
          className="w-12 bg-black/20 rounded-xl border border-white/5 flex flex-col items-center py-4 gap-2 relative group select-none transition-all hover:border-white/20 active:border-[#D0BCFF]/30"
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
          title="Click/Drag to Pitch • Scroll for Fine-Tune • Double-click to Reset"
        >
           <div className="text-[8px] font-black text-gray-500 uppercase tracking-tighter vertical-text h-10 mb-2">Tempo</div>
           
           <div className="flex-1 w-full flex justify-center relative py-2">
              <div className="absolute inset-y-2 left-2 flex flex-col justify-between items-center pointer-events-none opacity-20">
                {[...Array(11)].map((_, i) => (
                  <div key={i} className={`h-px bg-white ${i % 5 === 0 ? 'w-3' : 'w-1.5'}`} />
                ))}
              </div>

              <div className="h-full w-8 relative flex items-center justify-center cursor-ns-resize">
                <div
                  className="absolute w-10 h-10 bg-[#323038] rounded-md border-2 border-white/20 shadow-[0_8px_16px_rgba(0,0,0,0.6)] flex items-center justify-center transition-all duration-75 pointer-events-none z-10"
                  style={{
                    top: `${(1.5 - state.playbackRate) * 100}%`,
                    transform: 'translateY(-50%)'
                  }}
                >
                  <div className="w-6 h-[2px] bg-[#D0BCFF] shadow-[0_0_8px_#D0BCFF]" />
                </div>

                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.0001"
                  value={state.playbackRate}
                   onInput={(e) => updatePlaybackRate(parseFloat(e.currentTarget.value))}
                  className="absolute inset-0 cursor-pointer z-20 h-full w-full opacity-0"
                  style={{ WebkitAppearance: 'slider-vertical', appearance: 'slider-vertical' as any }}
                />
              </div>
           </div>

           <div className="flex flex-col items-center gap-0.5 pb-2">
             <div className={`text-[9px] font-black mono transition-all ${Math.abs(state.playbackRate - 1.0) < 0.001 ? 'text-[#D0BCFF] scale-110' : 'text-gray-500'}`}>
                {((state.playbackRate - 1.0) * 100).toFixed(2)}%
             </div>
             <div className={`w-1.5 h-1.5 rounded-full transition-all ${Math.abs(state.playbackRate - 1.0) < 0.001 ? 'bg-[#D0BCFF] shadow-[0_0_8px_#D0BCFF]' : 'bg-transparent'}`} />
           </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="bg-black/20 p-2 rounded-xl border border-white/5 space-y-2">
          <div className="flex justify-between items-center px-1">
             <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest">Hot Cues</div>
             <div className="text-[7px] text-gray-700 font-black uppercase">Shift + Click to Clear</div>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <button 
                key={i} 
                onClick={(e) => handleHotCue(i, e.shiftKey)} 
                className={`h-8 rounded-lg font-black text-[10px] border transition-all ${state.hotCues[i] !== null ? 'text-black' : 'border-white/5 text-gray-700 hover:border-white/20'}`} 
                style={state.hotCues[i] !== null ? { backgroundColor: CUE_COLORS[i], borderColor: CUE_COLORS[i], boxShadow: `0 0 10px ${CUE_COLORS[i]}44` } : {}}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-black/20 p-2 rounded-xl border border-white/5 space-y-2">
          <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest px-1">Loops</div>
          <div className="grid grid-cols-4 gap-1">
            {[2, 4, 8, 16].map((b) => (
              <button key={b} onClick={() => handleToggleLoop(b)} className={`h-7 rounded-lg text-[10px] font-black border transition-all ${state.loopActive && Math.abs((state.loopEnd - state.loopStart) - b * (60 / state.bpm)) < 0.1 ? 'bg-green-500 text-black border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]' : 'border-white/5 text-gray-500 hover:text-white hover:border-white/20'}`}>{b}</button>
            ))}
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
});

export default Deck;
