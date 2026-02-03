
import React, { useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: 'bg-green-500 border-green-400 text-black',
    error: 'bg-red-500 border-red-400 text-white',
    info: 'bg-[#D0BCFF] border-[#D0BCFF] text-black',
    warning: 'bg-amber-400 border-amber-300 text-black',
  };

  return (
    <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[3000] px-6 py-3 rounded-2xl border shadow-2xl flex items-center gap-3 animate-fade-in ${colors[type]}`}>
      <span className="text-xs font-black uppercase tracking-[0.2em]">{message}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100"><span className="material-symbols-outlined text-sm">close</span></button>
    </div>
  );
};

export default Toast;
