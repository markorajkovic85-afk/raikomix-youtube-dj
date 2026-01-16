
import React, { useState, useEffect } from 'react';
import { YouTubeSearchResult, DeckId } from '../types';
import { searchYouTube } from '../utils/youtubeApi';

interface SearchPanelProps {
  onLoadToDeck: (videoId: string, url: string, deck: DeckId, title: string, author: string) => void;
  onAddToQueue: (result: YouTubeSearchResult) => void;
  onAddToLibrary: (result: YouTubeSearchResult) => void;
}

const SearchPanel: React.FC<SearchPanelProps> = ({ onLoadToDeck, onAddToQueue, onAddToLibrary }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

   const resetSearch = () => {
    setQuery('');
    setResults([]);
    setLoading(false);
  };

  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
     if (query.trim().length < 3) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const res = await searchYouTube(query);
      setResults(res);
      setLoading(false);
    }, 500);
    return () => clearTimeout(delayDebounce);
  }, [query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <input 
           type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') resetSearch();
          }}
          placeholder="Global YouTube Search..."
          className="w-full bg-[#1D1B20] border border-white/10 rounded-full py-2.5 pl-10 pr-12 text-xs focus:outline-none focus:border-[#D0BCFF] shadow-inner"
        />
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">search</span>
        {loading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#D0BCFF] border-t-transparent rounded-full animate-spin" />}
         {query.length > 0 && !loading && (
          <button
            type="button"
            onClick={resetSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            aria-label="Clear search"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto scrollbar-hide">
        {results.length === 0 && !loading && query.length > 0 && (
          <div className="text-center py-6 text-gray-600 text-[9px] font-black uppercase tracking-widest">No matching tracks found</div>
        )}
        {results.map(r => (
          <div key={r.videoId} className="flex gap-2 p-2 bg-white/5 rounded-xl border border-transparent hover:border-white/10 transition-all group">
            <img src={r.thumbnailUrl} className="w-14 h-10 object-cover rounded-lg shrink-0" alt="" />
            <div className="flex-1 min-w-0">
              <h4 className="text-[10px] font-bold truncate text-white leading-tight">{r.title}</h4>
              <p className="text-[8px] text-gray-500 uppercase mt-0.5">{r.channelTitle}</p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
              <button onClick={() => onLoadToDeck(r.videoId, `https://www.youtube.com/watch?v=${r.videoId}`, 'A', r.title, r.channelTitle)} className="w-6 h-6 bg-[#D0BCFF] text-black rounded-md text-[9px] font-black">A</button>
              <button onClick={() => onLoadToDeck(r.videoId, `https://www.youtube.com/watch?v=${r.videoId}`, 'B', r.title, r.channelTitle)} className="w-6 h-6 bg-[#F2B8B5] text-black rounded-md text-[9px] font-black">B</button>
               <button onClick={() => onAddToLibrary(r)} className="w-6 h-6 bg-white/10 text-white rounded-md flex items-center justify-center" title="Add to Library">
                <span className="material-symbols-outlined text-xs">library_add</span>
              </button>
              <button onClick={() => onAddToQueue(r)} className="w-6 h-6 bg-white/10 text-white rounded-md flex items-center justify-center"><span className="material-symbols-outlined text-xs">add</span></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SearchPanel;
