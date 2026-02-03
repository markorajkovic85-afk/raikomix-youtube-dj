import React from 'react';

type FaderProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;

  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;

  horizontal?: boolean;
};

export default function Fader({
  label,
  value,
  onChange,
  color,
  min = 0,
  max = 1,
  step = 0.001,
  defaultValue,
  horizontal = false,
}: FaderProps) {
  return (
    <div className="flex flex-col items-center gap-1 select-none">
      {label ? (
        <span className="text-[10px] uppercase tracking-widest text-gray-500">{label}</span>
      ) : null}

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
        className={horizontal ? 'w-36' : 'h-32'}
        style={{
          accentColor: color,
          ...(horizontal
            ? {}
            : ({ WebkitAppearance: 'slider-vertical', appearance: 'slider-vertical' as any } as any)),
        }}
      />
    </div>
  );
}
