/**
 * Deck Audio Engine
 * Manages Web Audio API lifecycle for deck audio processing
 * Fixes P0-3: Local File Playback Fails After Deck Switch
 */

import { EffectType } from '../types';
import { createEffectChain } from './effectsChain';

export interface AudioNodes {
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
}

export interface EffectChain {
  nodes: AudioNode[];
  input: AudioNode;
  output: AudioNode;
  dispose?: () => void;
}

/**
 * Deck Audio Engine
 * Handles audio context, source nodes, EQ chain, and effect routing
 */
export class DeckAudioEngine {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private nodes: AudioNodes | null = null;
  private effectChain: EffectChain | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private isInitialized = false;

  constructor(private readonly deckId: string) {
    console.log(`[AudioEngine ${deckId}] Created`);
  }

  /**
   * Initialize audio engine with audio element
   * CRITICAL: Always cleanup before initializing to prevent memory leaks
   */
  public initialize(audioElement: HTMLAudioElement): boolean {
    console.log(`[AudioEngine ${this.deckId}] Initialize called`);

    // CRITICAL: Clean up any existing connections first
    if (this.isInitialized) {
      console.log(`[AudioEngine ${this.deckId}] Already initialized, cleaning up first`);
      this.cleanup();
    }

    try {
      // Create audio context
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create media element source
      this.sourceNode = this.ctx.createMediaElementSource(audioElement);
      this.audioElement = audioElement;

      // Create audio processing graph
      this.nodes = this.createAudioGraph(this.ctx);

      // Connect the chain
      this.connectAudioGraph();

      this.isInitialized = true;
      console.log(`[AudioEngine ${this.deckId}] Initialized successfully`);
      return true;
    } catch (error) {
      console.error(`[AudioEngine ${this.deckId}] Initialization failed:`, error);
      this.cleanup();
      return false;
    }
  }

  /**
   * Create audio processing graph (EQ + effects routing)
   */
  private createAudioGraph(ctx: AudioContext): AudioNodes {
    // EQ filters
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

    // Bi-polar filter knob
    const filter = ctx.createBiquadFilter();
    filter.type = 'allpass';

    // Gain nodes
    const gain = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    const mixGain = ctx.createGain();
    const effectInput = ctx.createGain();
    const effectOutput = ctx.createGain();

    return {
      low,
      mid,
      hi,
      filter,
      gain,
      dryGain,
      wetGain,
      mixGain,
      effectInput,
      effectOutput
    };
  }

  /**
   * Connect audio processing graph
   */
  private connectAudioGraph(): void {
    if (!this.sourceNode || !this.nodes || !this.ctx) {
      console.error(`[AudioEngine ${this.deckId}] Cannot connect graph: missing components`);
      return;
    }

    const { low, mid, hi, filter, gain, dryGain, wetGain, mixGain, effectInput, effectOutput } = this.nodes;

    // Connection chain: source -> EQ -> filter -> dry/wet split -> mix -> master
    this.sourceNode.connect(low);
    low.connect(mid);
    mid.connect(hi);
    hi.connect(filter);
    
    // Split signal for dry/wet mixing
    filter.connect(dryGain);
    filter.connect(effectInput);
    
    // By default, connect effect input directly to output (no effect)
    effectInput.connect(effectOutput);
    
    // Mix dry and wet signals
    dryGain.connect(mixGain);
    effectOutput.connect(wetGain);
    wetGain.connect(mixGain);
    
    // Output to destination
    mixGain.connect(gain);
    gain.connect(this.ctx.destination);

    console.log(`[AudioEngine ${this.deckId}] Audio graph connected`);
  }

  /**
   * Apply effect chain
   */
  public applyEffect(effectType: EffectType | null, intensity: number = 0.5): void {
    if (!this.nodes || !this.ctx) {
      console.warn(`[AudioEngine ${this.deckId}] Cannot apply effect: not initialized`);
      return;
    }

    // Clear existing effect chain
    this.clearEffectChain();

    const { effectInput, effectOutput } = this.nodes;

    // If no effect, connect input directly to output
    if (!effectType) {
      effectInput.connect(effectOutput);
      console.log(`[AudioEngine ${this.deckId}] Effect cleared`);
      return;
    }

    // Create effect chain
    const chain = createEffectChain(this.ctx, effectType, intensity);
    if (!chain) {
      effectInput.connect(effectOutput);
      console.warn(`[AudioEngine ${this.deckId}] Failed to create effect chain`);
      return;
    }

    // Store effect chain reference
    this.effectChain = {
      nodes: chain.nodes,
      input: chain.input,
      output: chain.output,
      dispose: chain.dispose
    };

    // Connect effect chain
    effectInput.connect(chain.input);
    chain.output.connect(effectOutput);

    console.log(`[AudioEngine ${this.deckId}] Applied effect: ${effectType}`);
  }

