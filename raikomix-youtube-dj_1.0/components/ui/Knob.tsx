import React from 'react';

type KnobSize = 'xs' | 'sm' | 'md';

type KnobProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;

  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  size?: KnobSize;
};

const sizeClass: Record<KnobSize, string> = {
  xs: 'w-10',
  sm: 'w-12',
  md: 'w-14',
};

export default function Knob({
  label,
  value,
  onChange,
  color,
  min = 0,
  max = 2,
  step = 0.001,
  defaultValue,
  size = 'md',
}: KnobProps) {
  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => {
          if (defaultValue !== undefined) onChange(defaultValue);
        }}
        className={sizeClass[size]}
        style={{ accentColor: color }}
      />
    </div>
  );
}
