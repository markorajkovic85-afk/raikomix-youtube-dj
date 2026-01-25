import React, { useRef, useState, useEffect } from 'react';
import { QueueItem, DeckId } from '../types';
import { exportQueue } from '../utils/queueStorage';

interface QueuePanelProps {
  queue: QueueItem[];
  autoDjEnabled: boolean;
  mixLeadSeconds: number;
  mixDurationSeconds: number;
  onToggleAutoDj: () => void;
  onMixLeadChange: (value: number) => void;
  onMixDurationChange: (value: number) => void;
  onLoadToDeck: (item: QueueItem, deck: DeckId) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onReorder: (from: number, to: number) => void;
}

const MarqueeText: React.FC<{ text: string; className: string; forceAnimate?: boolean }> = ({ text, className, forceAnimate = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (containerRef.current && textRef.current) {
      setShouldAnimate(forceAnimate || textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [forceAnimate, text]);

  return (
    <div ref={containerRef} className="marquee-container w-full">
      <div 
        ref={textRef} 
        className={`${className} marquee-text ${shouldAnimate ? 'animate-marquee' : ''}`}
      >
        {text}
        {shouldAnimate && <span className="ml-12">{text}</span>}
      </div>
    </div>
  );
};

const QueuePanel: React.FC<QueuePanelProps> = ({
  queue,
  autoDjEnabled,
  mixLeadSeconds,
  mixDurationSeconds,
  onToggleAutoDj,
  onMixLeadChange,
  onMixDurationChange,
  onLoadToDeck,
  onRemove,
  onClear,
  onReorder
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) {
      handleDragEnd();
      return;
    }
    onReorder(dragIndex, index);
    handleDragEnd();
  };

  const handleMove = (from: number, to: number) => {
    if (to < 0 || to >= queue.length) return;
    onReorder(from, to);
  };

  return (
    <div className="flex flex-col h-full gap-4 elevation-2">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-xs font-black uppercase tracking-widest text-gray-500">Play Queue ({queue.length})</h3>
        {queue.length > 0 && (
         <div className="flex items-center gap-2">
            <button
              onClick={() => exportQueue(queue)}
              className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white"
              title="Export Queue JSON"
            >
              <span className="material-symbols-outlined text-sm">download</span>
            </button>
            <button 
              onClick={onClear}
              className="text-[10px] font-bold text-red-400/60 hover:text-red-400 uppercase tracking-tighter motion-standard"
            >
              Clear All
            </button>
          </div>
        )}
      </div>
      {queue.length > 1 && (
        <div className="px-2 text-[9px] uppercase tracking-[0.3em] text-gray-600">
          Drag to reorder
        </div>
      )}

      <div className="rounded-xl border border-white/5 bg-black/30 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Auto DJ</span>
            <span className="text-[9px] text-gray-500">Autoplay + mix next queue item</span>
          </div>
          <button
            onClick={onToggleAutoDj}
            className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
              autoDjEnabled
                ? 'bg-[#D0BCFF]/20 text-[#D0BCFF] border-[#D0BCFF]/40'
                : 'bg-black/40 text-gray-500 border-white/10'
            }`}
          >
            {autoDjEnabled ? 'On' : 'Off'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[9px] uppercase tracking-widest text-gray-500">
          <label className="flex flex-col gap-1">
            Mix Lead (sec)
            <input
              type="number"
              min={4}
              max={30}
              value={mixLeadSeconds}
              onChange={(e) => onMixLeadChange(Number(e.target.value))}
              className="mix-number-input w-full rounded-md bg-black/40 border border-white/10 px-2 py-1 text-[10px] text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            Mix Duration (sec)
            <input
              type="number"
              min={2}
              max={20}
              value={mixDurationSeconds}
              onChange={(e) => onMixDurationChange(Number(e.target.value))}
              className="mix-number-input w-full rounded-md bg-black/40 border border-white/10 px-2 py-1 text-[10px] text-white"
            />
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-hide">
        {queue.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 opacity-50">
            <span className="material-symbols-outlined text-4xl mb-2">queue_music</span>
            <p className="text-xs uppercase tracking-widest font-bold">Queue is empty</p>
          </div>
        )}

        {queue.map((item, index) => (
          <div
            key={item.id}
            className={`m3-card group p-3 flex gap-4 items-center bg-[#1C1B1F]/40 hover:bg-[#2B2930] motion-standard border-dashed elevation-1 hover:elevation-2 overflow-hidden ${
              overIndex === index ? 'ring-1 ring-[#D0BCFF]/40' : ''
            }`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              handleDragStart(index);
            }}
            onDragEnd={handleDragEnd}
            onDragOver={(event) => {
              event.preventDefault();
              if (overIndex !== index) setOverIndex(index);
            }}
            onDragLeave={() => {
              if (overIndex === index) setOverIndex(null);
            }}
            onDrop={() => handleDrop(index)}
          >
            <span className="text-[10px] font-mono text-gray-600 w-4">{index + 1}</span>
            <span className="material-symbols-outlined text-gray-600 text-sm cursor-grab">drag_indicator</span>
            <div className="w-12 h-12 bg-black rounded overflow-hidden flex-shrink-0 elevation-1">
              <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-2 overflow-hidden">
              <MarqueeText 
                text={item.title} 
                className="text-sm font-semibold text-[#E6E1E5] leading-tight" 
              />
              <div className="rounded-full border border-white/5 bg-black/40 px-2 py-0.5">
                <MarqueeText 
                  text={item.author || 'Unknown Artist'} 
                  className="text-[9px] text-gray-300 font-semibold uppercase tracking-[0.2em]" 
                  forceAnimate
                />
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 motion-standard">
              <button 
                onClick={() => onLoadToDeck(item, 'A')}
                className="px-2 py-1 rounded bg-[#D0BCFF]/10 text-[#D0BCFF] text-[10px] font-black motion-emphasized elevation-1 hover:elevation-2"
              >
                A
              </button>
              <button 
                onClick={() => onLoadToDeck(item, 'B')}
                className="px-2 py-1 rounded bg-[#F2B8B5]/10 text-[#F2B8B5] text-[10px] font-black motion-emphasized elevation-1 hover:elevation-2"
              >
                B
              </button>
              <button 
                onClick={() => onRemove(item.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:text-red-400 motion-standard"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
              <div className="flex flex-col">
                <button
                  onClick={() => handleMove(index, index - 1)}
                  className="w-6 h-4 flex items-center justify-center text-gray-500 hover:text-white"
                  title="Move up"
                >
                  <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
                </button>
                <button
                  onClick={() => handleMove(index, index + 1)}
                  className="w-6 h-4 flex items-center justify-center text-gray-500 hover:text-white"
                  title="Move down"
                >
                  <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default QueuePanel;