  /**
   * Clear effect chain
   */
  private clearEffectChain(): void {
    if (!this.nodes) return;

    const { effectInput } = this.nodes;

    // Disconnect effect input
    try {
      effectInput.disconnect();
    } catch (e) {
      // Already disconnected
    }

    // Dispose effect nodes
    if (this.effectChain) {
      this.effectChain.nodes.forEach(node => {
        try {
          node.disconnect();
        } catch (e) {
          // Already disconnected
        }
      });

      // Call custom dispose function if provided
      this.effectChain.dispose?.();
      this.effectChain = null;
    }
  }

  /**
   * Update EQ settings
   */
  public updateEQ(eq: { low: number; mid: number; hi: number; filter: number }): void {
    if (!this.nodes || !this.ctx) return;

    const { low, mid, hi, filter } = this.nodes;
    const now = this.ctx.currentTime;
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

  /**
   * Update wet/dry mix
   */
  public updateWetDryMix(wetAmount: number): void {
    if (!this.nodes || !this.ctx) return;

    const { dryGain, wetGain } = this.nodes;
    const wet = Math.min(1, Math.max(0, wetAmount));
    const now = this.ctx.currentTime;
    const ramp = 0.05;

    // Equal-power crossfade
    dryGain.gain.setTargetAtTime(Math.cos(wet * Math.PI * 0.5), now, ramp);
    wetGain.gain.setTargetAtTime(Math.sin(wet * Math.PI * 0.5), now, ramp);
  }

  /**
   * Set master volume
   */
  public setVolume(volume: number): void {
    if (!this.nodes || !this.ctx) return;

    const { gain } = this.nodes;
    const now = this.ctx.currentTime;
    gain.gain.setTargetAtTime(volume, now, 0.05);
  }

  /**
   * Switch to a new audio element
   * CRITICAL: Proper cleanup before switching
   */
  public switchSource(newAudioElement: HTMLAudioElement): boolean {
    console.log(`[AudioEngine ${this.deckId}] Switching source`);
    
    // Cleanup existing connections
    this.cleanup();
    
    // Initialize with new element
    return this.initialize(newAudioElement);
  }

  /**
   * Cleanup all audio connections
   * CRITICAL: Must be called when switching sources or unmounting
   */
  public cleanup(): void {
    console.log(`[AudioEngine ${this.deckId}] Cleanup`);

    // Clear effect chain first
    this.clearEffectChain();

    // Disconnect source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {
        // Already disconnected
      }
      this.sourceNode = null;
    }

    // Disconnect all nodes
    if (this.nodes) {
      const nodeArray = Object.values(this.nodes);
      nodeArray.forEach(node => {
        try {
          node.disconnect();
        } catch (e) {
          // Already disconnected
        }
      });
      this.nodes = null;
    }

    // Don't close audio context as it may be shared
    // Just clear the reference
    this.ctx = null;
    this.audioElement = null;
    this.isInitialized = false;

    console.log(`[AudioEngine ${this.deckId}] Cleanup complete`);
  }

  /**
   * Resume audio context if suspended
   */
  public async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
        console.log(`[AudioEngine ${this.deckId}] Context resumed`);
      } catch (error) {
        console.error(`[AudioEngine ${this.deckId}] Failed to resume context:`, error);
      }
    }
  }

  /**
   * Get audio context
   */
  public getContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Get master gain node for volume control
   */
  public getMasterGain(): GainNode | null {
    return this.nodes?.gain || null;
  }

  /**
   * Check if initialized
   */
  public isReady(): boolean {
    return this.isInitialized && this.ctx !== null && this.sourceNode !== null;
  }
}
