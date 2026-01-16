
import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  isPlaying: boolean;
  volume: number;
  color: string;
  playbackRate: number;
}

const Waveform: React.FC<WaveformProps> = ({ isPlaying, volume, color, playbackRate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const offsetRef = useRef(0);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    
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

    // Secondary wave for depth
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

    requestRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, volume, playbackRate, color]);

  return (
    <div className="w-full h-24 bg-black/60 rounded-lg overflow-hidden border border-white/5 shadow-inner relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent pointer-events-none" />
      <canvas 
        ref={canvasRef} 
        width={800} 
        height={120} 
        className="w-full h-full"
      />
    </div>
  );
};

export default Waveform;
