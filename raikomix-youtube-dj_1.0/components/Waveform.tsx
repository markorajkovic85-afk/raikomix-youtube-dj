import React, { useEffect, useMemo, useRef, useState } from 'react';

interface WaveformProps {
  isPlaying: boolean;
  volume: number;
  color: string;
  playbackRate: number;
  currentTime: number;
  duration: number;
  peaks?: number[];
  sourceType?: 'youtube' | 'local';
  hotCues?: Array<number | null>;
  cueColors?: string[];
  loop?: { active: boolean; start: number; end: number };
  onSeek?: (time: number) => void;
  timeLabel?: string;
  onTimeToggle?: () => void;
}

const defaultCueColors = ['#FFD700', '#00E5FF', '#FF4081', '#76FF03'];
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.15;

const Waveform: React.FC<WaveformProps> = ({
  isPlaying,
  volume,
  color,
  playbackRate,
  currentTime,
  duration,
  peaks,
  sourceType = 'youtube',
  hotCues = [],
  cueColors = defaultCueColors,
  loop,
  onSeek,
  timeLabel,
  onTimeToggle
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  const offsetRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const [zoomLevel, setZoomLevel] = useState(MIN_ZOOM);

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(width * dpr));
    const nextHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      sizeRef.current = { width: nextWidth, height: nextHeight, dpr };
    }
  };

  const drawMarkers = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    visibleStart: number,
    visibleDuration: number
  ) => {
    if (duration <= 0 || visibleDuration <= 0) return;
    const toX = (time: number) => ((time - visibleStart) / visibleDuration) * width;

    if (loop?.active && loop.end > loop.start) {
      const startX = Math.max(0, toX(loop.start));
      const endX = Math.min(width, toX(loop.end));
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.fillRect(startX, 0, endX - startX, height);
      ctx.restore();
    }

    hotCues.forEach((cue, index) => {
      if (cue === null || cue === undefined) return;
      if (cue < visibleStart || cue > visibleStart + visibleDuration) return;
      const x = Math.min(width, Math.max(0, toX(cue)));
      ctx.save();
      ctx.strokeStyle = cueColors[index] || color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 6;
      ctx.shadowColor = cueColors[index] || color;
      ctx.beginPath();
      ctx.moveTo(x, height * 0.15);
      ctx.lineTo(x, height * 0.85);
      ctx.stroke();
      ctx.restore();
    });
  };

  const drawPeaks = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    visibleStart: number,
    visibleDuration: number
  ) => {
    if (!peaks || peaks.length === 0) return;
    const totalPeaks = peaks.length;
    const startIndex = Math.max(0, Math.floor((visibleStart / duration) * totalPeaks));
    const endIndex = Math.min(totalPeaks, Math.ceil(((visibleStart + visibleDuration) / duration) * totalPeaks));
    const visiblePeaks = peaks.slice(startIndex, endIndex);
    if (visiblePeaks.length === 0) return;

    const centerY = height / 2;
    const barWidth = width / visiblePeaks.length;
    const baseLineWidth = Math.max(1, barWidth * 0.7);

    ctx.lineCap = 'round';
    ctx.lineWidth = baseLineWidth;
    ctx.strokeStyle = `${color}55`;
    ctx.shadowBlur = 0;
    ctx.beginPath();

    visiblePeaks.forEach((peak, index) => {
      const x = index * barWidth + barWidth / 2;
      const amplitude = peak * (height * 0.42);
      ctx.moveTo(x, centerY - amplitude);
      ctx.lineTo(x, centerY + amplitude);
    });
    ctx.stroke();

    const clampedProgress = Math.min(1, Math.max(0, progress));
    const progressWidth = clampedProgress * width;
    if (progressWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, progressWidth, height);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = color;
      ctx.beginPath();
      visiblePeaks.forEach((peak, index) => {
        const x = index * barWidth + barWidth / 2;
        const amplitude = peak * (height * 0.42);
        ctx.moveTo(x, centerY - amplitude);
        ctx.lineTo(x, centerY + amplitude);
      });
      ctx.stroke();
      ctx.restore();
    }

    drawMarkers(ctx, width, height, visibleStart, visibleDuration);

    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    const playheadX = Math.min(width, Math.max(0, progress * width));
    ctx.beginPath();
    ctx.moveTo(playheadX, height * 0.1);
    ctx.lineTo(playheadX, height * 0.9);
    ctx.stroke();
  };

  const visibleWindow = useMemo(() => {
    if (duration <= 0) {
      return { start: 0, length: 0 };
    }
    const windowLength = duration / zoomLevel;
    const maxStart = Math.max(0, duration - windowLength);
    const start = Math.min(Math.max(0, currentTime - windowLength / 2), maxStart);
    return { start, length: windowLength };
  }, [currentTime, duration, zoomLevel]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    resizeCanvas();
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const visibleProgress = visibleWindow.length > 0
      ? (currentTime - visibleWindow.start) / visibleWindow.length
      : 0;

    if (peaks && peaks.length > 0) {
      drawPeaks(ctx, width, height, visibleProgress, visibleWindow.start, visibleWindow.length);
      requestRef.current = requestAnimationFrame(draw);
      return;
    }

    const centerY = height / 2;
    const amplitude = isPlaying ? (height / 3.5) * (volume / 100) : 2;
    const frequency = 0.015;
    const speed = isPlaying ? 0.15 * playbackRate : 0.01;

    offsetRef.current += speed;

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `${color}cc`;
    ctx.lineCap = 'round';
    ctx.shadowBlur = isPlaying ? 6 : 0;
    ctx.shadowColor = color;

    for (let x = 0; x < width; x += 3) {
      const yOffset = Math.sin(x * frequency + offsetRef.current) * amplitude;
      const noise = isPlaying ? (Math.random() - 0.5) * (volume / 5) : 0;

      if (x === 0) {
        ctx.moveTo(x, centerY + yOffset + noise);
      } else {
        ctx.lineTo(x, centerY + yOffset + noise);
      }
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.18;
    for (let x = 0; x < width; x += 5) {
      const yOffset = Math.cos(x * frequency * 0.8 - offsetRef.current * 0.5) * (amplitude * 0.6);
      if (x === 0) ctx.moveTo(x, centerY + yOffset);
      else ctx.lineTo(x, centerY + yOffset);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    drawMarkers(ctx, width, height, 0, duration);

    if (sourceType === 'youtube') {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.5);
      ctx.lineTo(width, height * 0.5);
      ctx.stroke();
    }

    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    resizeCanvas();
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, volume, playbackRate, color, peaks, currentTime, duration, sourceType, hotCues, cueColors, loop, visibleWindow]);

  return (
    <div
      ref={containerRef}
      className="waveform-display w-full h-full min-h-[56px] bg-black/70 rounded-xl overflow-hidden border border-white/5 shadow-inner relative min-w-0"
      onClick={(event) => {
        if (!onSeek || duration <= 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const pct = (event.clientX - rect.left) / rect.width;
        const baseStart = peaks && peaks.length > 0 ? visibleWindow.start : 0;
        const baseDuration = peaks && peaks.length > 0 ? visibleWindow.length : duration;
        onSeek(baseStart + pct * baseDuration);
      }}
      onWheel={(event) => {
        if (!peaks || peaks.length === 0) return;
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        setZoomLevel((currentZoom) => {
          const nextZoom = event.deltaY > 0 ? currentZoom / ZOOM_STEP : currentZoom * ZOOM_STEP;
          return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
        });
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/4 to-transparent pointer-events-none" />
      <button
        type="button"
        className="absolute top-2 right-3 text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white transition-colors z-10"
        onClick={(event) => {
          event.stopPropagation();
          onTimeToggle?.();
        }}
        title="Toggle time display"
      >
        {timeLabel ?? '--:--'}
      </button>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
      />
    </div>
  );
};

export default Waveform;
