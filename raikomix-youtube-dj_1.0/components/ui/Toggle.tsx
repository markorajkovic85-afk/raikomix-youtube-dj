import React from 'react';

type ToggleProps = {
  checked: boolean;
  onChange: () => void;
  label?: string;
};

export default function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
        checked
          ? 'bg-[#D0BCFF]/20 text-[#D0BCFF] border-[#D0BCFF]/40'
          : 'bg-black/30 text-gray-400 border-white/10 hover:text-white'
      }`}
      aria-pressed={checked}
    >
      {label ?? 'Toggle'}
    </button>
  );
}
