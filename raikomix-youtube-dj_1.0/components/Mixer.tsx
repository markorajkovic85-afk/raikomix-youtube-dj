
import React, { useState, useEffect, useRef } from 'react';
import { CrossfaderCurv, EffectTypee } from '../types';

interface MixerProps {
  crossfader: number;
  onCrossfaderChange: (val: number) => void;
  crossfaderCurve: CrossfaderCurve;
  onCurveChange: (curve: CrossfaderCurve) => void;
  masterVolume: number;
  onMasterVolumeChange: (val: number) => void;
  deckAVolume: number;
  onDeckAVolumeChange: (val: number) => void;
  deckBVolume: number;
  onDeckBVolumeChange: (val: number) => void;
  deckAPlaying: boolean;
  deckBPlaying: boolean;
  deckAEq: { hi: number, mid: number, low: number, filter: number };
  deckBEq: { hi: number, mid: number, low: number, filter: number };
  onDeckAEqChange: (key: string, val: number) => void;
  onDeckBEqChange: (key: string, val: number) => void;
    deckAEffect: EffectType;
  onDeckAEffectChange: (effect: EffectType) => void;
  deckAEffectWet: number;
  onDeckAEffectWetChange: (val: number) => void;
  deckBEffect: EffectType;
  onDeckBEffectChange: (effect: EffectType) => void;
  deckBEffectWet: number;
  onDeckBEffectWetChange: (val: number) => void;
}

const EffectSelector: React.FC<{
  label: string;
  value: EffectType;
  onChange: (effect: EffectType) => void;
  wetValue: number;
  onWetChange: (val: number) => void;
}> = ({ label, value, onChange, wetValue, onWetChange }) => {
  const effects: EffectType[] = ['NONE', 'ECHO', 'DELAY', 'REVERB', 'FLANGER', 'PHASER', 'CRUSH'];
  
  return (
    <div className="flex flex-col items-center gap-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as EffectType)}
        className="bg-[#1D1B20] text-white text-[8px] font-mono px-2 py-1 rounded border border-white/10 hover:border-purple-500/50 transition-colors cursor-pointer"
      >
        {effects.map(fx => (
          <option key={fx} value={fx}>{fx}</option>
        ))}
      </select>
      {value !== 'NONE' && (
        <Knob 
          label="WET"
          value={wetValue}
          onChange={onWetChange}
          color="#A855F7"
          min={0}
          max={1}
          defaultValue={0.5}
          size="sm"
        />
      )}
      <span className="text-[6px] font-black uppercase tracking-tighter text-gray-500">{label}</span>
    </div>
  );
};

