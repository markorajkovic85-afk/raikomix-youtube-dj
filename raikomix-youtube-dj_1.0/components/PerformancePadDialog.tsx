import React, { useEffect, useMemo, useState } from 'react';
import { PerformancePadConfig, PerformancePadMode, YouTubeSearchResult } from '../types';
import { searchYouTube } from '../utils/youtubeApi';

interface LocalSampleMeta {
  sourceId: string;
  sampleName: string;
  duration: number;
}

interface PerformancePadDialogProps {
  pad: PerformancePadConfig;
  onClose: () => void;
  onSave: (pad: PerformancePadConfig) => void;
  onClear: () => void;
  onLocalFileSelected: (file: File) => Promise<LocalSampleMeta>;
  onPreview: (pad: PerformancePadConfig) => void;
  isKeyConflict: (key: string) => boolean;
}

const formatTime = (time: number) => {
  if (!Number.isFinite(time)) return '0:00.00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const ms = Math.floor((time % 1) * 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const parseTime = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 2) return null;
  const minutes = parts.length === 2 ? Number(parts[0]) : 0;
  const seconds = Number(parts.length === 2 ? parts[1] : parts[0]);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  return minutes * 60 + seconds;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const PerformancePadDialog: React.FC<PerformancePadDialogProps> = ({
  pad,
  onClose,
  onSave,
  onClear,
  onLocalFileSelected,
  onPreview,
  isKeyConflict,
}) => {
  const [draft, setDraft] = useState<PerformancePadConfig>(pad);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'youtube' | 'local'>('youtube');
  const [listeningKey, setListeningKey] = useState(false);
  const [startInput, setStartInput] = useState(formatTime(pad.trimStart));
  const [endInput, setEndInput] = useState(formatTime(pad.trimEnd));

  const duration = draft.duration ?? 0;
  const maxTrim = duration > 0 ? duration : Math.max(draft.trimEnd, 5);

  const validation = useMemo(() => {
    const trimValid = draft.trimEnd > draft.trimStart;
    return {
      trimValid,
      canSave: trimValid && draft.sourceType !== 'empty',
    };
  }, [draft]);

  useEffect(() => {
    setDraft(pad);
  }, [pad]);

  useEffect(() => {
    if (pad.sourceType === 'local') setActiveTab('local');
    if (pad.sourceType === 'youtube') setActiveTab('youtube');
  }, [pad.sourceType]);

  useEffect(() => {
    setStartInput(formatTime(draft.trimStart));
    setEndInput(formatTime(draft.trimEnd));
  }, [draft.trimStart, draft.trimEnd]);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setLoading(true);
      const res = await searchYouTube(query);
      setResults(res);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!listeningKey) return;
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      const key = event.key.toLowerCase();
      setDraft((prev) => ({ ...prev, keyBinding: key }));
      setListeningKey(false);
    };
    window.addEventListener('keydown', handleKey, { once: true });
    return () => window.removeEventListener('keydown', handleKey);
  }, [listeningKey]);

  const handleTrimChange = (field: 'trimStart' | 'trimEnd', value: number) => {
    if (!Number.isFinite(value)) return;
    setDraft((prev) => ({
      ...prev,
      [field]: clamp(value, 0, maxTrim),
    }));
  };

  return (
    <div
      className="fixed inset-0 z-[3500] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="m3-card bg-[#1D1B20] border border-white/10 rounded-2xl w-full max-w-3xl shadow-[0_0_60px_rgba(0,0,0,0.6)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col lg:flex-row gap-6 p-6">
          <div className="flex-1 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Pad Config</p>
                <h2 className="text-xl font-black text-[#D0BCFF] mt-2">P{pad.id + 1}</h2>
                <p className="text-[11px] text-white/50 mt-1">{draft.sampleName || 'Empty'}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-500 hover:text-white"
                aria-label="Close dialog"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Source</p>
              <div className="flex items-center gap-2 bg-black/40 p-1 rounded-full border border-white/10">
              <button
                type="button"
                onClick={() => setActiveTab('youtube')}
                className={`flex-1 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition ${
                  activeTab === 'youtube' ? 'bg-[#D0BCFF] text-black' : 'text-gray-400 hover:text-white'
                }`}
              >
                YouTube Search
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('local')}
                className={`flex-1 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition ${
                  activeTab === 'local' ? 'bg-[#D0BCFF] text-black' : 'text-gray-400 hover:text-white'
                }`}
              >
                Local File
              </button>
              </div>
            </div>

            {activeTab === 'youtube' ? (
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search YouTube for effect samples..."
                    className="w-full bg-[#111014] border border-white/10 rounded-full py-2.5 pl-10 pr-12 text-xs focus:outline-none focus:border-[#D0BCFF] shadow-inner"
                  />
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">search</span>
                  {loading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#D0BCFF] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <div className="space-y-2 max-h-[220px] overflow-y-auto scrollbar-hide">
                  {results.map((result) => (
                    <button
                      key={result.videoId}
                      type="button"
                      onClick={() => {
                        setDraft((prev) => ({
                          ...prev,
                          sourceType: 'youtube',
                          sourceId: result.videoId,
                          sampleName: result.title,
                          sourceLabel: result.channelTitle,
                          trimStart: 0,
                          trimEnd: prev.duration ? Math.min(prev.duration, 5) : Math.max(prev.trimEnd, 5),
                        }));
                      }}
                      className="w-full flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-transparent hover:border-white/10 transition-all text-left"
                    >
                      <img src={result.thumbnailUrl} className="w-12 h-9 object-cover rounded-lg shrink-0" alt="" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-white truncate">{result.title}</p>
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest truncate">{result.channelTitle}</p>
                      </div>
                    </button>
                  ))}
                  {query.length > 0 && !loading && results.length === 0 && (
                    <p className="text-center text-[9px] uppercase tracking-widest text-gray-500 py-6">No results found</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Upload</label>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const meta = await onLocalFileSelected(file);
                    setDraft((prev) => ({
                      ...prev,
                      sourceType: 'local',
                      sourceId: meta.sourceId,
                      sampleName: meta.sampleName,
                      sourceLabel: 'Local File',
                      duration: meta.duration,
                      trimStart: 0,
                      trimEnd: Math.min(meta.duration, 5),
                    }));
                  }}
                  className="w-full text-xs text-gray-400 file:bg-[#2B2930] file:text-white file:border-none file:px-4 file:py-2 file:rounded-full file:text-[10px] file:font-black file:uppercase file:tracking-widest"
                />
              </div>
            )}
          </div>

          <div className="flex-1 space-y-5 bg-black/30 rounded-2xl border border-white/10 p-5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Trim</p>
              <button
                type="button"
                onClick={() => onPreview(draft)}
                className="text-[10px] font-black uppercase tracking-widest bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-full"
                disabled={draft.sourceType === 'empty'}
              >
                Preview
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-white/60">
                <span>Start</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxTrim}
                step={0.1}
                value={draft.trimStart}
                onChange={(event) => handleTrimChange('trimStart', parseFloat(event.target.value))}
                className="w-full accent-[#D0BCFF]"
                disabled={draft.sourceType === 'empty'}
              />
              <input
                type="text"
                value={startInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setStartInput(value);
                  const parsed = parseTime(value);
                  if (parsed !== null) handleTrimChange('trimStart', parsed);
                }}
                onBlur={() => setStartInput(formatTime(draft.trimStart))}
                className="w-full bg-[#111014] border border-white/10 rounded-lg p-2 text-xs text-white"
                placeholder="0:00.00"
                disabled={draft.sourceType === 'empty'}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-white/60">
                <span>End</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxTrim}
                step={0.1}
                value={draft.trimEnd}
                onChange={(event) => handleTrimChange('trimEnd', parseFloat(event.target.value))}
                className="w-full accent-[#D0BCFF]"
                disabled={draft.sourceType === 'empty'}
              />
              <input
                type="text"
                value={endInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setEndInput(value);
                  const parsed = parseTime(value);
                  if (parsed !== null) handleTrimChange('trimEnd', parsed);
                }}
                onBlur={() => setEndInput(formatTime(draft.trimEnd))}
                className="w-full bg-[#111014] border border-white/10 rounded-lg p-2 text-xs text-white"
                placeholder="0:00.00"
                disabled={draft.sourceType === 'empty'}
              />
              {!validation.trimValid && (
                <p className="text-[10px] text-[#F2B8B5]">End time must be greater than start.</p>
              )}
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Playback</p>
              <div className="grid grid-cols-2 gap-2">
                {(['ONE_SHOT', 'HOLD'] as PerformancePadMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, mode }))}
                    className={`py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition ${
                      draft.mode === mode
                        ? 'bg-white/15 border-white/30 text-white'
                        : 'bg-white/5 border-white/10 text-gray-500 hover:text-white'
                    }`}
                  >
                    {mode === 'ONE_SHOT' ? 'Play Full' : 'Hold to Play'}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-white/60 mt-3">
                <span>Volume</span>
                <span>{Math.round(draft.volume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={draft.volume}
                onChange={(event) => setDraft((prev) => ({ ...prev, volume: parseFloat(event.target.value) }))}
                className="w-full accent-[#D0BCFF]"
              />
            </div>

            <details className="border-t border-white/10 pt-4">
              <summary className="text-[10px] font-black uppercase tracking-widest text-gray-500 cursor-pointer">
                Advanced
              </summary>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Key Mapping</p>
                    <p className="text-[11px] text-white/60">Current: {draft.keyBinding.toUpperCase()}</p>
                    {isKeyConflict(draft.keyBinding) && (
                      <p className="text-[10px] text-[#F2B8B5] mt-1">Conflicts with existing shortcuts.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setListeningKey(true)}
                    className="px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/10 text-white hover:bg-white/20"
                  >
                    {listeningKey ? 'Press key...' : 'Assign'}
                  </button>
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-black uppercase tracking-widest text-[#F2B8B5] border border-[#F2B8B5]/40 px-4 py-2 rounded-full hover:bg-[#F2B8B5]/10"
          >
            Clear Pad
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-4 py-2 rounded-full hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={!validation.canSave}
              className="text-[10px] font-black uppercase tracking-widest bg-[#D0BCFF] text-black px-6 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Pad
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformancePadDialog;
