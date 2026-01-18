import React from 'react';
import { EffectType } from '../types';
import PerformancePads from './PerformancePads';

interface EffectsPanelProps {
  activeEffect: EffectType | null;
  effectAmount: number;
  effectIntensity: number;
  onEffectToggle: (effect: EffectType | null) => void;
  onAmountChange: (amount: number) => void;
  onIntensityChange: (amount: number) => void;
  color: string;
  target: 'A' | 'B' | 'AB';
  onTargetChange: (target: 'A' | 'B' | 'AB') => void;
  mixedEffect?: boolean;
  mixedAmount?: boolean;
  mixedIntensity?: boolean;
  showStreamingNotice?: boolean;
  masterVolume: number;
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
  onNotify,
}) => {
  const effects: { label: string; value: EffectType | null }[] = [
    { label: 'None', value: null },
    { label: 'Echo', value: 'ECHO' },
    { label: 'Delay', value: 'DELAY' },
    { label: 'Reverb', value: 'REVERB' },
    { label: 'Flanger', value: 'FLANGER' },
    { label: 'Phaser', value: 'PHASER' },
    { label: 'Crush', value: 'CRUSH' },
  ];

  return (
    <div className="bg-black/40 p-4 rounded-xl border border-white/5 relative z-10 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">FX Engine</p>
          <p className="text-[11px] font-semibold text-white/80">
            {mixedEffect ? 'Mixed effects' : activeEffect ? activeEffect : 'No effect'}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-black/40 rounded-full border border-white/10 p-1">
          {(['A', 'B', 'AB'] as const).map((option) => (
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
      
      <div className="grid grid-cols-4 gap-2">
        {effects.map((fx) => (
          <button
            key={fx.label}
            onClick={() => onEffectToggle(fx.value)}
            className={`py-2 rounded-lg text-[10px] font-black transition-all border uppercase tracking-tight ${
              activeEffect === fx.value
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10 hover:text-white/50'
            }`}
            style={activeEffect === fx.value ? { borderColor: color, color } : undefined}
          >
            {fx.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 border-t border-white/5 pt-4">
        <div className="flex justify-between items-center px-1">
          <div>
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Intensity</span>
            {mixedIntensity && <span className="ml-2 text-[8px] text-white/40 uppercase">Mixed</span>}
          </div>
           <span className="text-[9px] font-mono text-white/50">{Math.round(effectIntensity * 100)}%</span>
        </div>
        <div className={`bg-black/20 p-2 rounded-full border border-white/5 ${!activeEffect ? 'opacity-40' : ''}`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={effectIntensity}
            onChange={(e) => onIntensityChange(parseFloat(e.target.value))}
            onDoubleClick={() => {
              onIntensityChange(0.5);
              showResetToast('FX INTENSITY');
            }}
            className="w-full accent-white h-2 cursor-pointer"
            style={{ accentColor: color }}
            title="Double-click to reset (50%)"
            disabled={!activeEffect}
          />
        </div>

        <div className="flex justify-between items-center px-1">
          <div>
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Wet / Dry</span>
            {mixedAmount && <span className="ml-2 text-[8px] text-white/40 uppercase">Mixed</span>}
          </div>
          <span className="text-[9px] font-mono text-white/50">{Math.round(effectAmount * 100)}%</span>
        </div>
        <div className={`bg-black/20 p-2 rounded-full border border-white/5 ${!activeEffect ? 'opacity-40' : ''}`}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={effectAmount}
            onChange={(e) => onAmountChange(parseFloat(e.target.value))}
            onDoubleClick={() => {
              onAmountChange(0.5);
              showResetToast('FX WET/DRY');
            }}
            className="w-full accent-white h-2 cursor-pointer"
            style={{ accentColor: color }}
            title="Double-click to reset (50%)"
            disabled={!activeEffect}
          />
        </div>
         {showStreamingNotice && (
          <p className="text-[9px] text-white/40 uppercase tracking-widest px-1">
            Streaming FX unavailable
          </p>
        )}
      </div>

      <div className="border-t border-white/5 pt-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Pads</span>
          <span className="text-[8px] text-white/30 uppercase tracking-widest">Hold / Click</span>
        </div>
        <PerformancePads masterVolume={masterVolume} isActive onNotify={onNotify} />
      </div>
    </div>
  );
};

export default EffectsPanel;
