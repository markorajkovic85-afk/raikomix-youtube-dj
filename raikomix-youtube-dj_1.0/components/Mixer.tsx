import React from 'react';
import Knob from './ui/Knob';
import Fader from './ui/Fader';
import Toggle from './ui/Toggle';
import { DeckId, CrossfaderCurve } from '../types';

interface MixerProps {
  crossfader: number;
  onCrossfaderChange: (v: number) => void;
  crossfaderCurve: CrossfaderCurve;
  onCurveChange: (c: CrossfaderCurve) => void;
  autoDjEnabled: boolean;
  onToggleAutoDj: () => void;
  mixLeadSeconds: number;
  mixDurationSeconds: number;
  onMixLeadChange: (v: number) => void;
  onMixDurationChange: (v: number) => void;
  queueLength: number;

  masterVolume: number;
  onMasterVolumeChange: (v: number) => void;
  deckAVolume: number;
  onDeckAVolumeChange: (v: number) => void;
  deckBVolume: number;
  onDeckBVolumeChange: (v: number) => void;
  deckAPlaying: boolean;
  deckBPlaying: boolean;

  deckATrim: number;
  deckBTrim: number;
  onDeckATrimChange: (v: number) => void;
  onDeckBTrimChange: (v: number) => void;

  deckAEq: { hi: number; mid: number; low: number; filter: number };
  deckBEq: { hi: number; mid: number; low: number; filter: number };
  onDeckAEqChange: (k: 'hi' | 'mid' | 'low' | 'filter', v: number) => void;
  onDeckBEqChange: (k: 'hi' | 'mid' | 'low' | 'filter', v: number) => void;
}

