import { EffectType } from '../types';

interface EffectChain {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
  dispose?: () => void;
}

const buildReverbImpulse = (ctx: AudioContext, duration: number, decay: number) => {
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
};

const createDistortionCurve = (drive: number) => {
  const samples = 44100;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
};

const createBitcrusherCurve = (bitDepth: number) => {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const steps = Math.max(2, Math.pow(2, bitDepth));
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
};

export const createEffectChain = (ctx: AudioContext, effectType: EffectType, intensity: number): EffectChain | null => {
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
        dispose: () => lfo.stop(),
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
      stages.forEach((stage) => lfoGain.connect(stage.frequency));
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
        dispose: () => lfo.stop(),
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
    case 'HIGH_PASS': {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 80 + amount * 12000;
      filter.Q.value = 0.7 + amount * 1.2;
      input.connect(filter);
      return { input, output: filter, nodes: [input, filter] };
    }
    case 'LOW_PASS': {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000 - amount * 17000;
      filter.Q.value = 0.7 + amount * 1.1;
      input.connect(filter);
      return { input, output: filter, nodes: [input, filter] };
    }
    case 'BAND_PASS': {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 400 + amount * 2800;
      filter.Q.value = 1.2 + amount * 6;
      input.connect(filter);
      return { input, output: filter, nodes: [input, filter] };
    }
    case 'CHORUS': {
      const input = ctx.createGain();
      const mix = ctx.createGain();
      mix.gain.value = 0.7;
      const delays = [0.012, 0.017, 0.023].map((baseDelay, index) => {
        const delay = ctx.createDelay(0.05);
        delay.delayTime.value = baseDelay + amount * 0.004;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.2 + amount * (0.8 + index * 0.15);
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.002 + amount * 0.004;
        lfo.connect(lfoGain);
        lfoGain.connect(delay.delayTime);
        lfo.start();
        return { delay, lfo, lfoGain };
      });
      delays.forEach(({ delay }) => {
        input.connect(delay);
        delay.connect(mix);
      });
      const nodes: AudioNode[] = [input, mix];
      delays.forEach(({ delay, lfo, lfoGain }) => {
        nodes.push(delay, lfo, lfoGain);
      });
      return {
        input,
        output: mix,
        nodes,
        dispose: () => delays.forEach(({ lfo }) => lfo.stop()),
      };
    }
    case 'TREMOLO': {
      const input = ctx.createGain();
      const tremolo = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 2 + amount * 8;
      const depth = 0.2 + amount * 0.8;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth * 0.5;
      tremolo.gain.value = 1 - depth * 0.5;
      lfo.connect(lfoGain);
      lfoGain.connect(tremolo.gain);
      lfo.start();
      input.connect(tremolo);
      return {
        input,
        output: tremolo,
        nodes: [input, tremolo, lfo, lfoGain],
        dispose: () => lfo.stop(),
      };
    }
    case 'AUTO_PAN': {
      const input = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.2 + amount * 1.8;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.4 + amount * 0.6;
      lfo.connect(lfoGain);
      lfoGain.connect(panner.pan);
      lfo.start();
      input.connect(panner);
      return {
        input,
        output: panner,
        nodes: [input, panner, lfo, lfoGain],
        dispose: () => lfo.stop(),
      };
    }
    case 'BITCRUSH': {
      const input = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      const bitDepth = Math.round(12 - amount * 8);
      shaper.curve = createBitcrusherCurve(bitDepth);
      shaper.oversample = 'none';
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1000 + (1 - amount) * 8000;
      input.connect(shaper);
      shaper.connect(tone);
      return { input, output: tone, nodes: [input, shaper, tone] };
    }
    case 'OVERDRIVE': {
      const input = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      const drive = 2 + amount * 22;
      shaper.curve = createDistortionCurve(drive);
      shaper.oversample = '2x';
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 3000 + (1 - amount) * 8000;
      input.connect(shaper);
      shaper.connect(tone);
      return { input, output: tone, nodes: [input, shaper, tone] };
    }
    case 'FILTER_SWEEP': {
      const input = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.9 + amount * 1.1;
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = 0.08 + amount * 0.35;
      const sweepGain = ctx.createGain();
      const minFreq = 300;
      const maxFreq = 20000;
      sweepGain.gain.value = (maxFreq - minFreq) / 2;
      const sweepOffset = ctx.createConstantSource();
      sweepOffset.offset.value = (maxFreq + minFreq) / 2;
      lfo.connect(sweepGain);
      sweepGain.connect(filter.frequency);
      sweepOffset.connect(filter.frequency);
      lfo.start();
      sweepOffset.start();
      input.connect(filter);
      return {
        input,
        output: filter,
        nodes: [input, filter, lfo, sweepGain, sweepOffset],
        dispose: () => {
          lfo.stop();
          sweepOffset.stop();
        },
      };
    }
    case 'GATE': {
      const input = ctx.createGain();
      const gate = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 2 + amount * 10;
      const depth = 0.3 + amount * 0.7;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth * 0.5;
      gate.gain.value = 1 - depth * 0.5;
      lfo.connect(lfoGain);
      lfoGain.connect(gate.gain);
      lfo.start();
      input.connect(gate);
      return {
        input,
        output: gate,
        nodes: [input, gate, lfo, lfoGain],
        dispose: () => lfo.stop(),
      };
    }
    default:
      return null;
  }
};
