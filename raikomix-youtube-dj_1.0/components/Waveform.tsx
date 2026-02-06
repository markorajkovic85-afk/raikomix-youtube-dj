import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WaveformData } from '../types';

interface WaveformProps {
  isPlaying: boolean;
  volume: number;
  color: string;
  playbackRate: number;
  currentTime: number;
  duration: number;

  /** Legacy mono peak envelope (kept for backwards compatibility) */
  peaks?: number[];

  /** Pro waveform data: multi-resolution + (stored stereo + RMS) + optional band mix */
  waveform?: WaveformData;

  sourceType?: 'youtube' | 'local';
  hotCues?: Array<number | null>;
  cueColors?: string[];
  loop?: { active: boolean; start: number; end: number };
  onSeek?: (time: number) => void;
  timeLabel?: string;
  onTimeToggle?: () => void;

  /** Optional styling hooks for ultra-compact layouts */
  className?: string;
  /** Ensures waveform can shrink first, but not collapse */
  minHeightPx?: number;
}

const defaultCueColors = ['#FFD700', '#00E5FF', '#FF4081', '#76FF03'];
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.15;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

const parseHex = (hex: string) => {
  const m = hex.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const raw = m[1];
  const full = raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return { r, g, b };
};

const rgbToHsl = (r8: number, g8: number, b8: number) => {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
};

const bandHsla = (
  baseHex: string,
  which: 'low' | 'mid' | 'high',
  alpha: number
) => {
  const rgb = parseHex(baseHex);
  if (!rgb) {
    // Fallback: just use provided color as rgba-ish tint via globalAlpha usage.
    return baseHex;
  }

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Keep same hue; vary lightness/saturation subtly for a "pro" monochrome depth effect.
  // low: slightly darker/denser, mid: neutral, high: slightly brighter.
  const s2 = clamp01(s * (which === 'mid' ? 1.05 : 0.95));
  const l2 = clamp01(
    which === 'low'
      ? l * 0.78
      : which === 'high'
        ? l + (1 - l) * 0.22
        : l
  );

  const sPct = Math.round(s2 * 100);
  const lPct = Math.round(l2 * 100);

  return `hsla(${Math.round(h)}, ${sPct}%, ${lPct}%, ${alpha})`;
};