const Knob: React.FC<{
  label: string,
  value: number,
  onChange: (val: number) => void,
  color: string,
  min?: number,
  max?: number,
  defaultValue?: number,
  size?: 'sm' | 'md'
}> = ({ label, value, onChange, color, min = 0, max = 2, defaultValue = 1, size = 'md' }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(0);
  const knobRef = useRef<HTMLDivElement>(null);
  const knobSize = size === 'sm' ? 'w-9 h-9' : 'w-11 h-11';
  const innerSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    startY.current = clientY;
    startVal.current = value;
    document.body.style.cursor = 'ns-resize';
  };

  const handleDoubleClick = () => onChange(defaultValue);

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.002;
    const newVal = Math.min(max, Math.max(min, value + delta));
    onChange(newVal);
  };

  useEffect(() => {
    const el = knobRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el?.removeEventListener('wheel', handleWheel);
  }, [value, onChange, min, max]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const deltaY = startY.current - clientY;
      const sensitivity = 0.007;
      const newVal = Math.min(max, Math.max(min, startVal.current + deltaY * sensitivity));
      onChange(newVal);
    };
    const handleEnd = () => {
      setIsDragging(false);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
    };
  }, [isDragging, min, max, onChange]);

  const rotation = ((value - min) / (max - min)) * 270 - 135;
  const progress = (value - min) / (max - min);

  return (
    <div className="flex flex-col items-center gap-0 group select-none">
      <div 
        ref={knobRef}
        className={`relative ${knobSize} flex items-center justify-center cursor-ns-resize transition-transform duration-150 ${isDragging ? 'scale-110' : ''}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" className="fill-none stroke-black/60 stroke-[8]" />
          <circle 
            cx="50" cy="50" r="40" 
            className="fill-none stroke-[10] transition-all duration-300" 
            style={{ 
              stroke: color, 
              strokeDasharray: '251.2', 
              strokeDashoffset: 251.2 - (251.2 * progress),
              opacity: isDragging ? 1 : 0.6
            }} 
          />
        </svg>
        <div 
          className={`absolute ${innerSize} bg-[#1D1B20] rounded-full border border-white/10 shadow-lg flex items-center justify-center transition-transform duration-75 pointer-events-none ${isDragging ? 'border-white/40' : ''}`}
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <div className="w-0.5 h-2.5 bg-white/60 absolute top-0.5 rounded-full" />
        </div>
      </div>
      <span className={`text-[6px] font-black uppercase tracking-tighter transition-colors pointer-events-none ${isDragging ? 'text-white' : 'text-gray-500 group-hover:text-white/60'}`}>{label}</span>
    </div>
  );
};

const Fader: React.FC<{
  label: string,
  value: number,
  onChange: (val: number) => void,
  color: string,
  height?: string
}> = ({ label, value, onChange, color, height = 'h-28' }) => {
  const faderRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.0006;
    const newVal = Math.min(1, Math.max(0, value + delta));
    onChange(newVal);
  };

  useEffect(() => {
    const el = faderRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el?.removeEventListener('wheel', handleWheel);
  }, [value, onChange]);

  return (
    <div className="flex flex-col items-center gap-1.5 w-full group relative">
       <div 
         ref={faderRef}
         className={`${height} w-6 bg-black/40 rounded-lg relative flex items-end p-0.5 border border-white/5 overflow-hidden cursor-ns-resize shadow-inner`}
       >
          <div 
            className="w-full rounded transition-all duration-75" 
            style={{ 
              height: `${value * 100}%`,
              backgroundColor: color,
              boxShadow: `0 0 15px ${color}66`
            }} 
          />
          <input 
             type="range" min="0" max="1" step="0.001" value={value} 
             onChange={(e) => onChange(parseFloat(e.target.value))} 
             onDoubleClick={() => onChange(0.8)}
             className="absolute inset-0 opacity-0 cursor-pointer z-20"
             style={{ WebkitAppearance: 'slider-vertical', appearance: 'slider-vertical' as any }}
          />
       </div>
       <label className="text-[7px] font-black uppercase tracking-widest" style={{ color: `${color}99` }}>{label}</label>
    </div>
  );
};

