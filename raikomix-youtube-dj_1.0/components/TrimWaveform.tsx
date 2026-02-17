import React, { useCallback, useMemo, useRef } from 'react';
import type { WaveformData } from '../types';
import Waveform from './Waveform';

interface TrimWaveformProps {
  duration: number;
  waveform?: WaveformData;
  peaks?: number[];
  trimStart: number;
  trimEnd: number;
  trimLock: boolean;
  trimLength: number;
  onChangeStart: (time: number) => void;
  onChangeEnd: (time: number) => void;
  onMoveWindow?: (start: number, end: number) => void;
}

type DragMode = 'start' | 'end' | 'move';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const TrimWaveform: React.FC<TrimWaveformProps> = ({
  duration,
  waveform,
  peaks,
  trimStart,
  trimEnd,
  trimLock,
  trimLength,
  onChangeStart,
  onChangeEnd,
  onMoveWindow,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    pointerId: number;
    startX: number;
    startStart: number;
    startEnd: number;
  } | null>(null);

  const safeDuration = Math.max(0, duration);
  const startPct = safeDuration > 0 ? clamp01(trimStart / safeDuration) * 100 : 0;
  const endPct = safeDuration > 0 ? clamp01(trimEnd / safeDuration) * 100 : 0;
  const selectionWidth = Math.max(0, endPct - startPct);

  const selectionLabel = useMemo(() => {
    if (!safeDuration) return 'Selection';
    return trimLock ? `Fixed window ${trimLength.toFixed(2)}s` : 'Selection';
  }, [safeDuration, trimLock, trimLength]);

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || safeDuration <= 0) return 0;
      const ratio = clamp01((clientX - rect.left) / rect.width);
      return ratio * safeDuration;
    },
    [safeDuration]
  );

  const handlePointerDown = useCallback(
    (mode: DragMode) => (event: React.PointerEvent<HTMLDivElement>) => {
      if (safeDuration <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      overlayRef.current?.setPointerCapture(event.pointerId);
      dragRef.current = {
        mode,
        pointerId: event.pointerId,
        startX: event.clientX,
        startStart: trimStart,
        startEnd: trimEnd,
      };
    },
    [safeDuration, trimEnd, trimStart]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || safeDuration <= 0) return;
      const deltaX = event.clientX - drag.startX;
      const deltaTime = (deltaX / rect.width) * safeDuration;
      if (drag.mode === 'start') {
        onChangeStart(drag.startStart + deltaTime);
      } else if (drag.mode === 'end') {
        onChangeEnd(drag.startEnd + deltaTime);
      } else {
        const nextStart = drag.startStart + deltaTime;
        const nextEnd = drag.startEnd + deltaTime;
        if (trimLock) {
          onChangeStart(nextStart);
        } else if (onMoveWindow) {
          onMoveWindow(nextStart, nextEnd);
        } else {
          onChangeStart(nextStart);
          onChangeEnd(nextEnd);
        }
      }
    },
    [onChangeEnd, onChangeStart, onMoveWindow, safeDuration, trimLock]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      overlayRef.current?.releasePointerCapture(event.pointerId);
    } catch (error) {
      console.warn('[TrimWaveform] releasePointerCapture failed', error);
    }
  }, []);

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      // Clicking outside the selection nudges the trim start to the clicked time.
      onChangeStart(getTimeFromClientX(event.clientX));
    },
    [getTimeFromClientX, onChangeStart]
  );

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-gray-500">Waveform Trim</p>
      <div
        ref={containerRef}
        className="relative w-full h-24 rounded-2xl border border-white/10 bg-[#0D0C11] overflow-hidden"
      >
        <Waveform
          isPlaying={false}
          volume={1}
          color="#D0BCFF"
          playbackRate={1}
          currentTime={0}
          duration={safeDuration}
          waveform={waveform}
          peaks={peaks}
          className="absolute inset-0"
          minHeightPx={96}
        />
        <div
          ref={overlayRef}
          className="absolute inset-0 touch-none"
          onPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className="absolute inset-y-0"
            style={{ left: `${startPct}%`, width: `${selectionWidth}%` }}
            onPointerDown={handlePointerDown('move')}
            role="presentation"
            aria-label={selectionLabel}
          >
            <div className="absolute inset-0 rounded-lg bg-[rgba(208,188,255,0.12)] border border-[rgba(208,188,255,0.25)]" />
            <div className="absolute inset-y-0 left-0 w-px bg-[#D0BCFF] shadow-[0_0_10px_rgba(208,188,255,0.65)]" />
            <div className="absolute inset-y-0 right-0 w-px bg-[#D0BCFF] shadow-[0_0_10px_rgba(208,188,255,0.65)]" />
            {!trimLock && (
              <>
                <div
                  className="absolute inset-y-2 -left-1.5 w-3 rounded-full bg-[#D0BCFF] shadow-[0_0_12px_rgba(208,188,255,0.8)] cursor-ew-resize"
                  onPointerDown={handlePointerDown('start')}
                />
                <div
                  className="absolute inset-y-2 -right-1.5 w-3 rounded-full bg-[#D0BCFF] shadow-[0_0_12px_rgba(208,188,255,0.8)] cursor-ew-resize"
                  onPointerDown={handlePointerDown('end')}
                />
              </>
            )}
            {trimLock && (
              <div className="absolute inset-y-2 -right-1.5 w-3 rounded-full bg-[#D0BCFF] shadow-[0_0_12px_rgba(208,188,255,0.8)] opacity-60" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrimWaveform;
