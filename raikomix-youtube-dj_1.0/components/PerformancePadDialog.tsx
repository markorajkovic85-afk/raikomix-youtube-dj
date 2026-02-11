import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PerformancePadConfig, PerformancePadMode, WaveformData, YouTubeLoadingState, YouTubeSearchResult } from '../types';
import { searchYouTube } from '../utils/youtubeApi';
import TrimWaveform from './TrimWaveform';

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
  onLocalFileSelected: (file: File) => Promise<LocalSampleMeta | null>;
  onPreview: (pad: PerformancePadConfig) => Promise<{ ok: boolean; error?: string }>;
  onStopPreview: () => void;
  onPreflightYouTube: (pad: PerformancePadConfig) => void;
  onCancelYouTube: (videoId?: string) => void;
  youtubeStates: Record<string, { state: YouTubeLoadingState; message?: string }>;
  activePreviewVideoId: string | null;
  isKeyConflict: (key: string) => boolean;
  trimWaveforms: Record<string, WaveformData | null>;
  trimWaveformStatus: Record<string, 'idle' | 'building' | 'error'>;
}

const formatTime = (time: number) => {
  if (!Number.isFinite(time)) return '0:00.00';
  const safeTime = Math.max(0, time);
  const hours = Math.floor(safeTime / 3600);
  const minutes = Math.floor((safeTime % 3600) / 60);
  const seconds = Math.floor(safeTime % 60);
  const ms = Math.floor((safeTime % 1) * 100);
  const secondsLabel = `${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secondsLabel}`;
  }
  return `${minutes}:${secondsLabel}`;
};

const parseTime = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((num) => Number.isNaN(num))) return null;
  if (parts.length === 3) {
    const [hours, minutes, seconds] = numbers;
    if (hours < 0 || minutes < 0 || seconds < 0) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    if (minutes < 0 || seconds < 0) return null;
    return minutes * 60 + seconds;
  }
  const [seconds] = numbers;
  if (seconds < 0) return null;
  return seconds;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const getTrimLength = (pad: PerformancePadConfig) => {
  const length = pad.trimLength ?? pad.trimEnd - pad.trimStart;
  return Number.isFinite(length) && length > 0 ? length : 0.1;
};

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};

const encodeWav = (buffers: Float32Array[], sampleRate: number) => {
  const totalLength = buffers.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + totalLength * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + totalLength * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, totalLength * 2, true);

  let offset = 44;
  buffers.forEach((chunk) => {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  });

  return new Blob([buffer], { type: 'audio/wav' });
};

