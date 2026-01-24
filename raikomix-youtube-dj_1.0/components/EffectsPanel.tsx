import React from 'react';
import { EffectType } from '../types';
import PerformancePads from './PerformancePads';
import RotaryKnob from './RotaryKnob';

interface EffectsPanelProps {
  activeEffect: EffectType | null;
  effectAmount: number;
  effectIntensity: number;
  onEffectToggle: (effect: EffectType | null) => void;
  onAmountChange: (amount: number) => void;
  onIntensityChange: (amount: number) => void;
  color: string;
  target: 'A' | 'B' | 'AB' | 'PADS';
  onTargetChange: (target: 'A' | 'B' | 'AB' | 'PADS') => void;
  mixedEffect?: boolean;
  mixedAmount?: boolean;
  mixedIntensity?: boolean;
  showStreamingNotice?: boolean;
  masterVolume: number;
  padEffect: EffectType | null;
  padEffectWet: number;
  padEffectIntensity: number;
  onNotify: (message: string, type?: 'info' | 'success' | 'error') => void;
}

const showResetToast = (sliderName: string) => {
  const toast = document.createElement('div');
  toast.textContent = `${sliderName} RESET`;
  toast.className = 'fixed bottom-10 left-1/2 -translate-x-1/2 bg-[#D0BCFF] text-[#381E72] px-6 py-3 rounded-full font-black text-[12px] uppercase tracking-widest z-[200] shadow-[0_0_30px_rgba(208,188,255,0.4)] border border-white/20 animate-fade-in';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 1200);
};

