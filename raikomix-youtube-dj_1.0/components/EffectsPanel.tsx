
import React from 'react';
import { EffectType } from '../types';

interface EffectsPanelProps {
  activeEffect: EffectType | null;
  effectAmount: number;
  onEffectToggle: (effect: EffectType) => void;
  onAmountChange: (amount: number) => void;
  color: string;
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
  color,
}) => {
  const effects: EffectType[] = ['ECHO', 'DELAY', 'REVERB', 'FLANGER', 'PHASER', 'CRUSH'];

  return (
    <div className="bg-black/40 p-4 rounded-xl border border-white/5 relative z-10">
      <div className="flex justify-between items-center mb-3 px-1">
        <div className="flex flex-col">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">FX Engine</label>
        </div>
        {activeEffect && (
          <span className="text-[9px] font-mono text-white/60 uppercase">
            <span style={{ color }}>{activeEffect}</span>
          </span>
        )}
      </div>
      
      <div className="grid grid-cols-3 gap-2">
        {effects.map((fx) => (
          <button
            key={fx}
            onClick={() => onEffectToggle(fx)}
            className={`py-2 rounded-lg text-[10px] font-black transition-all border uppercase tracking-tighter ${
              activeEffect === fx
                ? 'bg-white/10 border-white/40 text-white'
                : 'bg-white/5 border-white/5 text-gray-500 hover:bg-white/10 hover:text-white/30'
            }`}
            style={activeEffect === fx ? { borderColor: color, color: color } : {}}
          >
            {fx}
          </button>
        ))}
      </div>

      {activeEffect && (
        <div className="mt-4 pt-4 border-t border-white/5 animate-fade-in">
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Wet / Dry</span>
            <span className="text-[9px] font-mono text-white/40">{Math.round(effectAmount * 100)}%</span>
          </div>
          <div className="bg-black/20 p-2 rounded-full border border-white/5">
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
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default EffectsPanel;