const Mixer: React.FC<MixerProps> = ({ 
  crossfader, onCrossfaderChange, crossfaderCurve, onCurveChange,
  masterVolume, onMasterVolumeChange, deckAVolume, onDeckAVolumeChange, deckBVolume, onDeckBVolumeChange,
  deckAPlaying, deckBPlaying,
  deckAEq, deckBEq, onDeckAEqChange, onDeckBEqChange
}) => {
  const [cueA, setCueA] = useState(false);
  const [cueB, setCueB] = useState(false);
  const crossfaderRef = useRef<HTMLDivElement>(null);

  // Mouse wheel support for smooth transitions
  useEffect(() => {
    const el = crossfaderRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Professional DJ sensitivity for crossfader: refined delta multiplier for precise control
      const sensitivity = 0.0012; 
      const delta = e.deltaY * -sensitivity;
      const newVal = Math.min(1, Math.max(-1, crossfader + delta));
      onCrossfaderChange(newVal);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [crossfader, onCrossfaderChange]);

  return (
    <div className="m3-card h-full flex flex-col bg-[#1D1B20] shadow-2xl border-white/5 w-[280px] shrink-0 p-2 select-none" role="region" aria-label="Mixer Controls">
      <div className="flex flex-col items-center gap-0 border-b border-white/5 pb-1 mb-2">
        <h2 className="text-[8px] font-black uppercase tracking-[0.4em] text-[#D0BCFF]">Mixing Console</h2>
      </div>

      <div className="flex-1 flex justify-between gap-1 overflow-hidden">
        {/* Channel A Section */}
        <div className="flex flex-col items-center gap-2 bg-black/10 p-1.5 rounded-xl flex-1 border border-white/5">
          <div className="flex flex-col items-center gap-1.5 w-full">
            <Knob label="Trim" value={1} onChange={() => {}} color="#D0BCFF" size="sm" defaultValue={1} />
            <div className="w-full h-px bg-white/5" />
            <div className="flex flex-col gap-1.5">
              <Knob label="Hi" value={deckAEq.hi} onChange={(v) => onDeckAEqChange('hi', v)} color="#D0BCFF" />
              <Knob label="Mid" value={deckAEq.mid} onChange={(v) => onDeckAEqChange('mid', v)} color="#D0BCFF" />
              <Knob label="Low" value={deckAEq.low} onChange={(v) => onDeckAEqChange('low', v)} color="#D0BCFF" />
              <Knob label="Color" value={deckAEq.filter} onChange={(v) => onDeckAEqChange('filter', v)} color="#D0BCFF" min={-1} max={1} defaultValue={0} />
            </div>
          </div>
          
        {/* Effect Controls */}
        <div className="flex gap-4 mt-2">
          <EffectSelector
            label="DECK A FX"
            value={deckAEffect}
            onChange={onDeckAEffectChange}
            wetValue={deckAEffectWet}
            onWetChange={onDeckAEffectWetChange}
          />
        </div>

          <button 
            onClick={() => setCueA(!cueA)}
            className={`w-10 h-5 rounded-md text-[7px] font-black uppercase tracking-tighter transition-all border ${cueA ? 'bg-orange-500 border-orange-400 text-white shadow-[0_0_8px_rgba(249,115,22,0.4)]' : 'bg-black/40 border-white/5 text-gray-500'}`}
          >
            Cue
          </button>
          
          <Fader label="A" value={deckAVolume} onChange={onDeckAVolumeChange} color="#D0BCFF" />
        </div>

        {/* Master Section */}
        <div className="flex flex-col items-center gap-2 py-2 px-0.5 w-10 bg-black/30 rounded-xl border border-white/5 mx-0.5">
           <div className="flex flex-col gap-0.5 items-center flex-1 py-1">
             {[...Array(20)].reverse().map((_, i) => {
               const isActive = (deckAPlaying || deckBPlaying) && (Math.random() > (i / 20));
               let barColor = 'bg-green-900/10';
               if (isActive) {
                 if (i > 16) barColor = 'bg-red-500 shadow-[0_0_6px_red]';
                 else if (i > 12) barColor = 'bg-orange-500 shadow-[0_0_4px_orange]';
                 else barColor = 'bg-green-500 shadow-[0_0_3px_#22c55e]';
               }
               return <div key={i} className={`w-2 h-0.5 rounded-[0.5px] transition-all duration-75 ${barColor}`} />;
             })}
           </div>
           
           <Fader label="MST" value={masterVolume} onChange={onMasterVolumeChange} color="#FFFFFF" height="h-20" />
        </div>

        {/* Channel B Section */}
        <div className="flex flex-col items-center gap-2 bg-black/10 p-1.5 rounded-xl flex-1 border border-white/5">
          <div className="flex flex-col items-center gap-1.5 w-full">
            <Knob label="Trim" value={1} onChange={() => {}} color="#F2B8B5" size="sm" defaultValue={1} />
            <div className="w-full h-px bg-white/5" />
            <div className="flex flex-col gap-1.5">
              <Knob label="Hi" value={deckBEq.hi} onChange={(v) => onDeckBEqChange('hi', v)} color="#F2B8B5" />
              <Knob label="Mid" value={deckBEq.mid} onChange={(v) => onDeckBEqChange('mid', v)} color="#F2B8B5" />
              <Knob label="Low" value={deckBEq.low} onChange={(v) => onDeckBEqChange('low', v)} color="#F2B8B5" />
              <Knob label="Color" value={deckBEq.filter} onChange={(v) => onDeckBEqChange('filter', v)} color="#F2B8B5" min={-1} max={1} defaultValue={0} />
            </div>
            
        {/* Effect Controls */}
        <div className="flex gap-4 mt-2">
          <EffectSelector
            label="DECK B FX"
            value={deckBEffect}
            onChange={onDeckBEffectChange}
            wetValue={deckBEffectWet}
            onWetChange={onDeckBEffectWetChange}
          />
        </div>
          </div>

          <button 
            onClick={() => setCueB(!cueB)}
            className={`w-10 h-5 rounded-md text-[7px] font-black uppercase tracking-tighter transition-all border ${cueB ? 'bg-orange-500 border-orange-400 text-white shadow-[0_0_8px_rgba(249,115,22,0.4)]' : 'bg-black/40 border-white/5 text-gray-500'}`}
          >
            Cue
          </button>

          <Fader label="B" value={deckBVolume} onChange={onDeckBVolumeChange} color="#F2B8B5" />
        </div>
      </div>

      {/* Crossfader Section - Enhanced visual design */}
      <div className="mt-4 space-y-2 pt-2 border-t border-white/5 relative">
        <div className="flex justify-between gap-1 p-0.5 bg-black/30 rounded-lg mb-1">
          {['SMOOTH', 'CUT', 'DIP'].map(curve => (
            <button 
              key={curve} 
              onClick={() => onCurveChange(curve as CrossfaderCurve)} 
              className={`flex-1 py-1 text-[6px] font-black rounded-md transition-all ${crossfaderCurve === curve ? 'bg-[#D0BCFF] text-black shadow-lg' : 'text-gray-600 hover:text-gray-300'}`}
            >
              {curve}
            </button>
          ))}
        </div>
        
        {/* Redesigned Professional Crossfader with tactile feel */}
        <div 
          ref={crossfaderRef}
          className="bg-black/80 h-14 rounded-xl relative group flex items-center px-4 border border-white/10 shadow-[inset_0_4px_12px_rgba(0,0,0,0.8)] cursor-pointer overflow-hidden transition-all hover:border-white/20"
          onDoubleClick={() => onCrossfaderChange(0)}
          title="Scroll to Mix • Double-click to Center (50/0)"
        >
           {/* Precision Center indicator marker */}
           <div className="absolute left-1/2 -translate-x-1/2 w-[2px] h-6 bg-white/10 z-0 rounded-full" />
           
           {/* Visual track guides */}
           <div className="absolute inset-x-8 h-[1px] bg-white/5 top-1/2 -translate-y-1/2 pointer-events-none" />
           <div className="absolute left-10 w-[1px] h-3 bg-white/5 pointer-events-none" />
           <div className="absolute right-10 w-[1px] h-3 bg-white/5 pointer-events-none" />

           {/* Professional Aluminum-style Crossfader Handle */}
           <div 
             className="absolute top-1/2 -translate-y-1/2 w-20 h-11 bg-[#323038] rounded-md border border-white/20 shadow-[0_12px_24px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-150 z-10 group-hover:border-[#D0BCFF]/40 active:scale-95 active:shadow-inner"
             style={{ 
               left: `calc(1rem + ${(crossfader + 1) / 2} * (100% - 2rem - 5rem))`,
             }}
           >
             {/* Tactile Handle Ridges */}
             <div className="flex gap-[3px]">
               <div className="w-[1.5px] h-6 bg-black/60 rounded-full" />
               <div className="w-[1.5px] h-6 bg-white/20 rounded-full" />
               <div className="w-[1.5px] h-6 bg-black/60 rounded-full" />
             </div>
             
             {/* Visual percentage badge (appears on hover) */}
             <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#D0BCFF] text-black text-[9px] font-black px-2.5 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-all transform group-hover:-translate-y-1 pointer-events-none shadow-2xl border border-white/20 uppercase tracking-tighter whitespace-nowrap">
               {Math.abs(crossfader) < 0.01 ? '50% Center' : `${Math.round(((crossfader + 1) / 2) * 100)}%`}
             </div>
           </div>

           {/* Hidden range input for standard touch/click interactions */}
           <input 
             type="range" min="-1" max="1" step="0.001" value={crossfader} 
             onChange={(e) => onCrossfaderChange(parseFloat(e.target.value))} 
             className="absolute inset-0 opacity-0 cursor-pointer z-20"
           />
        </div>

        {/* Labels below the fader as seen in screenshots */}
        <div className="flex justify-between items-center px-1 mt-1 font-black uppercase tracking-[0.25em]">
           <span className={`text-[7px] transition-colors ${crossfader < -0.8 ? 'text-[#D0BCFF]' : 'text-gray-600'}`}>Deck A</span>
           <div className="flex flex-col items-center">
             <span className={`text-[9px] font-mono transition-all duration-200 ${Math.abs(crossfader) < 0.05 ? 'text-white scale-125 glow-white' : 'text-gray-700'}`}>0</span>
             <div className={`w-1 h-1 rounded-full transition-colors ${Math.abs(crossfader) < 0.05 ? 'bg-white shadow-[0_0_5px_white]' : 'bg-transparent'}`} />
           </div>
           <span className={`text-[7px] transition-colors ${crossfader > 0.8 ? 'text-[#F2B8B5]' : 'text-gray-600'}`}>Deck B</span>
        </div>
      </div>
    </div>
  );
};

export default Mixer;
