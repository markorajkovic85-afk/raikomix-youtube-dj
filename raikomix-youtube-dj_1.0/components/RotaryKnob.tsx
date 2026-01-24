import React, { useEffect, useRef, useState } from 'react';

interface RotaryKnobProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onReset: () => void;
  color: string;
  disabled?: boolean;
  mixed?: boolean;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const RotaryKnob: React.FC<RotaryKnobProps> = ({
  label,
  value,
  onChange,
  onReset,
  color,
  disabled = false,
  mixed = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(0);
  const activePointerId = useRef<number | null>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;

  const progress = clamp(value);
  const rotation = progress * 270 - 135;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerId.current = event.pointerId;
    setIsDragging(true);
    startY.current = event.clientY;
    startValue.current = progress;
    document.body.style.cursor = 'ns-resize';
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointerId.current !== event.pointerId) return;
    const deltaY = startY.current - event.clientY;
    const sensitivity = 0.006;
    const next = clamp(startValue.current + deltaY * sensitivity);
    onChange(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    setIsDragging(false);
    document.body.style.cursor = 'default';
  };

  const handleWheel = (event: WheelEvent) => {
    if (disabled) return;
    event.preventDefault();
    const delta = event.deltaY * -0.002;
    onChange(clamp(progress + delta));
  };

  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [progress, disabled]);

  const handleDoubleClick = () => {
    if (disabled) return;
    onReset();
  };

  const dashArray = `${arcLength} ${circumference - arcLength}`;
  const dashOffset = arcLength * (1 - progress);

  return (
    <div className={`flex flex-col items-center gap-1 select-none ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-black uppercase tracking-[0.25em] text-gray-500">
          {label}
        </span>
        {mixed && (
          <span className="text-[7px] font-semibold uppercase tracking-widest text-white/40">Mixed</span>
        )}
      </div>
      <div
        ref={knobRef}
        className={`relative w-12 h-12 flex items-center justify-center touch-none cursor-ns-resize ${
          isDragging ? 'scale-105' : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        title="Double-click to reset (50%)"
      >
        <svg className="w-full h-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="fill-none stroke-white/10"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            strokeDashoffset="0"
            style={{ strokeWidth: 3.5, transform: 'rotate(-135deg)', transformOrigin: '50% 50%' }}
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="fill-none"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            style={{
              stroke: color,
              strokeWidth: 3.5,
              transform: 'rotate(-135deg)',
              transformOrigin: '50% 50%',
              filter: `drop-shadow(0 0 6px ${color}66)`,
              opacity: disabled ? 0.35 : 0.95,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="absolute w-2 h-2 rounded-full"
            style={{
              backgroundColor: color,
              transform: `rotate(${rotation}deg) translateY(-22px)`,
              filter: `drop-shadow(0 0 4px ${color}88)`,
              opacity: disabled ? 0.4 : 0.9,
            }}
          />
          <div className="w-1.5 h-1.5 rounded-full bg-white/70" />
        </div>
      </div>
      <span className="text-[9px] font-mono text-white/60">{Math.round(progress * 100)}%</span>
    </div>
  );
};

export default RotaryKnob;
