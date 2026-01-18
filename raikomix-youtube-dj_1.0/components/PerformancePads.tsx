import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PerformancePadConfig } from '../types';
import PerformancePadDialog from './PerformancePadDialog';
import {
  loadPerformancePadSample,
  loadPerformancePads,
  removePerformancePadSample,
  savePerformancePads,
  storePerformancePadSample,
} from '../utils/performancePadsStorage';

interface PerformancePadsProps {
  masterVolume: number;
  isActive: boolean;
  onNotify: (message: string, type?: 'info' | 'success' | 'error') => void;
}

const DEFAULT_KEYS = ['1', '2', '3', '4', '5', 'q', 'w', 'e', 'r', 't'];
const RESERVED_KEYS = new Set([
  'q',
  's',
  'm',
  '[',
  ']',
  '1',
  '2',
  '3',
  '4',
  'p',
  'k',
  'n',
  ';',
  "'",
  '7',
  '8',
  '9',
  '0',
  'r',
  'arrowleft',
  'arrowright',
  ' ',
  '?',
  '/',
]);

const buildDefaultPads = () =>
  Array.from({ length: 10 }, (_, index) => ({
    id: index,
    title: `Pad ${index + 1}`,
    sourceType: 'empty' as const,
    trimStart: 0,
    trimEnd: 1,
    volume: 0.8,
    mode: 'ONE_SHOT' as const,
    keyBinding: DEFAULT_KEYS[index] || '',
  }));

const normalizePads = (pads: PerformancePadConfig[]) => {
  const defaults = buildDefaultPads();
  return defaults.map((pad) => {
    const saved = pads.find((item) => item.id === pad.id);
    return saved ? { ...pad, ...saved } : pad;
  });
};

