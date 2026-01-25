
import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  isPlaying: boolean;
  volume: number;
  color: string;
  playbackRate: number;
  currentTime: number;
  duration: number;
  peaks?: number[];
  sourceType?: 'youtube' | 'local';
}

const Waveform: React.FC<WaveformProps> = ({ isPlaying, volume, color, playbackRate, currentTime, duration, peaks, sourceType = 'youtube' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const offsetRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

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

  const drawPeaks = (ctx: CanvasRenderingContext2D, width: number, height: number, progress: number) => {
    if (!peaks || peaks.length === 0) return;
    const centerY = height / 2;
    const barWidth = width / peaks.length;
    const baseLineWidth = Math.max(1, barWidth * 0.7);

    ctx.lineCap = 'round';
    ctx.lineWidth = baseLineWidth;
    ctx.strokeStyle = `${color}88`;
    ctx.shadowBlur = 0;
    ctx.beginPath();

    peaks.forEach((peak, index) => {
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
      ctx.shadowBlur = 12;
      ctx.shadowColor = color;
      ctx.beginPath();
      peaks.forEach((peak, index) => {
        const x = index * barWidth + barWidth / 2;
        const amplitude = peak * (height * 0.46);
        ctx.moveTo(x, centerY - amplitude);
        ctx.lineTo(x, centerY + amplitude);
      });
      ctx.stroke();
      ctx.restore();
    }

    ctx.shadowBlur = 12;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const playheadX = Math.min(width, Math.max(0, progress * width));
    ctx.beginPath();
    ctx.moveTo(playheadX, height * 0.1);
    ctx.lineTo(playheadX, height * 0.9);
    ctx.stroke();
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    resizeCanvas();
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const progress = duration > 0 ? currentTime / duration : 0;

    if (peaks && peaks.length > 0) {
      drawPeaks(ctx, width, height, progress);
      requestRef.current = requestAnimationFrame(draw);
      return;
    }

    const centerY = height / 2;
    const amplitude = isPlaying ? (height / 3) * (volume / 100) : 2;
    const frequency = 0.015;
    const speed = isPlaying ? 0.15 * playbackRate : 0.01;

    offsetRef.current += speed;

    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.shadowBlur = isPlaying ? 10 : 0;
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
    ctx.globalAlpha = 0.3;
    for (let x = 0; x < width; x += 5) {
      const yOffset = Math.cos(x * frequency * 0.8 - offsetRef.current * 0.5) * (amplitude * 0.6);
      if (x === 0) ctx.moveTo(x, centerY + yOffset);
      else ctx.lineTo(x, centerY + yOffset);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    if (sourceType === 'youtube') {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
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
  }, [isPlaying, volume, playbackRate, color, peaks, currentTime, duration, sourceType]);

  return (
    <div className="w-full h-24 bg-black/60 rounded-lg overflow-hidden border border-white/5 shadow-inner relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent pointer-events-none" />
      <canvas 
        ref={canvasRef} 
        className="w-full h-full"
      />
    </div>
  );
};

export default Waveform;