const EffectsPanel: React.FC<EffectsPanelProps> = ({
  activeEffect,
  effectAmount,
  onEffectToggle,
  onAmountChange,
  effectIntensity,
  onIntensityChange,
  color,
  target,
  onTargetChange,
  mixedEffect = false,
  mixedAmount = false,
  mixedIntensity = false,
  showStreamingNotice = false,
  masterVolume,
  padEffect,
  padEffectWet,
  padEffectIntensity,
  onNotify,
}) => {
  const effectSections: {
    label: string;
    effects: { label: string; value: EffectType | null; description: string }[];
    columns: number;
    accent: string;
  }[] = [
    {
      label: 'BYPASS',
      effects: [{ label: 'None', value: null, description: 'No effect applied' }],
      columns: 1,
      accent: '#D0BCFF',
    },
    {
      label: 'FILTERS',
      effects: [
        { label: 'HP Filter', value: 'HIGH_PASS', description: 'Removes low frequencies, brightens sound' },
        { label: 'LP Filter', value: 'LOW_PASS', description: 'Softens highs for warm, dulled tone' },
        { label: 'BP Filter', value: 'BAND_PASS', description: 'Telephone/radio style mid focus' },
      ],
      columns: 3,
      accent: '#6B8CFF',
    },
    {
      label: 'TIME',
      effects: [
        { label: 'Echo', value: 'ECHO', description: 'Spacious echo repeats with tone' },
        { label: 'Delay', value: 'DELAY', description: 'Tight rhythmic repeats' },
        { label: 'Reverb', value: 'REVERB', description: 'Roomy ambience and tail' },
      ],
      columns: 3,
      accent: '#00D1A7',
    },
    {
      label: 'MODULATION',
      effects: [
        { label: 'Flanger', value: 'FLANGER', description: 'Sweeping jet-like comb effect' },
        { label: 'Phaser', value: 'PHASER', description: 'Swirling phase movement' },
        { label: 'Chorus', value: 'CHORUS', description: 'Thickens sound with detuned copies' },
        { label: 'Tremolo', value: 'TREMOLO', description: 'Rhythmic volume pulsing' },
        { label: 'AutoPan', value: 'AUTO_PAN', description: 'Stereo movement left to right' },
      ],
      columns: 3,
      accent: '#D0BCFF',
    },
    {
      label: 'DISTORTION',
      effects: [
        { label: 'Crush', value: 'CRUSH', description: 'Aggressive tone crushing' },
        { label: 'Bitcrush', value: 'BITCRUSH', description: 'Lo-fi digital degradation' },
        { label: 'Overdrive', value: 'OVERDRIVE', description: 'Warm saturation and grit' },
      ],
      columns: 3,
      accent: '#FF8C42',
    },
    {
      label: 'DJ FX',
      effects: [
        { label: 'Sweep', value: 'FILTER_SWEEP', description: 'Automated build-up filter sweep' },
        { label: 'Gate', value: 'GATE', description: 'Rhythmic chopping effect' },
      ],
      columns: 2,
      accent: '#FF6B6B',
    },
  ];

  const renderEffectButton = (
    fx: { label: string; value: EffectType | null; description: string },
    accent: string
  ) => (
    <button
      key={fx.label}
      onClick={() => onEffectToggle(fx.value)}
      className={`py-2 rounded-lg text-[10px] font-black transition-all border uppercase tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
        activeEffect === fx.value
          ? 'bg-white/15 border-white/30 text-white'
          : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10 hover:text-white/50'
      }`}
      style={activeEffect === fx.value ? { borderColor: accent, color: accent } : undefined}
      title={fx.description}
      aria-label={`${fx.label} effect`}
    >
      {fx.label}
    </button>
  );

  return (
    <div className="bg-black/40 p-3 rounded-xl border border-white/5 relative z-10 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">FX Engine</p>
          <p className="text-[11px] font-semibold text-white/80">
            {mixedEffect ? 'Mixed effects' : activeEffect ? activeEffect : 'No effect'}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-black/40 rounded-full border border-white/10 p-1">
          {(['A', 'B', 'AB', 'PADS'] as const).map((option) => (
            <button
              key={option}
              onClick={() => onTargetChange(option)}
              className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition ${
                target === option ? 'text-black' : 'text-gray-500'
              }`}
              style={target === option ? { backgroundColor: color } : undefined}
            >
              {option === 'AB' ? 'A+B' : option}
            </button>
          ))}
        </div>
      </div>
      
      <div className="space-y-3">
        {effectSections.map((section) => (
          <div
            key={section.label}
            className="border border-white/5 rounded-lg p-2 bg-black/20 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-black uppercase tracking-[0.25em] text-gray-500">
                {section.label}
              </span>
              <span
                className="text-[8px] uppercase tracking-[0.25em]"
                style={{ color: section.accent }}
              >
                FX
              </span>
            </div>
            <div
              className={`grid gap-1.5 ${section.columns === 1 ? 'grid-cols-1' : ''} ${
                section.columns === 2 ? 'grid-cols-2' : ''
              } ${section.columns === 3 ? 'grid-cols-3' : ''}`}
            >
              {section.effects.map((fx) => renderEffectButton(fx, section.accent))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-white/5 pt-3">
        <div className="flex justify-center gap-8 px-4">
          <RotaryKnob
            label="INTENSITY"
            value={effectIntensity}
            onChange={onIntensityChange}
            color={color}
            disabled={!activeEffect}
            mixed={mixedIntensity}
            onReset={() => {
              onIntensityChange(0.5);
              showResetToast('FX INTENSITY');
            }}
          />
          <RotaryKnob
            label="WET / DRY"
            value={effectAmount}
            onChange={onAmountChange}
            color={color}
            disabled={!activeEffect}
            mixed={mixedAmount}
            onReset={() => {
              onAmountChange(0.5);
              showResetToast('FX WET/DRY');
            }}
          />
        </div>
        {showStreamingNotice && (
          <p className="text-[9px] text-white/40 uppercase tracking-widest px-1 text-center mt-2">
            Streaming FX unavailable
          </p>
        )}
      </div>

      <div className="border-t border-white/5 pt-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Pads</span>
          <span className="text-[8px] text-white/30 uppercase tracking-widest">Double-tap / click</span>
        </div>
        <PerformancePads
          masterVolume={masterVolume}
          isActive
          effect={padEffect}
          effectWet={padEffectWet}
          effectIntensity={padEffectIntensity}
          onNotify={onNotify}
        />
      </div>
    </div>
  );
};

export default EffectsPanel;