const PerformancePads: React.FC<PerformancePadsProps> = ({ masterVolume, isActive, onNotify }) => {
  const [pads, setPads] = useState<PerformancePadConfig[]>(() => {
    const stored = loadPerformancePads();
    return normalizePads(stored ?? []);
  });
  const [activePadId, setActivePadId] = useState<number | null>(null);
  const [playingPads, setPlayingPads] = useState<Record<number, boolean>>({});
  const [hasFocus, setHasFocus] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<number, AudioBuffer | null>>({});
  const sourcesRef = useRef<Record<number, AudioBufferSourceNode | null>>({});
  const gainsRef = useRef<Record<number, GainNode | null>>({});
  const keyHoldRef = useRef<Record<string, number>>({});
  const ytPlayersRef = useRef<Record<number, { player: any; interval?: number }>>({});
  const ytReadyRef = useRef<
    Record<number, { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; ready: boolean }>
  >({});

  const activePad = pads.find((pad) => pad.id === activePadId) ?? null;

  const isKeyConflict = useCallback((key: string) => RESERVED_KEYS.has(key.toLowerCase()), []);

  const ensureAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  useEffect(() => {
    savePerformancePads(pads);
  }, [pads]);

  useEffect(() => {
    if (pads.length !== 10) {
      console.warn(`Expected 10 performance pads, received ${pads.length}.`);
    }
  }, [pads.length]);

  const waitForYouTubeApi = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (window.YT && window.YT.Player) {
          resolve();
          return;
        }
        const handler = () => {
          window.removeEventListener('youtube-api-ready', handler);
          resolve();
        };
        window.addEventListener('youtube-api-ready', handler);
      }),
    []
  );

  const getYouTubeReadyEntry = useCallback((padId: number) => {
    const existing = ytReadyRef.current[padId];
    if (existing) return existing;
    let resolveFn: () => void = () => undefined;
    let rejectFn: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    const entry = { promise, resolve: resolveFn, reject: rejectFn, ready: false };
    ytReadyRef.current[padId] = entry;
    return entry;
  }, []);

  const ensureYouTubePlayer = useCallback(
    async (pad: PerformancePadConfig) => {
      if (pad.sourceType !== 'youtube' || !pad.sourceId) return;
      if (ytPlayersRef.current[pad.id]) return;
      await waitForYouTubeApi();
      const containerId = `pad-player-${pad.id}`;
      const readyEntry = getYouTubeReadyEntry(pad.id);
      const player = new window.YT.Player(containerId, {
        height: '1',
        width: '1',
        videoId: pad.sourceId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (event: any) => {
            readyEntry.ready = true;
            readyEntry.resolve();
            event.target.cueVideoById(pad.sourceId);
            const duration = event.target.getDuration?.() || pad.duration || 0;
            if (duration && duration !== pad.duration) {
              setPads((prev) =>
                prev.map((item) =>
                  item.id === pad.id
                    ? {
                        ...item,
                        duration,
                        trimEnd: Math.min(item.trimEnd, duration || item.trimEnd),
                      }
                    : item
                )
              );
            }
          },
          onError: (event: any) => {
            const error = new Error(`YouTube player error (${event?.data ?? 'unknown'})`);
            readyEntry.reject(error);
          },
        },
      });
      ytPlayersRef.current[pad.id] = { player };
    },
    [getYouTubeReadyEntry, waitForYouTubeApi]
  );

  useEffect(() => {
    pads.forEach((pad) => {
      if (pad.sourceType === 'youtube') {
        ensureYouTubePlayer(pad);
      }
    });
  }, [pads, ensureYouTubePlayer]);

  const stopPad = useCallback(
    (padId: number) => {
      const pad = pads.find((item) => item.id === padId);
      if (!pad) return;
      if (pad.sourceType === 'local') {
        sourcesRef.current[padId]?.stop?.();
        sourcesRef.current[padId] = null;
      }
      if (pad.sourceType === 'youtube') {
        const playerEntry = ytPlayersRef.current[padId];
        if (playerEntry?.interval) {
          window.clearInterval(playerEntry.interval);
          playerEntry.interval = undefined;
        }
        playerEntry?.player?.pauseVideo?.();
      }
      setPlayingPads((prev) => ({ ...prev, [padId]: false }));
    },
    [pads]
  );

  const loadLocalBuffer = useCallback(
    async (pad: PerformancePadConfig) => {
      if (pad.sourceType !== 'local' || !pad.sourceId) return null;
      if (buffersRef.current[pad.id]) return buffersRef.current[pad.id];
      try {
        const stored = await loadPerformancePadSample(pad.sourceId);
        if (!stored) return null;
        const ctx = ensureAudioContext();
        const buffer = await ctx.decodeAudioData(stored.arrayBuffer.slice(0));
        buffersRef.current[pad.id] = buffer;
        return buffer;
      } catch (error) {
        onNotify('Unable to load local sample', 'error');
        return null;
      }
    },
    [onNotify]
  );

  const startLocalPlayback = useCallback(
    async (pad: PerformancePadConfig) => {
      const buffer = await loadLocalBuffer(pad);
      if (!buffer) return { ok: false, error: 'Unable to load local sample.' };
      const ctx = ensureAudioContext();
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = pad.volume * masterVolume;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      const duration = Math.min(buffer.duration - pad.trimStart, pad.trimEnd - pad.trimStart);
      if (pad.mode === 'ONE_SHOT') {
        source.start(0, pad.trimStart, duration);
      } else {
        source.start(0, pad.trimStart);
        source.stop(ctx.currentTime + duration);
      }
      source.onended = () => {
        setPlayingPads((prev) => ({ ...prev, [pad.id]: false }));
      };
      sourcesRef.current[pad.id] = source;
      gainsRef.current[pad.id] = gain;
      return { ok: true };
    },
    [loadLocalBuffer, masterVolume]
  );

  const startYouTubePlayback = useCallback(
    async (pad: PerformancePadConfig) => {
      if (!pad.sourceId) return { ok: false, error: 'Missing YouTube source.' };
      if (!ytPlayersRef.current[pad.id]) {
        void ensureYouTubePlayer(pad);
        return { ok: false, error: 'YouTube player is warming up. Click Preview again.' };
      }
      const readyEntry = ytReadyRef.current[pad.id];
      if (readyEntry && !readyEntry.ready) {
        return { ok: false, error: 'YouTube player is still loading. Click Preview again.' };
      }
      const entry = ytPlayersRef.current[pad.id];
      const player = entry?.player;
      if (!player) {
        return { ok: false, error: 'YouTube player is still loading.' };
      }
      try {
        player.loadVideoById?.({
          videoId: pad.sourceId,
          startSeconds: pad.trimStart,
        });
      } catch (error) {}
      player.unMute?.();
      player.setVolume?.(Math.round(pad.volume * masterVolume * 100));
      player.playVideo?.();
      if (entry.interval) window.clearInterval(entry.interval);
      entry.interval = window.setInterval(() => {
        const current = player.getCurrentTime?.() || 0;
        if (current >= pad.trimEnd) {
          stopPad(pad.id);
        }
      }, 60);
      return { ok: true };
    },
    [ensureYouTubePlayer, masterVolume, stopPad]
  );

  const triggerPad = useCallback(
    async (padId: number, override?: PerformancePadConfig) => {
      const pad = override ?? pads.find((item) => item.id === padId);
      if (!pad || pad.sourceType === 'empty') return;
      if (pad.trimEnd <= pad.trimStart) return;

      stopPad(padId);
      setPlayingPads((prev) => ({ ...prev, [padId]: true }));

      const result =
        pad.sourceType === 'local' ? await startLocalPlayback(pad) : await startYouTubePlayback(pad);
      if (!result.ok) {
        setPlayingPads((prev) => ({ ...prev, [padId]: false }));
        if (result.error) onNotify(result.error, 'error');
      }
    },
    [pads, startLocalPlayback, startYouTubePlayback, stopPad, onNotify]
  );

  const previewPad = useCallback(
    async (pad: PerformancePadConfig) => {
      if (!pad || pad.sourceType === 'empty') {
        return { ok: false, error: 'Select a source before previewing.' };
      }
      if (pad.trimEnd <= pad.trimStart) {
        return { ok: false, error: 'End time must be greater than start.' };
      }
      stopPad(pad.id);
      setPlayingPads((prev) => ({ ...prev, [pad.id]: true }));
      const result =
        pad.sourceType === 'local' ? await startLocalPlayback(pad) : await startYouTubePlayback(pad);
      if (!result.ok) {
        setPlayingPads((prev) => ({ ...prev, [pad.id]: false }));
      }
      return result;
    },
    [startLocalPlayback, startYouTubePlayback, stopPad]
  );

  useEffect(() => {
    Object.entries(gainsRef.current).forEach(([id, gain]) => {
      const pad = pads.find((item) => item.id === Number(id));
      if (gain && pad) gain.gain.value = pad.volume * masterVolume;
    });
    Object.entries(ytPlayersRef.current).forEach(([id, entry]) => {
      const pad = pads.find((item) => item.id === Number(id));
      if (pad) entry.player?.setVolume?.(Math.round(pad.volume * masterVolume * 100));
    });
  }, [pads, masterVolume]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isActive) return;
    if (event.repeat) return;
    if (['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return;
    const key = event.key.toLowerCase();
    const pad = pads.find((item) => item.keyBinding === key);
    if (!pad) return;
    event.preventDefault();
    event.stopPropagation();
    keyHoldRef.current[key] = pad.id;
    triggerPad(pad.id);
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isActive) return;
    const key = event.key.toLowerCase();
    const padId = keyHoldRef.current[key];
    if (padId === undefined) return;
    const pad = pads.find((item) => item.id === padId);
    if (pad?.mode === 'HOLD') {
      stopPad(padId);
    }
    delete keyHoldRef.current[key];
  };

  const handleSave = (updated: PerformancePadConfig) => {
    setPads((prev) => prev.map((pad) => (pad.id === updated.id ? updated : pad)));
    onNotify('Pad saved', 'success');
    setActivePadId(null);
  };

  const handleDialogClose = () => {
    if (activePadId !== null) stopPad(activePadId);
    setActivePadId(null);
  };

  const handleClear = async (padId: number) => {
    const pad = pads.find((item) => item.id === padId);
    if (pad?.sourceType === 'local' && pad.sourceId) {
      await removePerformancePadSample(pad.sourceId);
      buffersRef.current[padId] = null;
    }
    stopPad(padId);
    setPads((prev) =>
      prev.map((item) =>
        item.id === padId
          ? {
              ...item,
              sourceType: 'empty',
              sourceId: undefined,
              sampleName: undefined,
              sourceLabel: undefined,
              duration: undefined,
              trimStart: 0,
              trimEnd: 1,
            }
          : item
      )
    );
    onNotify('Pad cleared', 'info');
    setActivePadId(null);
  };

  const handleLocalFileSelected = async (file: File) => {
    const record = await storePerformancePadSample(`pad_${Date.now()}`, file);
    const ctx = ensureAudioContext();
    const buffer = await ctx.decodeAudioData(record.arrayBuffer.slice(0));
    if (activePadId !== null) {
      buffersRef.current[activePadId] = buffer;
    }
    return {
      sourceId: record.id,
      sampleName: file.name.replace(/\.[^/.]+$/, ''),
      duration: buffer.duration,
    };
  };

  return (
    <div
      className={`w-full outline-none rounded-xl ${hasFocus ? 'ring-2 ring-[#D0BCFF]/40' : ''}`}
      tabIndex={0}
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      aria-label="Performance pads"
    >
      <div className="grid grid-cols-5 gap-2">
        {pads.map((pad) => {
          const isPlaying = playingPads[pad.id];
          const isLoaded = pad.sourceType !== 'empty';
          return (
            <button
              key={pad.id}
              type="button"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if (!isLoaded) return;
                if (pad.mode === 'HOLD' || pad.mode === 'ONE_SHOT') {
                  triggerPad(pad.id);
                }
              }}
              onPointerUp={() => {
                if (pad.mode === 'HOLD') stopPad(pad.id);
              }}
              onPointerLeave={() => {
                if (pad.mode === 'HOLD') stopPad(pad.id);
              }}
              onClick={() => {
                if (!isLoaded) setActivePadId(pad.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setActivePadId(pad.id);
              }}
              className={`group relative aspect-square rounded-lg border bg-black/40 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D0BCFF]/60 ${
                isLoaded
                  ? 'border-white/20 hover:border-[#D0BCFF]/40'
                  : 'border-white/10 hover:border-white/20'
              }`}
              aria-label={`Pad ${pad.id + 1}${isLoaded ? ' loaded' : ' empty'}`}
            >
              <span className="absolute left-2 top-2 text-[9px] font-black text-gray-400">P{pad.id + 1}</span>
              <span
                className={`absolute right-2 top-2 h-2 w-2 rounded-full ${
                  isPlaying
                    ? 'bg-[#D0BCFF] shadow-[0_0_10px_rgba(208,188,255,0.7)]'
                    : isLoaded
                      ? 'bg-white/40'
                      : 'bg-white/10'
                }`}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setActivePadId(pad.id);
                }}
                className="absolute bottom-1.5 right-1.5 text-white/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition text-[10px]"
                aria-label={`Configure pad ${pad.id + 1}`}
              >
                ⋮
              </button>
            </button>
          );
        })}
      </div>

      <div className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none overflow-hidden">
        {pads.map((pad) => (
          <div key={pad.id} id={`pad-player-${pad.id}`} />
        ))}
      </div>

      {activePad && (
        <PerformancePadDialog
          pad={activePad}
          onClose={handleDialogClose}
          onSave={handleSave}
          onClear={() => handleClear(activePad.id)}
          onLocalFileSelected={handleLocalFileSelected}
          onPreview={previewPad}
          onStopPreview={() => stopPad(activePad.id)}
          isKeyConflict={isKeyConflict}
        />
      )}
    </div>
  );
};

export default PerformancePads;
