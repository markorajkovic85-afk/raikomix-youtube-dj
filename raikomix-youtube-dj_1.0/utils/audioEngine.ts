import { EffectType } from '../types';
import { createEffectChain } from './effectsChain';

type EQSettings = {
  low: number;
  mid: number;
  hi: number;
  filter: number;
};

type EffectNodes = {
  nodes: AudioNode[];
  dispose?: () => void;
};

export class DeckAudioEngine {
  private id: string;
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private nodes: {
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
  } | null = null;
  private effectNodes: EffectNodes | null = null;
  private currentEffect: EffectType | null = null;
  private currentIntensity = 0.5;
  private currentWet = 0.5;
  private currentEq: EQSettings = { low: 1, mid: 1, hi: 1, filter: 0 };

  constructor(id: string) {
    this.id = id;
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  initialize(element: HTMLMediaElement) {
    if (!element) return;
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.sourceNode || !this.ctx) return;

    const ctx = this.ctx;
    const source = ctx.createMediaElementSource(element);

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

    this.sourceNode = source;
    this.nodes = { low, mid, hi, filter, gain: gainNode, dryGain, wetGain, mixGain, effectInput, effectOutput };

    this.updateEQ(this.currentEq);
    this.updateWetDryMix(this.currentWet);
    this.applyEffect(this.currentEffect, this.currentIntensity);
  }

  private clearEffectChain() {
    if (!this.nodes) return;
    const { effectInput } = this.nodes;
    try {
      effectInput.disconnect();
    } catch (e) { }
    if (this.effectNodes) {
      this.effectNodes.nodes.forEach(node => {
        try {
          node.disconnect();
        } catch (e) { }
      });
      this.effectNodes.dispose?.();
    }
    this.effectNodes = null;
  }

  applyEffect(effectType: EffectType | null, intensity: number) {
    this.currentEffect = effectType;
    this.currentIntensity = intensity;
    if (!this.nodes || !this.ctx) return;
    const { effectInput, effectOutput } = this.nodes;
    this.clearEffectChain();

    if (!effectType) {
      effectInput.connect(effectOutput);
      return;
    }

    const chain = createEffectChain(this.ctx, effectType, intensity);
    if (!chain) {
      effectInput.connect(effectOutput);
      return;
    }
    this.effectNodes = { nodes: chain.nodes, dispose: chain.dispose };
    effectInput.connect(chain.input);
    chain.output.connect(effectOutput);
  }

  updateEQ(eq: EQSettings) {
    this.currentEq = eq;
    if (!this.nodes || !this.ctx) return;
    const { low, mid, hi, filter } = this.nodes;
    const now = this.ctx.currentTime;
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

  updateWetDryMix(wet: number) {
    this.currentWet = wet;
    if (!this.nodes || !this.ctx) return;
    const { dryGain, wetGain } = this.nodes;
    const clamped = Math.min(1, Math.max(0, wet));
    const now = this.ctx.currentTime;
    const ramp = 0.05;
    dryGain.gain.setTargetAtTime(Math.cos(clamped * Math.PI * 0.5), now, ramp);
    wetGain.gain.setTargetAtTime(Math.sin(clamped * Math.PI * 0.5), now, ramp);
  }

  resumeContext() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume();
    }
  }

  cleanup() {
    this.clearEffectChain();
    if (this.nodes) {
      const { low, mid, hi, filter, gain, dryGain, wetGain, mixGain, effectInput, effectOutput } = this.nodes;
      [low, mid, hi, filter, gain, dryGain, wetGain, mixGain, effectInput, effectOutput].forEach(node => {
        try {
          node.disconnect();
        } catch (e) { }
      });
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) { }
    }
    this.nodes = null;
    this.sourceNode = null;
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.ctx = null;
  }
}
