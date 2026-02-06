# PR #1: Core Audio & State Management Infrastructure
## Implementation Status & Next Steps

**Branch:** `fix/core-audio-state-management`  
**Priority:** CRITICAL (Must merge first)  
**Status:** 🟡 Core Infrastructure Complete - Integration Pending

---

## ✅ Completed Work

### 1. Auto DJ State Machine Service
**File:** `services/AutoDJStateMachine.ts`  
**Commit:** [27dbba9](https://github.com/markorajkovic85-afk/raikomix-youtube-dj/commit/27dbba94e180bc94ed411d968693e8f700e2594e)

✅ **Created transaction-safe state machine**
- Implements 5 stages: `idle` → `preloading` → `early_start` → `crossfading` → `finalizing`
- Transaction system with unique IDs and timeout validation
- Rollback capability for failed transitions
- State validation logic for deck readiness
- Transaction history tracking (max 10 entries)

**Key Features:**
```typescript
// Usage example
const stateMachine = new AutoDJStateMachine();
const result = stateMachine.startPreload('A', queueItem, context);
if (!result.success) {
  console.error('Preload failed:', result.error);
  stateMachine.rollback();
}
```

### 2. Deck Audio Engine Utility
**File:** `utils/audioEngine.ts`  
**Commit:** [eba39b7](https://github.com/markorajkovic85-afk/raikomix-youtube-dj/commit/eba39b7178a078be1a763313320178db2b5b62c2)

✅ **Created lifecycle-managed audio engine**
- Proper audio context and source node management
- EQ chain (low/mid/hi + bi-polar filter)
- Effect routing with wet/dry mixing
- Source switching without memory leaks
- Cleanup methods for preventing ghost audio

**Key Features:**
```typescript
// Usage example
const audioEngine = new DeckAudioEngine('A');
audioEngine.initialize(audioElement);
audioEngine.updateEQ({ low: 1.2, mid: 1.0, hi: 0.8, filter: 0 });
audioEngine.applyEffect('REVERB', 0.5);
audioEngine.cleanup(); // Always cleanup before switching
```

### 3. Type Safety Improvements
**File:** `types.ts`  
**Commit:** [91ad7b2](https://github.com/markorajkovic85-afk/raikomix-youtube-dj/commit/91ad7b2be3ba2b387f1e03b71dfdd2891bb889a1)

✅ **Added comprehensive type definitions**
- `PlayerControl` interface for unified player operations
- `AutoDJError` union type for state machine errors
- `YouTubeAPIError` union type for API-specific errors

---

## 🔧 Required Integration Work

### 4. App.tsx Integration (Manual Required)

**Location:** Lines 687-942 need modification

#### Changes Required:

**A. Import new dependencies (top of file):**
```typescript
import { AutoDJStateMachine, StateContext } from './services/AutoDJStateMachine';
import { PlayerControl } from './types';
```

**B. Replace `any` types (lines 92-95):**
```typescript
// BEFORE:
const [masterPlayerA, setMasterPlayerA] = useState<any>(null);
const [masterPlayerB, setMasterPlayerB] = useState<any>(null);

// AFTER:
const [masterPlayerA, setMasterPlayerA] = useState<PlayerControl | null>(null);
const [masterPlayerB, setMasterPlayerB] = useState<PlayerControl | null>(null);
```

**C. Add state machine ref (after other refs ~line 100):**
```typescript
const autoDJStateMachine = useRef(new AutoDJStateMachine());
```

**D. Replace Auto DJ logic (lines 687-912):**

This is the most complex change. The current Auto DJ logic should be replaced with:

```typescript
const handleAutoDJTick = useCallback(() => {
  if (!autoDjEnabled) return;
  
  const currentState = autoDJStateMachine.current.getState();
  const context: StateContext = {
    deckStates: { A: deckAState, B: deckBState },
    queue,
    currentTime: Date.now()
  };

  // Determine which deck is currently playing
  const deckAPlaying = deckAState?.playing ?? false;
  const deckBPlaying = deckBState?.playing ?? false;
  
  if (currentState.stage === 'idle' && queue.length > 0) {
    // Determine target deck (opposite of current playing deck)
    const targetDeck: DeckId = deckAPlaying ? 'B' : 'A';
    const targetDeckState = targetDeck === 'A' ? deckAState : deckBState;
    const sourceDeck: DeckId = targetDeck === 'A' ? 'B' : 'A';
    const sourceDeckState = sourceDeck === 'A' ? deckAState : deckBState;
    
    // Check if source deck is near end
    if (sourceDeckState && sourceDeckState.playing && sourceDeckState.duration > 0) {
      const timeRemaining = sourceDeckState.duration - sourceDeckState.currentTime;
      
      if (timeRemaining <= mixLeadSeconds && timeRemaining > 0) {
        // Start preload
        const nextTrack = queue[0];
        const result = autoDJStateMachine.current.startPreload(targetDeck, nextTrack, context);
        
        if (result.success) {
          console.log('[Auto DJ] Preloading track to deck', targetDeck);
          
          // Cue the track on target deck
          const deckRef = targetDeck === 'A' ? deckARef : deckBRef;
          if (deckRef.current) {
            deckRef.current.cueVideo(
              nextTrack.url,
              nextTrack.sourceType || 'youtube',
              { title: nextTrack.title, author: nextTrack.author }
            );
          }
          
          // Mark preload complete
          autoDJStateMachine.current.completePreload(nextTrack.videoId);
          
          // Remove from queue
          setQueue(prev => prev.slice(1));
        } else {
          showNotification(`Auto DJ: ${result.error.code}`, 'error');
        }
      }
    }
  }
  
  // Handle early start
  if (currentState.stage === 'preloading') {
    const transaction = currentState.transaction;
    const sourceDeck: DeckId = transaction.targetDeck === 'A' ? 'B' : 'A';
    const sourceDeckState = sourceDeck === 'A' ? deckAState : deckBState;
    
    if (sourceDeckState && sourceDeckState.playing) {
      const timeRemaining = sourceDeckState.duration - sourceDeckState.currentTime;
      const earlyStartTime = mixLeadSeconds - (mixDurationSeconds / 2);
      
      if (timeRemaining <= earlyStartTime) {
        const result = autoDJStateMachine.current.startEarly(context);
        if (result.success) {
          // Start playing target deck
          const deckRef = transaction.targetDeck === 'A' ? deckARef : deckBRef;
          deckRef.current?.togglePlay();
          console.log('[Auto DJ] Early start on deck', transaction.targetDeck);
        }
      }
    }
  }
  
  // Handle crossfade
  if (currentState.stage === 'early_start') {
    const transaction = currentState.transaction;
    const sourceDeck: DeckId = transaction.targetDeck === 'A' ? 'B' : 'A';
    const sourceDeckState = sourceDeck === 'A' ? deckAState : deckBState;
    
    if (sourceDeckState && sourceDeckState.playing) {
      const timeRemaining = sourceDeckState.duration - sourceDeckState.currentTime;
      
      if (timeRemaining <= (mixDurationSeconds / 2)) {
        const result = autoDJStateMachine.current.startCrossfade(context);
        if (result.success) {
          // Animate crossfader
          const targetPosition = transaction.targetDeck === 'A' ? -1 : 1;
          const duration = mixDurationSeconds * 1000;
          const startValue = crossfader;
          const startTime = Date.now();
          
          const animateCrossfader = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const newValue = startValue + (targetPosition - startValue) * progress;
            setCrossfader(newValue);
            
            if (progress < 1) {
              requestAnimationFrame(animateCrossfader);
            } else {
              autoDJStateMachine.current.finalize();
            }
          };
          
          animateCrossfader();
          console.log('[Auto DJ] Crossfading to deck', transaction.targetDeck);
        }
      }
    }
  }
}, [autoDjEnabled, deckAState, deckBState, queue, mixLeadSeconds, mixDurationSeconds, crossfader]);

// Auto DJ tick interval
useEffect(() => {
  if (!autoDjEnabled) return;
  
  const interval = setInterval(handleAutoDJTick, 500);
  return () => clearInterval(interval);
}, [autoDjEnabled, handleAutoDJTick]);
```

**E. Crossfader Volume Control (lines 933-942):**

Add master gain nodes and replace the 50ms interval with direct updates:

```typescript
const masterGainA = useRef<GainNode | null>(null);
const masterGainB = useRef<GainNode | null>(null);

const updateCrossfaderVolumes = useCallback(() => {
  if (!masterGainA.current || !masterGainB.current) return;
  
  const t = (crossfader + 1) / 2; // Normalize to 0..1
  const curveMap: Record<CrossfaderCurve, (t: number) => [number, number]> = {
    'SMOOTH': (t) => [Math.cos(t * Math.PI * 0.5), Math.sin(t * Math.PI * 0.5)],
    'CUT': (t) => [t <= 0.5 ? 1 : 0, t >= 0.5 ? 1 : 0],
    'DIP': (t) => [
      t <= 0.5 ? 1.0 : 2.0 * (1.0 - t),
      t >= 0.5 ? 1.0 : 2.0 * t
    ]
  };
  
  const [gainA, gainB] = curveMap[xFaderCurve](t);
  
  // Apply deck volumes and master volume
  const finalA = gainA * (deckAVolume / 100) * (masterVolume / 100);
  const finalB = gainB * (deckBVolume / 100) * (masterVolume / 100);
  
  // Smooth ramp
  const now = masterGainA.current.context.currentTime;
  masterGainA.current.gain.setTargetAtTime(finalA, now, 0.02);
  masterGainB.current.gain.setTargetAtTime(finalB, now, 0.02);
}, [crossfader, xFaderCurve, deckAVolume, deckBVolume, masterVolume]);

// Update on any volume change
useEffect(() => {
  updateCrossfaderVolumes();
}, [updateCrossfaderVolumes]);
```

---

### 5. Deck.tsx Integration (Manual Required)

**Location:** Lines 155-267, 483-557 need modification

#### Changes Required:

**A. Import audio engine (top of file):**
```typescript
import { DeckAudioEngine } from '../utils/audioEngine';
```

**B. Replace manual audio engine with DeckAudioEngine (line ~155):**
```typescript
// BEFORE: Multiple refs for audio nodes
const audioCtxRef = useRef<AudioContext | null>(null);
const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
const nodesRef = useRef<{...} | null>(null);
// ... etc

// AFTER: Single audio engine instance
const audioEngine = useRef(new DeckAudioEngine(id));
```

**C. Replace initAudioEngine function (~line 155-200):**
```typescript
// BEFORE: initAudioEngine callback with manual setup

// AFTER: Simple wrapper
const initAudioEngine = useCallback(() => {
  if (!localAudioRef.current) return;
  audioEngine.current.initialize(localAudioRef.current);
}, []);
```

**D. Update effect application (~line 240):**
```typescript
// BEFORE: Manual effect chain management
applyEffectChain(effect);

// AFTER: Use audio engine
useEffect(() => {
  audioEngine.current.applyEffect(effect, effectIntensity);
}, [effect, effectIntensity]);
```

**E. Update EQ sync (~line 250):**
```typescript
// BEFORE: Manual node updates
useEffect(() => {
  if (nodesRef.current && audioCtxRef.current) {
    const { low, mid, hi, filter } = nodesRef.current;
    // ... manual updates
  }
}, [eq]);

// AFTER: Use audio engine
useEffect(() => {
  audioEngine.current.updateEQ({
    low: eq.low,
    mid: eq.mid,
    hi: eq.hi,
    filter: eq.filter
  });
}, [eq]);
```

**F. Update wet/dry mix (~line 270):**
```typescript
// BEFORE: Manual gain node updates

// AFTER:
useEffect(() => {
  audioEngine.current.updateWetDryMix(effectWet);
}, [effectWet]);
```

**G. Fix loadLocalFile function (lines 483-557):**

This is CRITICAL for fixing P0-3:

```typescript
const loadLocalFile = (
  url: string,
  metadata?: { title?: string, author?: string },
  loadMode: 'load' | 'cue' = 'load'
) => {
  console.log(`[Deck ${id}] loadLocalFile called:`, { url, loadMode });
  
  // CRITICAL: Clean up previous source REGARDLESS of type
  if (state.sourceType === 'youtube') {
    try { playerRef.current?.pauseVideo(); } catch (e) {}
    try { playerRef.current?.stopVideo(); } catch (e) {}
  }
  
  // CRITICAL: Cleanup audio engine before switching source
  audioEngine.current.cleanup();
  
  setIsLoading(loadMode !== 'cue');
  
  if (localAudioRef.current) {
    // Clear current source
    localAudioRef.current.pause();
    localAudioRef.current.src = '';
    localAudioRef.current.load();
    
    // Set new source
    localAudioRef.current.src = url;
    localAudioRef.current.load();
    
    // Initialize audio engine with new source
    audioEngine.current.initialize(localAudioRef.current);
    
    const stableVideoId = `local_${url}`;
    
    const onLoaded = () => {
      setState(s => ({
        ...s,
        isReady: true,
        sourceType: 'local',
        duration: localAudioRef.current?.duration || 0,
        title: metadata?.title || url.split('/').pop() || 'Local Track',
        author: metadata?.author || 'Local File',
        videoId: stableVideoId,
        playbackRate: 1.0,
        playing: false,
        currentTime: 0,
        loopActive: false,
        waveform: undefined,
        waveformPeaks: undefined
      }));
      
      if (loadMode !== 'cue') {
        analyzeLocalAudio(url);
      }
      
      onPlayerReady({
        setVolume: (v: number) => { if (localAudioRef.current) localAudioRef.current.volume = v / 100; },
        playVideo: () => localAudioRef.current?.play(),
        pauseVideo: () => localAudioRef.current?.pause(),
        seekTo: (t: number) => { if (localAudioRef.current) localAudioRef.current.currentTime = t; },
        setPlaybackRate: (r: number) => { if (localAudioRef.current) localAudioRef.current.playbackRate = r; }
      });
      
      setIsLoading(false);
      localAudioRef.current?.removeEventListener('loadedmetadata', onLoaded);
    };
    
    localAudioRef.current.addEventListener('loadedmetadata', onLoaded);
  }
};
```

**H. Add cleanup on unmount:**
```typescript
useEffect(() => {
  return () => {
    audioEngine.current.cleanup();
  };
}, []);
```

---

## 🧪 Testing Requirements

Before creating the PR, test these scenarios:

### Unit Tests (if applicable):
- [ ] AutoDJStateMachine state transitions
- [ ] DeckAudioEngine lifecycle management
- [ ] Error handling in state machine

### Integration Tests:

#### Auto DJ (P0-1):
- [ ] Queue 10 tracks, enable Auto DJ
- [ ] Verify 100% success rate on transitions
- [ ] Modify queue during active transition
- [ ] Manually load track during Auto DJ
- [ ] Test network failure during preload

#### Audio Source Lifecycle (P0-3):
- [ ] Load YouTube track
- [ ] Switch to local file
- [ ] Switch back to YouTube
- [ ] Repeat 20 times per deck
- [ ] Verify no audio artifacts or "ghost audio"
- [ ] Check memory usage stays stable

#### Crossfader (P0-2):
- [ ] Set crossfader to center (0)
- [ ] Verify both decks at equal volume using audio meter
- [ ] Move crossfader during playback
- [ ] Verify smooth transitions without clicks
- [ ] Test all three crossfader curves (SMOOTH/CUT/DIP)
- [ ] Run 1-hour session, verify no desync

---

## 📝 Next Steps

1. **Manual Integration** (Required):
   - Update App.tsx with Auto DJ State Machine
   - Update Deck.tsx with DeckAudioEngine
   - Test thoroughly using checklist above

2. **Create Pull Request**:
   ```bash
   # After manual changes are committed
   gh pr create --base main --head fix/core-audio-state-management \
     --title "PR #1: Core Audio & State Management Infrastructure" \
     --body "See PR1_IMPLEMENTATION_GUIDE.md for details"
   ```

3. **Code Review**:
   - Focus on audio architecture
   - Verify state consistency
   - Check memory safety

4. **Merge**:
   - This MUST merge before PR #2, #3, and #4
   - All subsequent PRs depend on this foundation

---

## 🔗 Commit History

1. **[27dbba9](https://github.com/markorajkovic85-afk/raikomix-youtube-dj/commit/27dbba94e180bc94ed411d968693e8f700e2594e)** - feat: Add Auto DJ State Machine service
2. **[eba39b7](https://github.com/markorajkovic85-afk/raikomix-youtube-dj/commit/eba39b7178a078be1a763313320178db2b5b62c2)** - feat: Add Deck Audio Engine utility
3. **[91ad7b2](https://github.com/markorajkovic85-afk/raikomix-youtube-dj/commit/91ad7b2be3ba2b387f1e03b71dfdd2891bb889a1)** - feat: Add PlayerControl and Error type definitions

---

## 📚 Reference Documentation

- [Auto DJ State Machine API](./services/AutoDJStateMachine.ts)
- [Deck Audio Engine API](./utils/audioEngine.ts)
- [Type Definitions](./types.ts)
- [Original PR Specification](../docs/PR1_SPEC.md) (if available)

---

**Status Updated:** February 6, 2026  
**Estimated Completion Time:** 4-6 hours for manual integration + testing
