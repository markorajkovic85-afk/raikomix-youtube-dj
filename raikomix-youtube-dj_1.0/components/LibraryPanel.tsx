import React, { useState, useEffect, useRef } from 'react';
import { LibraryTrack, Playlist, DeckId } from '../types';
import { exportLibrary, loadPlaylists, savePlaylists } from '../utils/libraryStorage';
import { extractPlaylistId, fetchPlaylistItems } from '../utils/youtubeApi';

interface LibraryPanelProps {
  library: LibraryTrack[];
  onAddSingle: (url: string) => void;
  onRemove: (id: string) => void;
  onRemoveMultiple: (ids: string[]) => void;
  onLoadToDeck: (track: LibraryTrack, deck: DeckId) => void;
  onAddToQueue: (track: LibraryTrack) => void;
  onUpdateMetadata: (videoId: string, meta: { title?: string, author?: string, album?: string }) => void;
  onImportLibrary: (tracks: LibraryTrack[] | ((prev: LibraryTrack[]) => LibraryTrack[])) => void;
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({
  library, onAddSingle, onRemove, onRemoveMultiple, onLoadToDeck, onAddToQueue, onImportLibrary, onUpdateMetadata
}) => {
  const [url, setUrl] = useState('');
  const [search, setSearch] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>(() => loadPlaylists());
  const [activePl, setActivePl] = useState<string | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [editingTrack, setEditingTrack] = useState<LibraryTrack | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { savePlaylists(playlists); }, [playlists]);

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      onAddSingle(url);
      setUrl('');
    }
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return;
    setIsImporting(true);
    setImportStatus('Initializing ingestion...');
    
    const playlistId = extractPlaylistId(bulkText);
    
    try {
      if (playlistId) {
        const items = await fetchPlaylistItems(playlistId, (loaded, total) => {
          setImportStatus(`Ingesting: ${loaded}${total ? ` / ${total}` : ''} tracks...`);
        });

        if (items.length === 0) {
          throw new Error("No videos found in this playlist.");
        }

        const fetchedTracks: LibraryTrack[] = items.map(t => ({
          id: `yt_${Date.now()}_${t.videoId}_${Math.random().toString(36).substr(2, 4)}`,
          videoId: t.videoId!,
          url: `https://www.youtube.com/watch?v=${t.videoId}`,
          title: t.title || 'Unknown Title',
          author: t.author || 'Unknown Artist',
          thumbnailUrl: t.thumbnailUrl || '',
          addedAt: Date.now(),
          playCount: 0,
          sourceType: 'youtube'
        }));

        onImportLibrary((prevLibrary) => {
          const newTracks = fetchedTracks.filter(
            ft => !prevLibrary.some(existing => existing.videoId === ft.videoId)
          );
          
          if (newTracks.length > 0) {
            setImportStatus(`Success: Ingested ${newTracks.length} new tracks.`);
          } else {
            setImportStatus('Library already contains these tracks.');
          }
          
          return [...prevLibrary, ...newTracks];
        });

        setTimeout(() => {
          setShowBulkAdd(false);
          setBulkText('');
          setImportStatus('');
        }, 2500);

      } else {
        const lines = bulkText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length > 0) {
          lines.forEach(l => onAddSingle(l));
          setShowBulkAdd(false);
          setBulkText('');
        } else {
          setImportStatus('No valid playlist ID or URLs found.');
        }
      }
    } catch (e: any) {
      setImportStatus(`Error: ${e.message}`);
      console.error('Import failed:', e);
    } finally {
      setIsImporting(false);
    }
  };

  const fallbackThumbnail = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="100" viewBox="0 0 140 100">
      <rect width="140" height="100" rx="12" fill="#1f1d24"/>
      <rect x="6" y="6" width="128" height="88" rx="10" fill="#2b2930" stroke="#3b3842" stroke-width="2"/>
      <path d="M46 32c0-3.3 2.7-6 6-6h36c3.3 0 6 2.7 6 6v30a10 10 0 1 1-6-9.2V32H52v34a10 10 0 1 1-6-9.2V32z" fill="#D0BCFF"/>
      <circle cx="54" cy="76" r="6" fill="#1f1d24"/>
      <circle cx="90" cy="76" r="6" fill="#1f1d24"/>
    </svg>`
  )}`;

  const toBase64 = (data: Uint8Array) => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
      binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  const decodeText = (data: Uint8Array, encodingByte: number) => {
    if (data.length === 0) return '';
    switch (encodingByte) {
      case 1: { // utf-16 with BOM
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (data.length >= 2) {
          const bom = view.getUint16(0);
          const isLittleEndian = bom === 0xFFFE;
          const textData = data.subarray(2);
          return new TextDecoder(isLittleEndian ? 'utf-16le' : 'utf-16be').decode(textData).replace(/\0/g, '').trim();
        }
        return '';
      }
      case 2: // utf-16be without BOM
        return new TextDecoder('utf-16be').decode(data).replace(/\0/g, '').trim();
      case 3: // utf-8
        return new TextDecoder('utf-8').decode(data).replace(/\0/g, '').trim();
      default: // iso-8859-1
        return new TextDecoder('iso-8859-1').decode(data).replace(/\0/g, '').trim();
    }
  };

  const readSyncSafeInt = (bytes: Uint8Array) => {
    return (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];
  };

  const parseId3Metadata = (buffer: ArrayBuffer) => {
    const view = new DataView(buffer);
    if (view.byteLength < 10) return null;
    const header = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
    if (header !== 'ID3') return null;
    const version = view.getUint8(3);
    const tagSize = readSyncSafeInt(new Uint8Array(buffer, 6, 4));
    let offset = 10;
    const end = Math.min(view.byteLength, offset + tagSize);
    let title = '';
    let artist = '';
    let album = '';
    let pictureDataUrl = '';

    while (offset + 10 <= end) {
      const frameId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const sizeBytes = new Uint8Array(buffer, offset + 4, 4);
      const frameSize = version === 4 ? readSyncSafeInt(sizeBytes) : view.getUint32(offset + 4);
      if (!frameId.trim() || frameSize <= 0) break;
      const frameStart = offset + 10;
      const frameEnd = frameStart + frameSize;
      if (frameEnd > end) break;

      const frameData = new Uint8Array(buffer, frameStart, frameSize);
      if (frameId === 'TIT2' || frameId === 'TPE1' || frameId === 'TALB') {
        const encodingByte = frameData[0];
        const text = decodeText(frameData.subarray(1), encodingByte);
        if (frameId === 'TIT2') title = text || title;
        if (frameId === 'TPE1') artist = text || artist;
        if (frameId === 'TALB') album = text || album;
      } else if (frameId === 'APIC' && !pictureDataUrl) {
        const encodingByte = frameData[0];
        let idx = 1;
        while (idx < frameData.length && frameData[idx] !== 0x00) idx++;
        const mime = new TextDecoder('iso-8859-1').decode(frameData.subarray(1, idx)) || 'image/jpeg';
        idx += 1; // skip null
        idx += 1; // picture type
        if (encodingByte === 1 || encodingByte === 2) {
          while (idx + 1 < frameData.length && !(frameData[idx] === 0x00 && frameData[idx + 1] === 0x00)) idx += 2;
          idx += 2;
        } else {
          while (idx < frameData.length && frameData[idx] !== 0x00) idx++;
          idx += 1;
        }
        if (idx < frameData.length) {
          const imageData = frameData.subarray(idx);
          const base64 = toBase64(imageData);
          pictureDataUrl = `data:${mime};base64,${base64}`;
        }
      }

      offset = frameEnd;
    }

    return { title, artist, album, pictureDataUrl };
  };

  const readMetadataFromFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      return parseId3Metadata(buffer);
    } catch (error) {
      console.warn('Unable to read metadata for local file:', file.name, error);
      return null;
    }
  };

  const handleLocalFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newTracks: LibraryTrack[] = await Promise.all(
      Array.from(files).map(async (file: File) => {
        const fallbackTitle = file.name.replace(/\.[^/.]+$/, '');
        const fallbackAuthor = 'Unknown Artist';
        const fallbackAlbum = 'Unknown Album';
        let title = fallbackTitle;
        let author = fallbackAuthor;
        let album = fallbackAlbum;
        let thumbnailUrl = fallbackThumbnail;

        const metadata = await readMetadataFromFile(file);
        if (metadata) {
          title = metadata.title || title;
          author = metadata.artist || author;
          album = metadata.album || album;
          if (metadata.pictureDataUrl) {
            thumbnailUrl = metadata.pictureDataUrl;
          }
        }

        return {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          videoId: `local_${file.name}_${Date.now()}`,
          url: URL.createObjectURL(file),
          title,
          author,
          album,
          thumbnailUrl,
          addedAt: Date.now(),
          playCount: 0,
          sourceType: 'local',
          fileName: file.name
        };
      })
    );

    onImportLibrary((prev) => [...prev, ...newTracks]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

 const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const audioFiles = Array.from(files).filter(file =>
      file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg)$/i.test(file.name)
    );

    const newTracks: LibraryTrack[] = await Promise.all(
      audioFiles.map(async (file: File) => {
        const pathParts = file.webkitRelativePath?.split('/') || [];
        const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Unknown Album';
        const fallbackTitle = file.name.replace(/\.[^/.]+$/, '');
        const fallbackAuthor = 'Unknown Artist';
        let title = fallbackTitle;
        let author = fallbackAuthor;
        let album = folderName;
        let thumbnailUrl = fallbackThumbnail;

        const metadata = await readMetadataFromFile(file);
        if (metadata) {
          title = metadata.title || title;
          author = metadata.artist || author;
          album = metadata.album || album;
          if (metadata.pictureDataUrl) {
            thumbnailUrl = metadata.pictureDataUrl;
          }
        }

        return {
          id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          videoId: `local_${file.name}_${Date.now()}`,
          url: URL.createObjectURL(file),
          title,
          author,
          album,
          thumbnailUrl,
          addedAt: Date.now(),
          playCount: 0,
          sourceType: 'local',
          fileName: file.name
        };
      })
    );

    onImportLibrary((prev) => [...prev, ...newTracks]);
    if (folderInputRef.current) folderInputRef.current.value = '';
  };
 
  const toggleSelect = (id: string) => {
    const next = new Set(selectedTracks);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedTracks(next);
  };

  const handleBulkQueue = () => {
    const tracksToQueue = library.filter(t => selectedTracks.has(t.id));
    tracksToQueue.forEach(t => onAddToQueue(t));
    setSelectedTracks(new Set());
  };

  const handleBulkRemove = () => {
    onRemoveMultiple(Array.from(selectedTracks));
    setSelectedTracks(new Set());
  };

  const handleSelectAll = () => {
    if (selectedTracks.size === filtered.length && filtered.length > 0) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(filtered.map(t => t.id)));
    }
  };

  const currentPl = activePl ? playlists.find(p => p.id === activePl) : null;
  const filtered = library.filter(t => 
    (!currentPl || currentPl.trackIds.includes(t.id)) &&
    (
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.author.toLowerCase().includes(search.toLowerCase()) ||
      (t.album || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.fileName || '').toLowerCase().includes(search.toLowerCase())
    )
  ).sort((a, b) => b.addedAt - a.addedAt);

  return (
     <div className="flex flex-col gap-4 p-4 bg-[#1C1B1F] rounded-xl border border-white/5 h-full min-h-0 overflow-hidden relative">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleLocalFileSelect} 
        multiple 
        accept="audio/*" 
        className="hidden" 
      />