const PerformancePadDialog: React.FC<PerformancePadDialogProps> = ({
  pad,
  onClose,
  onSave,
  onClear,
  onLocalFileSelected,
  onPreview,
  onStopPreview,
  onPreflightYouTube,
  onCancelYouTube,
  youtubeStates,
  activePreviewVideoId,
  isKeyConflict,
  trimWaveforms,
  trimWaveformStatus,
}) => {
  const [draft, setDraft] = useState<PerformancePadConfig>(pad);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchState, setSearchState] = useState<YouTubeLoadingState>('idle');
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'youtube' | 'local'>('local');
  const [listeningKey, setListeningKey] = useState(false);
  const [startInput, setStartInput] = useState(formatTime(pad.trimStart));
  const [endInput, setEndInput] = useState(formatTime(pad.trimEnd));
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewingType, setPreviewingType] = useState<'youtube' | 'local' | null>(null);
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [generalPreviewError, setGeneralPreviewError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const recorderChunksRef = React.useRef<Blob[]>([]);
  const recorderStreamRef = React.useRef<MediaStream | null>(null);
  const recorderTimerRef = React.useRef<number | null>(null);
  const recordingStartTimeRef = React.useRef<number | null>(null);
  const recorderPhaseRef = React.useRef<'idle' | 'starting' | 'recording' | 'stopping'>('idle');
  const recorderSessionRef = React.useRef(0);
  const previewPlayerRef = React.useRef<any>(null);
  const previewPlayerVideoIdRef = React.useRef<string | null>(null);
  const previewPlayerTimeoutRef = React.useRef<number | null>(null);
  const previewPlayerContainerRef = React.useRef<HTMLDivElement | null>(null);
  const fallbackRecorderRef = React.useRef<{
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    stream: MediaStream;
    buffers: Float32Array[];
    sampleRate: number;
  } | null>(null);

  const duration = draft.duration ?? 0;
  const maxTrim = duration > 0 ? duration : Math.max(draft.trimEnd, 5);
  const trimLength = getTrimLength(draft);
  const recordingTime = formatTime(recordingMs / 1000);
  const currentWaveform = draft.sourceId ? trimWaveforms[draft.sourceId] : null;
  const currentWaveformStatus = draft.sourceId ? trimWaveformStatus[draft.sourceId] : undefined;
  const showTrimWaveform = draft.sourceType !== 'empty' && duration > 0 && Boolean(currentWaveform);
  const showWaveformStatus =
    draft.sourceType !== 'empty' && duration > 0 && !currentWaveform && currentWaveformStatus === 'building';

  const selectedYouTubeState =
    draft.sourceType === 'youtube' && draft.sourceId ? youtubeStates[draft.sourceId]?.state : null;
  const isYouTubeBusy = selectedYouTubeState
    ? (['resolving', 'downloading', 'decoding', 'searching'] as YouTubeLoadingState[]).includes(
        selectedYouTubeState
      )
    : false;

  const validation = useMemo(() => {
    const trimValid = draft.trimEnd > draft.trimStart;
    const youtubeReady = draft.sourceType !== 'youtube' || !isYouTubeBusy;
    return {
      trimValid,
      canSave: trimValid && draft.sourceType !== 'empty' && youtubeReady,
    };
  }, [draft, isYouTubeBusy]);

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

  const applyDurationToDraft = useCallback((videoId: string, resolvedDuration: number) => {
    if (!resolvedDuration || resolvedDuration <= 0) return;
    setDraft((prev) => {
      if (prev.sourceType !== 'youtube' || prev.sourceId !== videoId) return prev;
      if (prev.duration && prev.duration > 0 && prev.duration === resolvedDuration) return prev;
      const currentLength = getTrimLength(prev);
      if (prev.trimLock) {
        const nextTrimEnd = Math.min(prev.trimStart + currentLength, resolvedDuration);
        const nextTrimStart = Math.max(0, nextTrimEnd - currentLength);
        return {
          ...prev,
          duration: resolvedDuration,
          trimStart: nextTrimStart,
          trimEnd: nextTrimEnd,
          trimLength: Math.min(currentLength, resolvedDuration),
        };
      }
      const shouldAutoFit = prev.trimStart === 0 && prev.trimEnd <= 5;
      return {
        ...prev,
        duration: resolvedDuration,
        trimEnd: shouldAutoFit ? resolvedDuration : Math.min(prev.trimEnd, resolvedDuration),
      };
    });
  }, []);

  const clearPreviewPlayerTimer = useCallback(() => {
    if (previewPlayerTimeoutRef.current) {
      window.clearTimeout(previewPlayerTimeoutRef.current);
      previewPlayerTimeoutRef.current = null;
    }
  }, []);

  const pollPreviewPlayerDuration = useCallback(
    (videoId: string, attempt = 0) => {
      if (previewPlayerVideoIdRef.current !== videoId) return;
      const durationValue = previewPlayerRef.current?.getDuration?.() || 0;
      if (durationValue > 0) {
        applyDurationToDraft(videoId, durationValue);
        clearPreviewPlayerTimer();
        return;
      }
      if (attempt >= 10) {
        clearPreviewPlayerTimer();
        return;
      }
      previewPlayerTimeoutRef.current = window.setTimeout(() => {
        pollPreviewPlayerDuration(videoId, attempt + 1);
      }, 250);
    },
    [applyDurationToDraft, clearPreviewPlayerTimer]
  );

  const ensurePreviewPlayer = useCallback(
    async (videoId: string) => {
      await waitForYouTubeApi();
      if (!previewPlayerContainerRef.current) return;
      previewPlayerVideoIdRef.current = videoId;
      if (!previewPlayerRef.current) {
        previewPlayerRef.current = new window.YT.Player(previewPlayerContainerRef.current, {
          height: '1',
          width: '1',
          videoId,
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: (event: any) => {
              event.target.cueVideoById(videoId);
              pollPreviewPlayerDuration(videoId);
            },
            onStateChange: (event: any) => {
              if (event?.data !== window.YT?.PlayerState?.CUED) return;
              pollPreviewPlayerDuration(videoId);
            },
            onError: () => {
              clearPreviewPlayerTimer();
            },
          },
        });
        return;
      }
      previewPlayerRef.current.cueVideoById(videoId);
      pollPreviewPlayerDuration(videoId);
    },
    [clearPreviewPlayerTimer, pollPreviewPlayerDuration, waitForYouTubeApi]
  );

  const saveRecordingFile = useCallback(
    async (file: File) => {
      try {
        const meta = await onLocalFileSelected(file);
        if (!meta) {
          setRecordingError('Local storage unavailable for samples.');
          return;
        }
        setDraft((prev) => ({
          ...prev,
          sourceType: 'local',
          sourceId: meta.sourceId,
          sampleName: 'Mic Recording',
          sourceLabel: 'Microphone',
          duration: meta.duration,
          trimStart: 0,
          trimEnd: meta.duration,
          trimLength: meta.duration,
          trimLock: false,
        }));
      } catch (error) {
        setRecordingError('Recording saved but failed to load. Please try again.');
      }
    },
    [onLocalFileSelected]
  );

  const cleanupRecorderStream = useCallback(() => {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  }, []);

  const stopRecording = useCallback(async () => {
    console.log('[Recording] Stop requested');

    if (recorderPhaseRef.current !== 'recording') {
      console.log('[Recording] Not currently recording');
      return;
    }
    recorderPhaseRef.current = 'stopping';

    if (recordingStartTimeRef.current) {
      const elapsed = performance.now() - recordingStartTimeRef.current;
      const minRecordingMs = 1200;
      if (elapsed < minRecordingMs) {
        console.log('[Recording] Too short, waiting...', elapsed);
        window.setTimeout(() => {
          void stopRecording();
        }, minRecordingMs - elapsed);
        return;
      }
    }

    if (recorderRef.current?.state === 'recording') {
      try {
        await new Promise<void>((resolve) => {
          if (!recorderRef.current) {
            resolve();
            return;
          }
          let resolved = false;
          const recorder = recorderRef.current;
          const onData = () => {
            if (resolved) {
              return;
            }
            resolved = true;
            recorder.removeEventListener('dataavailable', onData);
            resolve();
          };
          recorder.addEventListener('dataavailable', onData);
          recorder.requestData();
          window.setTimeout(() => {
            if (!resolved) {
              recorder.removeEventListener('dataavailable', onData);
              resolve();
            }
          }, 500);
        });
        console.log('[Recording] Requested final data chunk');
        recorderRef.current.stop();
        console.log('[Recording] Stop called');
      } catch (error) {
        console.error('[Recording] Error during stop:', error);
        setRecordingError('Failed to stop recording properly.');
        recorderPhaseRef.current = 'idle';
      }
      return;
    }

    const fallback = fallbackRecorderRef.current;
    if (!fallback) {
      console.log('[Recording] No active recorder to stop');
      return;
    }

    try {
      fallback.processor.disconnect();
      fallback.source.disconnect();
      fallback.stream.getTracks().forEach((track) => track.stop());
      await fallback.ctx.close().catch(() => undefined);
    } catch (error) {
      console.error('[Recording] Cleanup error:', error);
    }

    fallbackRecorderRef.current = null;
    cleanupRecorderStream();
    recordingStartTimeRef.current = null;
    setIsRecording(false);
    recorderPhaseRef.current = 'idle';

    if (fallback.buffers.length === 0) {
      setRecordingError('No audio captured. Please speak into your microphone and try again.');
      return;
    }

    const blob = encodeWav(fallback.buffers, fallback.sampleRate);
    const file = new File([blob], `mic-recording-${Date.now()}.wav`, { type: blob.type });
    await saveRecordingFile(file);
  }, [cleanupRecorderStream, saveRecordingFile]);

  const startRecording = useCallback(async () => {
    console.log('[Recording] Start requested');
    setRecordingError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingError('Microphone access is not supported in this browser.');
      return;
    }

    if (recorderPhaseRef.current !== 'idle') {
      console.log('[Recording] Already recording');
      return;
    }
    recorderPhaseRef.current = 'starting';
    const sessionId = recorderSessionRef.current + 1;
    recorderSessionRef.current = sessionId;

    const startFallbackRecording = async (stream: MediaStream) => {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        setRecordingError('Recording is not supported in this browser.');
        recorderPhaseRef.current = 'idle';
        return;
      }

      cleanupRecorderStream();
      recorderStreamRef.current = stream;

      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const buffers: Float32Array[] = [];

      processor.onaudioprocess = (event) => {
        buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      fallbackRecorderRef.current = {
        ctx,
        source,
        processor,
        stream,
        buffers,
        sampleRate: ctx.sampleRate,
      };

      setRecordingMs(0);
      setIsRecording(true);
      recordingStartTimeRef.current = performance.now();
      recorderPhaseRef.current = 'recording';
      console.log('[Recording] Fallback recorder started');
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });
      console.log('[Recording] Microphone access granted');

      if (sessionId !== recorderSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      cleanupRecorderStream();
      recorderStreamRef.current = stream;

      if (typeof MediaRecorder === 'undefined') {
        console.log('[Recording] MediaRecorder not available, using fallback');
        await startFallbackRecording(stream);
        return;
      }

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const canCheckMime = typeof MediaRecorder.isTypeSupported === 'function';
      const mimeType = canCheckMime ? preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? '' : '';

      console.log('[Recording] Using MIME type:', mimeType || 'default');

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderChunksRef.current = [];
      let dataReceivedCount = 0;

      recorder.ondataavailable = (event) => {
        console.log('[Recording] Data available, size:', event.data.size);
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
          dataReceivedCount += 1;
        }
      };

      const waitForFinalChunks = async () => {
        const timeoutMs = 1000;
        const pollMs = 100;
        const startedAt = performance.now();
        let lastCount = recorderChunksRef.current.length;
        while (performance.now() - startedAt < timeoutMs) {
          await new Promise((resolve) => window.setTimeout(resolve, pollMs));
          const nextCount = recorderChunksRef.current.length;
          if (nextCount === lastCount) {
            return;
          }
          lastCount = nextCount;
        }
      };

      recorder.onstop = async () => {
        if (sessionId !== recorderSessionRef.current) {
          return;
        }
        console.log('[Recording] Recorder stopped, chunks:', recorderChunksRef.current.length);
        recordingStartTimeRef.current = null;
        setIsRecording(false);
        recorderPhaseRef.current = 'idle';

        await waitForFinalChunks();

        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const chunks = recorderChunksRef.current.length;
        recorderChunksRef.current = [];

        cleanupRecorderStream();

        if (!blob.size || chunks === 0) {
          console.error('[Recording] No audio data captured');
          setRecordingError(
            'No audio captured. Please record for at least 1 second and ensure your microphone is working.'
          );
          return;
        }

        console.log('[Recording] Creating file, blob size:', blob.size, 'chunks:', chunks);
        const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `mic-recording-${Date.now()}.${extension}`, { type: blob.type });
        await saveRecordingFile(file);
      };

      recorder.onerror = (event) => {
        console.error('[Recording] MediaRecorder error:', event);
        setRecordingError('Recording failed. Please check microphone permissions.');
        setIsRecording(false);
        recordingStartTimeRef.current = null;
        cleanupRecorderStream();
        recorderPhaseRef.current = 'idle';
      };

      recorderRef.current = recorder;
      setRecordingMs(0);
      setIsRecording(true);
      recordingStartTimeRef.current = performance.now();
      recorderPhaseRef.current = 'recording';

      recorder.start(250);
      console.log('[Recording] MediaRecorder started');
    } catch (error) {
      console.error('[Recording] Failed to start:', error);
      recorderPhaseRef.current = 'idle';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          },
        });
        await startFallbackRecording(stream);
      } catch (fallbackError) {
        console.error('[Recording] Fallback also failed:', fallbackError);
        setRecordingError('Microphone access denied or unavailable. Please check browser permissions.');
        setIsRecording(false);
        recorderPhaseRef.current = 'idle';
      }
    }
  }, [cleanupRecorderStream, saveRecordingFile]);

  useEffect(() => {
    setDraft(pad);
  }, [pad]);

  useEffect(() => {
    setActiveTab('local');
  }, [pad.id]);

  useEffect(() => {
    setStartInput(formatTime(draft.trimStart));
    setEndInput(formatTime(draft.trimEnd));
  }, [draft.trimStart, draft.trimEnd]);

  useEffect(() => {
    if (draft.sourceType !== 'youtube' || !draft.sourceId) return;
    if (draft.duration && draft.duration > 0) return;
    void ensurePreviewPlayer(draft.sourceId);
  }, [draft.duration, draft.sourceId, draft.sourceType, ensurePreviewPlayer]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
      setResults([]);
      setLoading(false);
      setSearchState('idle');
      setSearchMessage(null);
      return;
    }
    const timeout = setTimeout(async () => {
      const startedAt = performance.now();
      setLoading(true);
      setSearchState('searching');
      try {
        const res = await searchYouTube(trimmedQuery);
        setResults(res);
        setSearchMessage(res.length === 0 ? 'No matching results found.' : null);
      } catch (error) {
        setResults([]);
        setSearchMessage('Search failed. Please try again.');
      }
      setLoading(false);
      setSearchState('idle');
      if (import.meta?.env?.DEV) {
        console.log(`[YouTube Timing] search time: ${(performance.now() - startedAt).toFixed(0)}ms`);
      }
    }, 500);
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

  useEffect(() => {
    if (!activePreviewVideoId) return;
    setPreviewingId(activePreviewVideoId);
    setPreviewingType('youtube');
  }, [activePreviewVideoId]);

  useEffect(() => {
    onStopPreview();
    onCancelYouTube();
    setPreviewingId(null);
    setPreviewingType(null);
    setGeneralPreviewError(null);
  }, [activeTab, onCancelYouTube, onStopPreview]);

  useEffect(() => {
    if (activeTab !== 'local' && isRecording) {
      void stopRecording();
    }
  }, [activeTab, isRecording, stopRecording]);

  useEffect(() => {
    if (!isRecording) return;
    const startedAt = performance.now();
    recorderTimerRef.current = window.setInterval(() => {
      setRecordingMs(performance.now() - startedAt);
    }, 200);
    return () => {
      if (recorderTimerRef.current) {
        window.clearInterval(recorderTimerRef.current);
        recorderTimerRef.current = null;
      }
    };
  }, [isRecording]);

  useEffect(
    () => () => {
      // Only cleanup on actual unmount
      onStopPreview();
      onCancelYouTube();
      clearPreviewPlayerTimer();
      if (previewPlayerRef.current) {
        previewPlayerRef.current.destroy();
        previewPlayerRef.current = null;
      }
      if (recorderRef.current?.state === 'recording') {
        console.log('[Recording] Cleanup: stopping recorder');
        recorderRef.current.stop();
      }
      if (fallbackRecorderRef.current) {
        console.log('[Recording] Cleanup: stopping fallback');
        fallbackRecorderRef.current.processor.disconnect();
        fallbackRecorderRef.current.source.disconnect();
        fallbackRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
        void fallbackRecorderRef.current.ctx.close();
        fallbackRecorderRef.current = null;
      }
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
      recorderChunksRef.current = [];
    },
    [clearPreviewPlayerTimer, onCancelYouTube, onStopPreview]
  );

  const handleTrimChange = (field: 'trimStart' | 'trimEnd', value: number) => {
    if (!Number.isFinite(value)) return;
    setDraft((prev) => {
      const minGap = 0.1;
      const nextValue = clamp(value, 0, maxTrim);
      if (!prev.trimLock) {
        let nextTrimStart = field === 'trimStart' ? nextValue : prev.trimStart;
        let nextTrimEnd = field === 'trimEnd' ? nextValue : prev.trimEnd;
        if (nextTrimStart >= nextTrimEnd) {
          if (field === 'trimStart') {
            nextTrimEnd = clamp(nextTrimStart + minGap, 0, maxTrim);
            if (nextTrimEnd === maxTrim) {
              nextTrimStart = clamp(nextTrimEnd - minGap, 0, maxTrim);
            }
          } else {
            nextTrimStart = clamp(nextTrimEnd - minGap, 0, maxTrim);
            if (nextTrimStart === 0) {
              nextTrimEnd = clamp(nextTrimStart + minGap, 0, maxTrim);
            }
          }
        }
        return { ...prev, trimStart: nextTrimStart, trimEnd: nextTrimEnd };
      }
      const length = Math.min(getTrimLength(prev), maxTrim);
      if (field === 'trimStart') {
        const nextTrimEnd = clamp(nextValue + length, 0, maxTrim);
        const nextTrimStart = Math.max(0, nextTrimEnd - length);
        return {
          ...prev,
          trimStart: nextTrimStart,
          trimEnd: nextTrimEnd,
          trimLength: length,
        };
      }
      const nextTrimStart = clamp(nextValue - length, 0, maxTrim);
      const nextTrimEnd = Math.min(nextTrimStart + length, maxTrim);
      return {
        ...prev,
        trimStart: nextTrimStart,
        trimEnd: nextTrimEnd,
        trimLength: length,
      };
    });
  };

  const handleTrimWheel = useCallback(
    (field: 'trimStart' | 'trimEnd') => (event: React.WheelEvent<HTMLInputElement>) => {
      if (draft.sourceType === 'empty') return;
      event.preventDefault();
      const step = event.altKey ? 5 : event.shiftKey ? 0.1 : 1;
      const direction = event.deltaY < 0 ? 1 : -1;
      const baseValue = field === 'trimStart' ? draft.trimStart : draft.trimEnd;
      handleTrimChange(field, baseValue + direction * step);
    },
    [draft.sourceType, draft.trimEnd, draft.trimStart, handleTrimChange]
  );

  const handleTrimLengthChange = (value: number) => {
    if (!Number.isFinite(value)) return;
    setDraft((prev) => {
      const nextLength = clamp(value, 0.1, maxTrim);
      if (!prev.trimLock) {
        return { ...prev, trimLength: nextLength };
      }
      const nextTrimEnd = Math.min(prev.trimStart + nextLength, maxTrim);
      const nextTrimStart = Math.max(0, nextTrimEnd - nextLength);
      return {
        ...prev,
        trimStart: nextTrimStart,
        trimEnd: nextTrimEnd,
        trimLength: nextLength,
      };
    });
  };

  const handleTrimLockToggle = (locked: boolean) => {
    setDraft((prev) => {
      if (!locked) {
        return { ...prev, trimLock: false, trimLength: getTrimLength(prev) };
      }
      const nextLength = Math.min(getTrimLength(prev), maxTrim);
      const nextTrimEnd = Math.min(prev.trimStart + nextLength, maxTrim);
      const nextTrimStart = Math.max(0, nextTrimEnd - nextLength);
      return {
        ...prev,
        trimLock: true,
        trimLength: nextLength,
        trimStart: nextTrimStart,
        trimEnd: nextTrimEnd,
      };
    });
  };

  const handleFitToLength = () => {
    setDraft((prev) => {
      const nextLength = maxTrim;
      return {
        ...prev,
        trimStart: 0,
        trimEnd: maxTrim,
        trimLength: nextLength,
      };
    });
  };

  const handleClose = () => {
    onStopPreview();
    onCancelYouTube();
    clearPreviewPlayerTimer();
    if (previewPlayerRef.current) {
      previewPlayerRef.current.destroy();
      previewPlayerRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
    if (fallbackRecorderRef.current) {
      fallbackRecorderRef.current.processor.disconnect();
      fallbackRecorderRef.current.source.disconnect();
      fallbackRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      void fallbackRecorderRef.current.ctx.close();
      fallbackRecorderRef.current = null;
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
    onClose();
  };

  const stopPreview = () => {
    onStopPreview();
    onCancelYouTube();
    setPreviewingId(null);
    setPreviewingType(null);
  };

  const buildYouTubeDraft = (result: YouTubeSearchResult): PerformancePadConfig => {
    const nextTrimEnd = draft.sourceType === 'youtube' ? Math.max(draft.trimEnd, 5) : 5;
    const nextTrimLength = draft.sourceType === 'youtube' ? getTrimLength(draft) : nextTrimEnd;
    return {
      ...draft,
      sourceType: 'youtube' as const,
      sourceId: result.videoId,
      sampleName: result.title,
      sourceLabel: result.channelTitle,
      duration: undefined,
      trimStart: 0,
      trimEnd: nextTrimEnd,
      trimLength: nextTrimLength,
      trimLock: false,
    };
  };

  const selectYouTubeResult = useCallback(
    (result: YouTubeSearchResult) => {
      const nextDraft = buildYouTubeDraft(result);
      setDraft(nextDraft);
      void ensurePreviewPlayer(result.videoId);
    },
    [buildYouTubeDraft, ensurePreviewPlayer]
  );

  const handlePreview = async (nextDraft: PerformancePadConfig, previewId?: string | null) => {
    if (previewId && previewErrors[previewId]) return;
    setGeneralPreviewError(null);
    if (previewingId || previewingType) {
      stopPreview();
    }
    const response = await onPreview(nextDraft);
    if (!response.ok) {
      const message = response.error || 'Preview unavailable.';
      const isTransient = /warming up|still loading/i.test(message);
      if (previewId && !isTransient) {
        setPreviewErrors((prev) => ({ ...prev, [previewId]: message }));
      } else if (!isTransient) {
        setGeneralPreviewError(message);
      } else {
        setGeneralPreviewError(message);
      }
      return;
    }
    setPreviewingId(nextDraft.sourceId ?? null);
    setPreviewingType(nextDraft.sourceType === 'youtube' ? 'youtube' : 'local');
  };

  const dialog = (
    <div
      className="fixed inset-0 z-[10000] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true">
        <div ref={previewPlayerContainerRef} />
      </div>
      <div
        className="m3-card bg-[#1D1B20] border border-white/10 rounded-3xl w-full max-w-5xl shadow-[0_0_80px_rgba(13,11,19,0.9)] flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-white/10 bg-gradient-to-r from-[#181520] via-[#121018] to-[#100F15]">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-2xl border border-white/10 bg-gradient-to-br from-[#262233] via-[#14121B] to-[#0A0A10] shadow-[inset_0_0_0_1px_rgba(208,188,255,0.15),0_8px_16px_rgba(8,7,15,0.7)] flex items-center justify-center text-[#D0BCFF] font-black text-lg tracking-widest">
                P{pad.id + 1}
              </div>
              <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full bg-[#D0BCFF] shadow-[0_0_12px_rgba(208,188,255,0.8)]" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-500">Pad Config</p>
              <h2 className="text-2xl font-black text-[#E7DDFF] mt-2">Performance Pad</h2>
              <p className="text-[11px] text-white/60 mt-1">{draft.sampleName || 'Empty'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-full h-10 w-10 flex items-center justify-center shrink-0"
            aria-label="Close dialog"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-pads">
          <div className="flex flex-col lg:flex-row gap-6 p-6">
            <div className="flex-1 space-y-6 min-w-0">
              <div className="m3-card bg-[#191721]/80 border border-white/10 rounded-2xl p-5 space-y-4 shadow-[0_10px_30px_rgba(9,8,14,0.55)]">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Source</p>
                  <span className="text-[9px] uppercase tracking-[0.3em] text-white/30">Select</span>
                </div>
                <div className="flex items-center gap-2 bg-black/50 p-1.5 rounded-full border border-white/10 shadow-[inset_0_0_0_1px_rgba(208,188,255,0.08)]">
                  <button
                    type="button"
                    onClick={() => setActiveTab('youtube')}
                    className={`flex-1 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                      activeTab === 'youtube'
                        ? 'bg-[#D0BCFF] text-black shadow-[0_0_20px_rgba(208,188,255,0.45)]'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    YouTube Search
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('local')}
                    className={`flex-1 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                      activeTab === 'local'
                        ? 'bg-[#D0BCFF] text-black shadow-[0_0_20px_rgba(208,188,255,0.45)]'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Local File
                  </button>
                </div>
              </div>

              {activeTab === 'youtube' ? (
                <div className="space-y-4 min-w-0">
                  <div className="m3-card bg-[#15131A]/80 border border-white/10 rounded-2xl p-5 space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search YouTube for effect samples..."
                        className="w-full bg-[#0F0E13] border border-white/10 rounded-full py-3 pl-11 pr-12 text-xs focus:outline-none focus:border-[#D0BCFF] shadow-inner"
                      />
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                        search
                      </span>
                      {loading && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#D0BCFF] border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    {searchState === 'searching' && (
                      <p className="text-[10px] uppercase tracking-widest text-gray-500">Searching...</p>
                    )}
                    <p className="text-[10px] text-white/40">
                      YouTube previews may take a moment to load before audio is ready.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto overflow-x-hidden pr-2 scrollbar-pads">
                    {searchState === 'idle' && searchMessage && results.length === 0 && (
                      <p className="text-[10px] uppercase tracking-widest text-gray-500">{searchMessage}</p>
                    )}
                    {results.map((result) => {
                      const nextDraft = buildYouTubeDraft(result);
                      const previewError = previewErrors[result.videoId];
                      const rowState = youtubeStates[result.videoId]?.state ?? 'idle';
                      const rowMessage = youtubeStates[result.videoId]?.message;
                      const isPreviewing = previewingType === 'youtube' && previewingId === result.videoId;
                      const isBusy = ['resolving', 'downloading', 'decoding', 'searching'].includes(rowState);
                      const showCancel = isPreviewing && ['resolving', 'downloading', 'decoding'].includes(rowState);
                      return (
                        <div
                          key={result.videoId}
                          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1C1924]/90 via-[#14121A]/90 to-[#0B0A0F]/90 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_10px_18px_rgba(6,6,12,0.7)] transition-all hover:border-[#D0BCFF]/40 hover:shadow-[0_0_20px_rgba(208,188,255,0.25)]"
                          onMouseEnter={() => onPreflightYouTube(nextDraft)}
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={result.thumbnailUrl}
                              className="w-14 h-10 object-cover rounded-xl border border-white/10 shrink-0"
                              alt=""
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-semibold text-white truncate">{result.title}</p>
                              <p className="text-[9px] text-gray-500 uppercase tracking-widest truncate">
                                {result.channelTitle}
                              </p>
                            </div>
                            <span className="text-[9px] uppercase tracking-[0.3em] text-white/30">YT</span>
                          </div>
                          <div className="mt-3 space-y-2">
                            {rowState !== 'idle' && (
                              <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-gray-400">
                                {isBusy && (
                                  <span className="inline-flex h-3 w-3 animate-spin rounded-full border-2 border-[#D0BCFF] border-t-transparent" />
                                )}
                                <span>{rowMessage || rowState}</span>
                              </div>
                            )}
                            {previewError && (
                              <div className="flex items-center gap-2">
                                <p className="text-[9px] text-[#F2B8B5]">{previewError}</p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewErrors((prev) => {
                                      const next = { ...prev };
                                      delete next[result.videoId];
                                      return next;
                                    })
                                  }
                                  className="text-[9px] uppercase tracking-widest text-[#D0BCFF]"
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                            {rowState === 'error' && (
                              <div className="flex items-center gap-2">
                                <p className="text-[9px] text-[#F2B8B5]">
                                  {rowMessage || 'Failed to fetch audio.'}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => onPreflightYouTube(nextDraft)}
                                  className="text-[9px] uppercase tracking-widest text-[#D0BCFF]"
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isPreviewing) {
                                    stopPreview();
                                    return;
                                  }
                                  selectYouTubeResult(result);
                                  handlePreview(nextDraft, result.videoId);
                                }}
                                className="text-[9px] font-black uppercase tracking-widest bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
                                disabled={Boolean(previewError) || (!isPreviewing && isBusy)}
                              >
                                {isPreviewing ? 'Stop' : 'Preview'}
                              </button>
                              {showCancel && (
                                <button
                                  type="button"
                                  onClick={() => onCancelYouTube(result.videoId)}
                                  className="text-[9px] font-black uppercase tracking-widest text-[#F2B8B5] px-3 py-1.5 rounded-full border border-[#F2B8B5]/40"
                                >
                                  Cancel
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  selectYouTubeResult(result);
                                  onPreflightYouTube(nextDraft);
                                }}
                                className="text-[9px] font-black uppercase tracking-widest bg-[#D0BCFF] text-black px-3 py-1.5 rounded-full shadow-[0_0_16px_rgba(208,188,255,0.4)]"
                              >
                                Use
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {query.length > 0 && !loading && results.length === 0 && (
                      <p className="text-center text-[9px] uppercase tracking-widest text-gray-500 py-6">No results found</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="m3-card bg-[#15131A]/80 border border-white/10 rounded-2xl p-5 space-y-4">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Upload</label>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const meta = await onLocalFileSelected(file);
                        if (!meta) {
                          setRecordingError('Local storage unavailable for samples.');
                          return;
                        }
                        setDraft((prev) => ({
                          ...prev,
                          sourceType: 'local',
                          sourceId: meta.sourceId,
                          sampleName: meta.sampleName,
                          sourceLabel: 'Local File',
                          duration: meta.duration,
                          trimStart: 0,
                          trimEnd: meta.duration,
                          trimLength: meta.duration,
                          trimLock: false,
                        }));
                      }}
                      className="w-full text-xs text-gray-400 file:bg-[#2B2930] file:text-white file:border-none file:px-4 file:py-2 file:rounded-full file:text-[10px] file:font-black file:uppercase file:tracking-widest"
                    />
                  </div>
                  <div className="m3-card bg-[#15131A]/80 border border-white/10 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Record</p>
                        <p className="text-[11px] text-white/60">Capture a microphone sample for this pad.</p>
                      </div>
                      <span className="text-[9px] uppercase tracking-[0.3em] text-white/30">Mic</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/60">
                          {isRecording ? 'Recording' : 'Ready'}
                        </p>
                        <p className="text-xs text-white">{recordingTime}</p>
                      </div>
                      <button
                        type="button"
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={activeTab !== 'local'}
                        className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition ${
                          isRecording
                            ? 'bg-[#F2B8B5] text-black shadow-[0_0_18px_rgba(242,184,181,0.5)]'
                            : 'bg-[#D0BCFF] text-black shadow-[0_0_18px_rgba(208,188,255,0.4)]'
                        }`}
                      >
                        {isRecording ? 'Stop' : 'Record'}
                      </button>
                    </div>
                    {recordingError && <p className="text-[10px] text-[#F2B8B5]">{recordingError}</p>}
                    <p className="text-[10px] text-white/40">
                      Your recording will save to the pad and can be trimmed like any local sample.
                    </p>
                    <p className="text-[10px] text-white/40">
                      Recording requires a minimum of 1.2 seconds. Speak clearly into your microphone.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-5 bg-gradient-to-br from-[#14121C]/90 via-[#111018]/95 to-[#0B0A10]/90 rounded-2xl border border-white/10 p-6 min-w-0 shadow-[0_10px_30px_rgba(9,8,14,0.55)]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Trim</p>
                <button
                  type="button"
                  onClick={() => {
                    if (previewingType && previewingType === draft.sourceType && previewingId === draft.sourceId) {
                      stopPreview();
                      return;
                    }
                    handlePreview(draft, null);
                  }}
                  className="text-[10px] font-black uppercase tracking-widest bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-full shadow-[0_0_12px_rgba(208,188,255,0.15)] disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={draft.sourceType === 'empty'}
                >
                  {previewingType && previewingType === draft.sourceType && previewingId === draft.sourceId
                    ? 'Stop Test'
                    : 'Test Selection'}
                </button>
              </div>
              {generalPreviewError && (
                <p className="text-[10px] text-[#F2B8B5]">{generalPreviewError}</p>
              )}

              {showTrimWaveform && currentWaveform && (
                <TrimWaveform
                  duration={duration}
                  waveform={currentWaveform}
                  trimStart={draft.trimStart}
                  trimEnd={draft.trimEnd}
                  trimLock={draft.trimLock ?? false}
                  trimLength={trimLength}
                  onChangeStart={(time) => handleTrimChange('trimStart', time)}
                  onChangeEnd={(time) => handleTrimChange('trimEnd', time)}
                  onMoveWindow={(start, end) => {
                    handleTrimChange('trimStart', start);
                    handleTrimChange('trimEnd', end);
                  }}
                />
              )}
              {showWaveformStatus && (
                <div className="rounded-2xl border border-white/10 bg-[#0D0C11] px-4 py-3 text-[10px] text-white/60">
                  Building waveform...
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/60">
                <button
                  type="button"
                  onClick={handleFitToLength}
                  className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white"
                  disabled={draft.sourceType === 'empty'}
                >
                  Fit to Full Length
                </button>
                <button
                  type="button"
                  onClick={() => handleTrimLockToggle(!draft.trimLock)}
                  className={`px-3 py-1.5 rounded-full border transition ${
                    draft.trimLock
                      ? 'bg-[#D0BCFF] text-black border-[#D0BCFF]'
                      : 'bg-white/10 text-white border-white/10 hover:border-white/30'
                  }`}
                  disabled={draft.sourceType === 'empty'}
                >
                  {draft.trimLock ? 'Fixed Length On' : 'Fixed Length Off'}
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-white/60">
                  <span>Start</span>
                </div>
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
                  onWheel={handleTrimWheel('trimStart')}
                  inputMode="decimal"
                  className="w-full bg-[#0F0E13] border border-white/10 rounded-xl p-2.5 text-xs text-white"
                  placeholder="0:00.00"
                  disabled={draft.sourceType === 'empty'}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-white/60">
                  <span>End</span>
                </div>
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
                  onWheel={handleTrimWheel('trimEnd')}
                  inputMode="decimal"
                  className="w-full bg-[#0F0E13] border border-white/10 rounded-xl p-2.5 text-xs text-white"
                  placeholder="0:00.00"
                  disabled={draft.sourceType === 'empty'}
                />
                {!validation.trimValid && (
                  <p className="text-[10px] text-[#F2B8B5]">End time must be greater than start.</p>
                )}
              </div>

              <details className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                <summary className="text-[10px] font-black uppercase tracking-widest text-gray-500 cursor-pointer">
                  Advanced Trim Sliders
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-white/60">
                      <span>Start Range</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={maxTrim}
                      step={0.1}
                      value={draft.trimStart}
                      onChange={(event) => handleTrimChange('trimStart', parseFloat(event.target.value))}
                      onWheel={handleTrimWheel('trimStart')}
                      className="w-full accent-[#D0BCFF]"
                      disabled={draft.sourceType === 'empty'}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-white/60">
                      <span>End Range</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={maxTrim}
                      step={0.1}
                      value={draft.trimEnd}
                      onChange={(event) => handleTrimChange('trimEnd', parseFloat(event.target.value))}
                      onWheel={handleTrimWheel('trimEnd')}
                      className="w-full accent-[#D0BCFF]"
                      disabled={draft.sourceType === 'empty'}
                    />
                  </div>
                </div>
              </details>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-white/60">
                  <span>Fixed Length</span>
                  <span>{trimLength.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={maxTrim}
                  step={0.1}
                  value={trimLength}
                  onChange={(event) => handleTrimLengthChange(parseFloat(event.target.value))}
                  className="w-full accent-[#D0BCFF]"
                  disabled={draft.sourceType === 'empty'}
                />
                <input
                  type="number"
                  min={0.1}
                  max={maxTrim}
                  step={0.1}
                  value={Number(trimLength.toFixed(2))}
                  onChange={(event) => handleTrimLengthChange(parseFloat(event.target.value))}
                  className="w-full bg-[#0F0E13] border border-white/10 rounded-xl p-2.5 text-xs text-white"
                  disabled={draft.sourceType === 'empty'}
                />
              </div>

              <div className="space-y-3 border-t border-white/10 pt-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Playback</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['ONE_SHOT', 'HOLD'] as PerformancePadMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, mode }))}
                      className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition ${
                        draft.mode === mode
                          ? 'bg-white/15 border-white/30 text-white shadow-[0_0_12px_rgba(208,188,255,0.2)]'
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
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/10 px-6 py-4 bg-gradient-to-r from-[#181520] via-[#121018] to-[#100F15]">
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-black uppercase tracking-widest text-[#F2B8B5] border border-[#F2B8B5]/40 px-4 py-2 rounded-full hover:bg-[#F2B8B5]/10"
          >
            Clear Pad
          </button>
          <div className="flex items-center gap-3">
            {draft.sourceType === 'youtube' && isYouTubeBusy && (
              <p className="text-[10px] text-gray-500">Waiting for YouTube audio to get ready...</p>
            )}
            <button
              type="button"
              onClick={handleClose}
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

  return createPortal(dialog, document.body);
};

export default PerformancePadDialog;