const Waveform: React.FC<WaveformProps> = ({
  isPlaying,
  volume,
  color,
  playbackRate,
  currentTime,
  duration,
  peaks,
  waveform,
  sourceType = 'youtube',
  hotCues = [],
  cueColors = defaultCueColors,
  loop,
  onSeek,
  timeLabel,
  onTimeToggle,
  className,
  minHeightPx = 40
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);
  const runningRef = useRef(false);
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

  const drawPlayhead = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    mode: 'soft' | 'strong' = 'soft'
  ) => {
    const p = Math.min(1, Math.max(0, progress));
    const x = Math.min(width, Math.max(0, p * width));

    if (mode === 'soft') {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, x, height);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = mode === 'soft' ? 0.45 : 0.6;
    ctx.shadowBlur = mode === 'soft' ? 10 : 8;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = mode === 'soft' ? 1.4 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x, height * 0.12);
    ctx.lineTo(x, height * 0.88);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = mode === 'soft' ? 0.22 : 0.18;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, height * 0.14);
    ctx.lineTo(x, height * 0.86);
    ctx.stroke();
    ctx.restore();
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

  const pickWaveformLevel = (
    wf: WaveformData,
    widthPx: number,
    visibleDuration: number
  ) => {
    const levels = wf.levels;
    if (!levels || levels.length === 0 || duration <= 0 || visibleDuration <= 0) return null;

    const dpr = sizeRef.current.dpr || 1;
    const cssWidth = widthPx / dpr;

    const targetBarsOnScreen = clamp(Math.round(cssWidth / 2.25), 220, 2200);
    const requiredSamples = Math.round(targetBarsOnScreen * (duration / visibleDuration));

    let best = levels[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const lvl of levels) {
      const score = Math.abs(lvl.samples - requiredSamples);
      if (score < bestScore) {
        best = lvl;
        bestScore = score;
      }
    }
    return best;
  };

  const drawSingleLaneBands = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    visibleStart: number,
    visibleDuration: number
  ) => {
    if (!waveform || waveform.levels.length === 0) return;

    const level = pickWaveformLevel(waveform, width, visibleDuration);
    if (!level) return;

    const total = level.samples;
    const startIndex = Math.max(0, Math.floor((visibleStart / duration) * total));
    const endIndex = Math.min(total, Math.ceil(((visibleStart + visibleDuration) / duration) * total));

    const peakL = level.peakL.slice(startIndex, endIndex);
    const peakR = level.peakR.slice(startIndex, endIndex);
    const rmsL = level.rmsL.slice(startIndex, endIndex);
    const rmsR = level.rmsR.slice(startIndex, endIndex);

    const low = level.bandLow?.slice(startIndex, endIndex);
    const mid = level.bandMid?.slice(startIndex, endIndex);
    const high = level.bandHigh?.slice(startIndex, endIndex);

    const n = Math.min(peakL.length, peakR.length, rmsL.length, rmsR.length);
    if (n <= 0) return;

    const barWidth = width / n;
    const baseLineWidth = Math.max(1, barWidth * 0.7);

    const brightShadowBlur = 3;
    const safePad = Math.ceil(baseLineWidth / 2 + brightShadowBlur + 1);

    const innerTop = safePad;
    const innerBottom = height - safePad;
    const innerHeight = innerBottom - innerTop;
    if (innerHeight <= 6) return;

    const centerY = innerTop + innerHeight * 0.5;
    const laneAmpMax = (innerHeight * 0.5) * 0.46;

    const blend = (p: number, r: number) => clamp(p * 0.65 + r * 0.35, 0, 1);

    const getMix = (i: number) => {
      const l = low?.[i];
      const m = mid?.[i];
      const h = high?.[i];
      if (l === undefined || m === undefined || h === undefined) {
        return { l: 0.22, m: 0.50, h: 0.28 };
      }
      const sum = Math.max(1e-6, l + m + h);
      return { l: l / sum, m: m / sum, h: h / sum };
    };

    const amps: number[] = new Array(n);
    const mixL: number[] = new Array(n);
    const mixM: number[] = new Array(n);
    const mixH: number[] = new Array(n);

    for (let i = 0; i < n; i += 1) {
      const p = Math.max(peakL[i] ?? 0, peakR[i] ?? 0);
      const r = Math.max(rmsL[i] ?? 0, rmsR[i] ?? 0);
      amps[i] = blend(p, r) * laneAmpMax;
      const mix = getMix(i);
      mixL[i] = mix.l;
      mixM[i] = mix.m;
      mixH[i] = mix.h;
    }

    ctx.lineCap = 'round';
    ctx.lineWidth = baseLineWidth;
    ctx.shadowBlur = 0;

    const drawLayer = (which: 'low' | 'mid' | 'high', alpha: number, clipProgress?: number) => {
      const useClip = clipProgress !== undefined;
      if (useClip) {
        const progressWidth = Math.min(1, Math.max(0, clipProgress)) * width;
        if (progressWidth <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, progressWidth, height);
        ctx.clip();
      }

      ctx.strokeStyle = bandHsla(color, which, alpha);

      ctx.beginPath();
      for (let i = 0; i < n; i += 1) {
        const x = i * barWidth + barWidth / 2;
        const a = amps[i] * (which === 'low' ? mixL[i] : which === 'mid' ? mixM[i] : mixH[i]);
        ctx.moveTo(x, centerY - a);
        ctx.lineTo(x, centerY + a);
      }
      ctx.stroke();

      if (useClip) ctx.restore();
    };

    // Base (unplayed): monochrome depth via lightness variation.
    drawLayer('low', 0.30);
    drawLayer('mid', 0.34);
    drawLayer('high', 0.30);

    // Played overlay: brighter + subtle glow.
    ctx.save();
    ctx.shadowBlur = brightShadowBlur;
    ctx.shadowColor = bandHsla(color, 'mid', 0.10);
    drawLayer('low', 0.78, progress);
    drawLayer('mid', 0.84, progress);
    drawLayer('high', 0.78, progress);
    ctx.restore();

    drawMarkers(ctx, width, height, visibleStart, visibleDuration);
    drawPlayhead(ctx, width, height, progress, 'strong');
  };

  const drawPeaksLegacy = (
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
      ctx.shadowBlur = 4;
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
    drawPlayhead(ctx, width, height, clampedProgress, 'strong');
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
    if (!runningRef.current) return;
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

    if (waveform && waveform.levels.length > 0) {
      drawSingleLaneBands(ctx, width, height, visibleProgress, visibleWindow.start, visibleWindow.length);
      if (!runningRef.current) return;
      requestRef.current = requestAnimationFrame(draw);
      return;
    }

    if (peaks && peaks.length > 0) {
      drawPeaksLegacy(ctx, width, height, visibleProgress, visibleWindow.start, visibleWindow.length);
      if (!runningRef.current) return;
      requestRef.current = requestAnimationFrame(draw);
      return;
    }

    // fallback "youtube" idle visualization
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

    const p = duration > 0 ? currentTime / duration : 0;
    drawPlayhead(ctx, width, height, p, 'soft');

    if (!runningRef.current) return;
    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    runningRef.current = true;
    resizeCanvas();
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      runningRef.current = false;
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
      }
      requestRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, volume, playbackRate, color, peaks, waveform, currentTime, duration, sourceType, hotCues, cueColors, loop, visibleWindow]);

  return (
    <div
      ref={containerRef}
      className={[
        "waveform-display w-full h-full bg-black/70 rounded-lg overflow-hidden border border-white/5 shadow-inner relative min-w-0",
        className ?? ""
      ].join(" ")}
      style={{ minHeight: minHeightPx ? `${minHeightPx}px` : undefined }}
      onClick={(event) => {
        if (!onSeek || duration <= 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const pct = (event.clientX - rect.left) / rect.width;
        const hasAnyPeaks = (waveform && waveform.levels.length > 0) || (peaks && peaks.length > 0);
        const baseStart = hasAnyPeaks ? visibleWindow.start : 0;
        const baseDuration = hasAnyPeaks ? visibleWindow.length : duration;
        onSeek(baseStart + pct * baseDuration);
      }}
      onWheel={(event) => {
        const hasAnyPeaks = (waveform && waveform.levels.length > 0) || (peaks && peaks.length > 0);
        if (!hasAnyPeaks) return;
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
        className="absolute top-1 right-2 text-[9px] font-black uppercase tracking-widest text-white/60 hover:text-white transition-colors z-10"
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