const Mixer: React.FC<MixerProps> = ({
  crossfader,
  onCrossfaderChange,
  crossfaderCurve,
  onCurveChange,
  autoDjEnabled,
  onToggleAutoDj,
  mixLeadSeconds,
  mixDurationSeconds,
  onMixLeadChange,
  onMixDurationChange,
  queueLength,

  masterVolume,
  onMasterVolumeChange,
  deckAVolume,
  onDeckAVolumeChange,
  deckBVolume,
  onDeckBVolumeChange,
  deckAPlaying,
  deckBPlaying,

  deckATrim,
  deckBTrim,
  onDeckATrimChange,
  onDeckBTrimChange,

  deckAEq,
  deckBEq,
  onDeckAEqChange,
  onDeckBEqChange,
}) => {
  const curveOptions: CrossfaderCurve[] = ['SMOOTH', 'CUT', 'DIP'];

  const handleCurveSelect = (curve: CrossfaderCurve) => {
    onCurveChange(curve);
  };

  const handleDeckTrimChange = (deck: DeckId, value: number) => {
    if (deck === 'A') onDeckATrimChange(value);
    else onDeckBTrimChange(value);
  };

  const handleDeckEqChange = (deck: DeckId, band: 'hi' | 'mid' | 'low' | 'filter', value: number) => {
    if (deck === 'A') onDeckAEqChange(band, value);
    else onDeckBEqChange(band, value);
  };

  return (
    <div className="mixer-panel mx-4 my-2 flex flex-col bg-black/20 border border-white/10 rounded-3xl p-4 gap-4 shadow-[0_0_20px_rgba(0,0,0,0.4)]">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Toggle checked={autoDjEnabled} onChange={onToggleAutoDj} label="AutoDJ" />
          <span className="text-[10px] uppercase tracking-widest text-gray-500">Queue {queueLength}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-gray-500">Curve</span>
          <div className="flex bg-white/5 rounded-full p-1">
            {curveOptions.map(opt => (
              <button
                key={opt}
                onClick={() => handleCurveSelect(opt)}
                className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full transition-all ${crossfaderCurve === opt ? 'bg-[#D0BCFF] text-black' : 'text-gray-400 hover:text-white'}`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-stretch gap-4">
        <div className="flex-1 flex flex-col items-center gap-2 bg-black/20 rounded-2xl p-3 border border-white/5">
          <div className="flex w-full justify-between items-center">
            <span className="text-xs font-black uppercase tracking-widest text-[#D0BCFF]">Deck A</span>
            <span className={`text-[10px] font-black uppercase tracking-widest ${deckAPlaying ? 'text-green-400' : 'text-gray-600'}`}>{deckAPlaying ? 'LIVE' : 'STOP'}</span>
          </div>
          <div className="flex gap-3">
            <Fader label="Vol" value={deckAVolume} onChange={onDeckAVolumeChange} color="#D0BCFF" />
            <Knob
              label="FX"
              value={deckATrim}
              onChange={(v) => handleDeckTrimChange('A', v)}
              color="#D0BCFF"
              size="sm"
              min={0}
              max={1}
              defaultValue={0}
            />
          </div>
          <div className="flex gap-2 mt-1">
            <Knob label="Hi" value={deckAEq.hi} onChange={(v) => handleDeckEqChange('A', 'hi', v)} color="#D0BCFF" size="xs" />
            <Knob label="Mid" value={deckAEq.mid} onChange={(v) => handleDeckEqChange('A', 'mid', v)} color="#D0BCFF" size="xs" />
            <Knob label="Low" value={deckAEq.low} onChange={(v) => handleDeckEqChange('A', 'low', v)} color="#D0BCFF" size="xs" />
            <Knob label="Filt" value={deckAEq.filter} onChange={(v) => handleDeckEqChange('A', 'filter', v)} color="#D0BCFF" size="xs" min={-1} max={1} defaultValue={0} />
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-4 px-2">
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Master</span>
            <Fader label="" value={masterVolume} onChange={onMasterVolumeChange} color="#FFFFFF" />
          </div>
          <div className="w-36">
            <Fader
              label="X-Fade"
              value={crossfader}
              onChange={onCrossfaderChange}
              min={-1}
              max={1}
              defaultValue={0}
              color="#D0BCFF"
              horizontal
            />
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-widest text-gray-500">Lead</span>
              <input
                type="number"
                value={mixLeadSeconds}
                onChange={(e) => onMixLeadChange(Number(e.target.value))}
                className="w-14 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-center"
              />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-widest text-gray-500">Dur</span>
              <input
                type="number"
                value={mixDurationSeconds}
                onChange={(e) => onMixDurationChange(Number(e.target.value))}
                className="w-14 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-xs text-center"
              />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center gap-2 bg-black/20 rounded-2xl p-3 border border-white/5">
          <div className="flex w-full justify-between items-center">
            <span className="text-xs font-black uppercase tracking-widest text-[#F2B8B5]">Deck B</span>
            <span className={`text-[10px] font-black uppercase tracking-widest ${deckBPlaying ? 'text-green-400' : 'text-gray-600'}`}>{deckBPlaying ? 'LIVE' : 'STOP'}</span>
          </div>
          <div className="flex gap-3">
            <Fader label="Vol" value={deckBVolume} onChange={onDeckBVolumeChange} color="#F2B8B5" />
            <Knob
              label="FX"
              value={deckBTrim}
              onChange={(v) => handleDeckTrimChange('B', v)}
              color="#F2B8B5"
              size="sm"
              min={0}
              max={1}
              defaultValue={0}
            />
          </div>
          <div className="flex gap-2 mt-1">
            <Knob label="Hi" value={deckBEq.hi} onChange={(v) => handleDeckEqChange('B', 'hi', v)} color="#F2B8B5" size="xs" />
            <Knob label="Mid" value={deckBEq.mid} onChange={(v) => handleDeckEqChange('B', 'mid', v)} color="#F2B8B5" size="xs" />
            <Knob label="Low" value={deckBEq.low} onChange={(v) => handleDeckEqChange('B', 'low', v)} color="#F2B8B5" size="xs" />
            <Knob label="Filt" value={deckBEq.filter} onChange={(v) => handleDeckEqChange('B', 'filter', v)} color="#F2B8B5" size="xs" min={-1} max={1} defaultValue={0} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Mixer;