<input 
        type="file" 
        ref={folderInputRef} 
        onChange={handleFolderSelect} 
        /* @ts-ignore */
        webkitdirectory="true"
        directory="true"
        multiple 
        className="hidden" 
      />
       
      <div className="flex justify-between items-center">
        <div className="flex flex-col">
          <h3 className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Collection ({library.length})</h3>
          {selectedTracks.size > 0 && (
            <span className="text-[8px] font-bold text-[#D0BCFF] uppercase animate-pulse">{selectedTracks.size} Selected</span>
          )}
        </div>
        <div className="flex gap-1">
          {selectedTracks.size > 0 && (
            <>
              <button 
                onClick={handleBulkRemove}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-[9px] font-black uppercase hover:bg-red-500 hover:text-white transition-all shadow-lg mr-1 border border-red-500/30"
              >
                <span className="material-symbols-outlined text-xs">delete</span>
                Delete
              </button>
              <button 
                onClick={handleBulkQueue}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D0BCFF] text-black text-[9px] font-black uppercase hover:scale-105 transition-all shadow-lg mr-2"
              >
                <span className="material-symbols-outlined text-xs">playlist_add</span>
                Queue
              </button>
            </>
          )}
          <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white" title="Import Local Files">
            <span className="material-symbols-outlined text-sm">folder_open</span>
          </button>
           <button onClick={() => folderInputRef.current?.click()} className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white" title="Import Folder">
            <span className="material-symbols-outlined text-sm">folder_special</span>
          </button>
          <button onClick={() => setShowBulkAdd(true)} className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white" title="Import YouTube Playlist">
            <span className="material-symbols-outlined text-sm">dynamic_feed</span>
          </button>
          <button onClick={() => exportLibrary(library)} className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:text-white" title="Export JSON">
            <span className="material-symbols-outlined text-sm">download</span>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <form onSubmit={handleAddUrl} className="relative group">
          <input 
            type="text" 
            value={url} 
            onChange={e => setUrl(e.target.value)} 
            placeholder="Paste YouTube Link..." 
            className="w-full bg-[#2B2930] border border-white/5 rounded-full py-2.5 pl-4 pr-16 text-[11px] focus:outline-none focus:border-[#D0BCFF]/50 transition-all shadow-inner" 
          />
          <button 
            type="submit" 
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-[#D0BCFF] text-black px-3 py-1.5 rounded-full text-[9px] font-black tracking-tighter hover:scale-105 active:scale-95 transition-all"
          >
            ADD
          </button>
        </form>

        <div className="relative">
          <input 
            type="text" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Search tracks..." 
            className="w-full bg-black/30 border border-white/5 rounded-full py-2.5 px-10 text-[11px] focus:outline-none" 
          />
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm">filter_list</span>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-slim">
        <button 
          onClick={handleSelectAll} 
          className={`px-3 py-1.5 rounded-full text-[8px] font-black uppercase border transition-all shrink-0 ${selectedTracks.size === filtered.length && filtered.length > 0 ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-500 border-white/5'}`}
        >
          {selectedTracks.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
        </button>
        <div className="w-px h-4 bg-white/10 shrink-0" />
        <button onClick={() => setActivePl(null)} className={`px-4 py-2 rounded-full text-[9px] font-black uppercase border transition-all shrink-0 ${!activePl ? 'bg-[#D0BCFF] text-black border-[#D0BCFF]' : 'bg-black/40 text-gray-500 border-white/5 hover:border-white/20'}`}>All Tracks</button>
        {playlists.map(p => (
          <button key={p.id} onClick={() => setActivePl(p.id)} className={`px-4 py-2 rounded-full text-[9px] font-black uppercase border transition-all shrink-0 ${activePl === p.id ? 'bg-[#D0BCFF] text-black border-[#D0BCFF]' : 'bg-black/40 text-gray-500 border-white/5 hover:border-white/20'}`}>{p.name}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-slim">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-20 text-center">
            <span className="material-symbols-outlined text-4xl mb-2">inventory_2</span>
            <p className="text-[10px] font-black uppercase tracking-widest">Library Empty</p>
          </div>
          ) : filtered.map(t => {
          const hasBeenPlayed = t.playCount > 0;
          const isSelected = selectedTracks.has(t.id);
          const playedOpacity = hasBeenPlayed ? (isSelected ? 'opacity-80' : 'opacity-60 hover:opacity-100') : '';
          const tooltipText = [
            `Title: ${t.title || 'Unknown Title'}`,
            `Artist: ${t.author || 'Unknown Artist'}`,
            `Album: ${t.album || 'Unknown Album'}`,
            `File: ${t.fileName || 'N/A'}`
          ].join('\n');
          return (
          <div
            key={t.id}
            title={tooltipText}
            tabIndex={0}
            onTouchStart={(event) => event.currentTarget.focus()}
            className={`group grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 p-4 min-h-[72px] rounded-xl border transition-all relative overflow-hidden ${
              isSelected ? 'bg-[#D0BCFF]/10 border-[#D0BCFF]/50' : 'bg-black/20 border-white/5 hover:border-white/20'
            } ${playedOpacity}`}
          >
            <input type="checkbox" checked={selectedTracks.has(t.id)} onChange={() => toggleSelect(t.id)} className="w-4 h-4 accent-[#D0BCFF] shrink-0" />
            <div className="relative shrink-0">
              <img
                src={t.thumbnailUrl}
                alt=""
                className="w-14 h-10 rounded-lg object-cover shadow-lg"
                onError={(event) => {
                  event.currentTarget.src = fallbackThumbnail;
                }}
              />
              {t.sourceType === 'local' && (
                <div className="absolute -top-1 -right-1 bg-blue-500 border border-black w-2.5 h-2.5 rounded-full" title="Local File" />
              )}
            </div>
            <div className="flex-1 min-w-0 pr-24 relative" onDoubleClick={() => setEditingTrack(t)}>
              <div className="text-[11px] font-bold text-white truncate leading-tight group-hover:text-[#D0BCFF] transition-colors">{t.title}</div>
              <div className="text-[9px] text-gray-500 truncate uppercase font-bold tracking-tighter">{t.author}</div>
              {hasBeenPlayed && (
                <span className="absolute top-0 right-0 text-[8px] font-black uppercase tracking-widest text-gray-500 border border-white/10 rounded-full px-2 py-1">
                  Played
                </span>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 min-w-[136px] shrink-0">
              {hasBeenPlayed && (
                <span className="text-[8px] font-black uppercase tracking-widest text-gray-500 border border-white/10 rounded-full px-2 py-1 shrink-0">
                  Played
                </span>
              )}
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button 
                  onClick={() => onAddToQueue(t)} 
                  className="w-7 h-7 rounded-lg bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-all"
                  title="Add to Queue"
                >
                  <span className="material-symbols-outlined text-sm">playlist_add</span>
                </button>
                <button onClick={() => onLoadToDeck(t, 'A')} className="w-7 h-7 rounded-lg bg-[#D0BCFF] text-black text-[10px] font-black hover:scale-110 active:scale-90 transition-all">A</button>
                <button onClick={() => onLoadToDeck(t, 'B')} className="w-7 h-7 rounded-lg bg-[#F2B8B5] text-black text-[10px] font-black hover:scale-110 active:scale-90 transition-all">B</button>
                <button onClick={() => onRemove(t.id)} className="w-7 h-7 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all" title="Remove"><span className="material-symbols-outlined text-sm">delete</span></button>
              </div>
            </div>
            <div className="pointer-events-none absolute left-12 top-full z-10 mt-2 w-64 rounded-xl border border-white/10 bg-black/90 p-3 text-[9px] text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <div className="font-bold text-[#D0BCFF] mb-1">Track Details</div>
              <div className="space-y-1 text-gray-200">
                <div><span className="text-gray-500">Title:</span> {t.title || 'Unknown Title'}</div>
                <div><span className="text-gray-500">Artist:</span> {t.author || 'Unknown Artist'}</div>
                <div><span className="text-gray-500">Album:</span> {t.album || 'Unknown Album'}</div>
                <div><span className="text-gray-500">File:</span> {t.fileName || 'N/A'}</div>
              </div>
            </div>
          </div>
           );
        })}
      </div>

      {showBulkAdd && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
          <div className="m3-card bg-[#1D1B20] w-full max-w-lg border border-[#D0BCFF]/30 p-8 shadow-2xl scale-up">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-[#D0BCFF] uppercase tracking-[0.2em]">Playlist Ingest</h2>
              <button onClick={() => setShowBulkAdd(false)} className="text-gray-500 hover:text-white"><span className="material-symbols-outlined">close</span></button>
            </div>
            <p className="text-[10px] text-gray-500 uppercase font-black mb-4 tracking-widest">Paste a YouTube Playlist URL or raw ID (e.g., PLD6777CE81CB5B754)</p>
            <textarea 
              value={bulkText} 
              onChange={e => setBulkText(e.target.value)} 
              placeholder="https://www.youtube.com/playlist?list=..." 
              className="w-full h-48 bg-black/60 border border-white/10 rounded-2xl p-4 text-[13px] text-white focus:outline-none mb-6 resize-none shadow-inner" 
            />
            
            {importStatus && (
              <div className={`mb-4 px-4 py-3 rounded-xl text-center border transition-all ${importStatus.startsWith('Error') ? 'bg-red-500/10 border-red-500/30' : 'bg-[#D0BCFF]/10 border-[#D0BCFF]/30'}`}>
                <p className={`text-[11px] font-black uppercase tracking-widest ${importStatus.startsWith('Error') ? 'text-red-400' : 'text-[#D0BCFF] animate-pulse'}`}>
                  {importStatus}
                </p>
              </div>
            )}

            <button 
              onClick={handleBulkImport} 
              disabled={isImporting} 
              className="w-full py-4 bg-[#D0BCFF] text-black font-black rounded-2xl tracking-[0.3em] hover:bg-[#D0BCFF]/80 disabled:opacity-50 transition-all shadow-lg"
            >
              {isImporting ? 'FETCHING...' : 'START INGEST'}
            </button>
          </div>
        </div>
      )}

      {editingTrack && (
        <div className="fixed inset-0 z-[2001] flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm">
          <div className="m3-card w-full max-w-md bg-[#1D1B20] border border-[#D0BCFF]/20 p-8">
            <h3 className="text-sm font-black text-[#D0BCFF] mb-6 uppercase tracking-[0.2em]">Edit Metadata</h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase block mb-1">Title</label>
                <input type="text" value={editingTrack.title} onChange={e => setEditingTrack({...editingTrack, title: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs focus:outline-none focus:border-[#D0BCFF]/50" />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase block mb-1">Author</label>
                <input type="text" value={editingTrack.author} onChange={e => setEditingTrack({...editingTrack, author: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs focus:outline-none focus:border-[#D0BCFF]/50" />
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase block mb-1">Album</label>
                <input type="text" value={editingTrack.album || ''} onChange={e => setEditingTrack({...editingTrack, album: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs focus:outline-none focus:border-[#D0BCFF]/50" />
              </div>
              <div className="flex gap-2 pt-4">
                <button onClick={() => setEditingTrack(null)} className="flex-1 py-3 bg-white/5 text-white rounded-xl font-black uppercase text-[10px]">Cancel</button>
                <button onClick={() => { onUpdateMetadata(editingTrack.videoId, editingTrack); setEditingTrack(null); }} className="flex-1 py-3 bg-[#D0BCFF] text-black rounded-xl font-black uppercase text-[10px]">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryPanel;
