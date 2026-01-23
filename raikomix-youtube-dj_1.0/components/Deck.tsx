import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { DeckId, EffectType, PlayerState, TrackSourceType } from '../types';
import { createEffectChain } from '../utils/effectsChain';
import Waveform from './Waveform';
import { detectBpmFromAudioBuffer, extractBPMFromTitle } from '../utils/bpmDetection';
import { parseYouTubeTitle } from '../utils/youtubeApi';

interface DeckProps {
  id: DeckId;
  color: string;
  onStateUpdate: (state: PlayerState) => void;
  onPlayerReady: (player: any) => void;
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

const Deck = forwardRef<DeckHandle, DeckProps>(({ id, color, onStateUpdate, onPlayerReady, eq, effect, effectWet, effectIntensity }, ref) => {
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

  // ... rest of file unchanged ...
