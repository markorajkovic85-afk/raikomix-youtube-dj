# PR #1 Integration Checklist
## Status: Core Infrastructure Complete - Manual Integration Required

**Date:** February 6, 2026  
**Branch:** `fix/core-audio-state-management`

---

## ✅ Completed Infrastructure

### 1. Auto DJ State Machine (`services/AutoDJStateMachine.ts`)
- ✅ Transaction-safe state management
- ✅ Rollback capability  
- ✅ State validation
- ✅ Error handling with typed errors

### 2. Deck Audio Engine (`utils/audioEngine.ts`)
- ✅ Audio node lifecycle management
- ✅ EQ chain implementation
- ✅ Effect routing
- ✅ Cleanup methods to prevent leaks

### 3. Type Definitions (`types.ts`)
- ✅ PlayerControl interface
- ✅ AutoDJError union type
- ✅ YouTubeAPIError union type

---

## 🔧 Required Manual Changes

### File Size Constraints
- **App.tsx**: 75,623 characters (too large for single API commit)
- **Deck.tsx**: 45,892 characters (too large for single API commit)

**Recommendation**: Perform these changes locally using your IDE with find/replace and careful testing.

---

## App.tsx Changes Required

### Change 1: Import Statements (Line ~1-25)

**Add these imports:**
```typescript
import { AutoDJStateMachine } from './services/AutoDJStateMachine';
import { PlayerControl } from './types';
```

**Location**: After existing imports, before component definition

---

### Change 2: Type Safety (Lines 92-95)

**FIND:**
```typescript
const [masterPlayerA, setMasterPlayerA] = useState<any>(null);
const [masterPlayerB, setMasterPlayerB] = useState<any>(null);
```

**REPLACE WITH:**
```typescript
const [masterPlayerA, setMasterPlayerA] = useState<PlayerControl | null>(null);
const [masterPlayerB, setMasterPlayerB] = useState<PlayerControl | null>(null);
```

**Impact**: Fixes P2 (Type Safety Improvements)

---

### Change 3: Add State Machine Ref (After line ~130)

**FIND** (locate the section with other refs):
```typescript
const earlyStartedTrackRef = useRef<{ deck: DeckId; videoId: string } | null>(null);
```

**ADD AFTER:**
```typescript
const autoDJStateMachine = useRef(new AutoDJStateMachine());
```

---

### Change 4: Add Master Gain Nodes (After line ~130)

**ADD:**
```typescript
const masterGainA = useRef<GainNode | null>(null);
const masterGainB = useRef<GainNode | null>(null);
```

---

### Change 5: Crossfader Volume Control (Lines 933-942)

**FIND:**
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    [{ p: masterPlayerA, bv: deckAVolume, id: 'A' }, { p: masterPlayerB, bv: deckBVolume, id: 'B' }].forEach(({ p, bv, id }) => {
      if (!p || typeof p.setVolume !== 'function') return;
      const t = (crossfader + 1) / 2;
      let gain = id === 'A' ? (xFaderCurve === 'CUT' ? (t > 0.9 ? 0 : 1) : Math.cos((t * Math.PI) / 2)) : (xFaderCurve === 'CUT' ? (t < 0.1 ? 0 : 1) : Math.sin((t * Math.PI) / 2));
      try { p.setVolume(Math.round(bv * masterVolume * gain * 100)); } catch (e) {}
    });
  }, 50);
  return () => clearInterval(interval);
}, [crossfader, xFaderCurve, masterVolume, deckAVolume, deckBVolume, masterPlayerA, masterPlayerB]);
```

**REPLACE WITH:**
```typescript
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

**Impact**: Fixes P0-2 (Crossfader Volume Control Fix) - eliminates 50ms interval, uses Web Audio API for sample-accurate volume control

---

### Change 6: Auto DJ Tick Handler Refactor (Lines 687-912)

**This is the largest change**. The current Auto DJ logic (~225 lines) should integrate the state machine.

**Key Integration Points:**

1. **Replace state tracking** with `autoDJStateMachine.current.getState()`
2. **Use `startPreload()`** when starting preload phase
3. **Use `startEarly()`** when starting target deck playback
4. **Use `startCrossfade()`** when initiating crossfade animation
5. **Use `finalize()`** when crossfade completes
6. **Handle errors** from state machine with rollback

**Pseudo-code structure:**
```typescript
const handleAutoDJTick = useCallback(() => {
  if (!autoDjEnabled) return;
  
  const currentState = autoDJStateMachine.current.getState();
  const context = {
    deckStates: { A: deckAState, B: deckBState },
    queue,
    currentTime: Date.now()
  };

  // Handle idle -> preloading transition
  if (currentState.stage === 'idle' && shouldPreload()) {
    const result = autoDJStateMachine.current.startPreload(targetDeck, queueItem, context);
    if (!result.success) {
      showNotification(`Auto DJ: ${result.error.code}`, 'error');
      return;
    }
    // Cue track to deck
    deckRef.current.cueVideo(...);
    autoDJStateMachine.current.completePreload(videoId);
  }

  // Handle preloading -> early_start transition
  if (currentState.stage === 'preloading' && shouldStartEarly()) {
    const result = autoDJStateMachine.current.startEarly(context);
    if (result.success) {
      deckRef.current.togglePlay();
    }
  }

  // Handle early_start -> crossfading transition
  if (currentState.stage === 'early_start' && shouldCrossfade()) {
    const result = autoDJStateMachine.current.startCrossfade(context);
    if (result.success) {
      // Animate crossfader with requestAnimationFrame
      // Call autoDJStateMachine.current.finalize() when complete
    }
  }
}, [dependencies]);
```

**⚠️ WARNING**: This is complex logic. Test thoroughly after modification.

**Recommended Approach**:
1. Comment out existing Auto DJ logic
2. Implement new state machine version alongside
3. Test with simple 2-track queue
4. Gradually enable more features
5. Remove old code once stable

---

## Deck.tsx Changes Required

### Change 1: Import Audio Engine (Line ~15)

**FIND:**
```typescript
import { buildWaveformData } from '../utils/waveform';
```

**ADD AFTER:**
```typescript
import { DeckAudioEngine } from '../utils/audioEngine';
```

---

### Change 2: Replace Audio Node Refs (Lines 155-170)

**FIND:**
```typescript
// Web Audio API Refs
const audioCtxRef = useRef<AudioContext | null>(null);
const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
const nodesRef = useRef<{
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  hi: BiquadFilterNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  mixGain: GainNode;
  effectInput: GainNode;
  effectOutput: GainNode;
} | null>(null);

const effectNodesRef = useRef<{
  nodes: AudioNode[];
  dispose?: () => void;
} | null>(null);
```

**REPLACE WITH:**
```typescript
// Audio Engine (manages all Web Audio nodes)
const audioEngine = useRef(new DeckAudioEngine(id));
```

---

### Change 3: Remove initAudioEngine Function (Lines ~173-202)

**FIND and DELETE:**
```typescript
const initAudioEngine = useCallback(() => {
  if (sourceNodeRef.current || !localAudioRef.current) return;
  // ... entire function body
}, []);
```

**REPLACE WITH:**
```typescript
const initAudioEngine = useCallback(() => {
  if (!localAudioRef.current) return;
  audioEngine.current.initialize(localAudioRef.current);
}, []);
```

---

### Change 4: Remove clearEffectChain Function (Lines ~204-217)

**DELETE** the entire `clearEffectChain` function. Audio engine handles this internally.

---

### Change 5: Replace applyEffectChain Function (Lines ~219-240)

**FIND:**
```typescript
const applyEffectChain = useCallback((effectType: EffectType | null) => {
  if (!nodesRef.current || !audioCtxRef.current) return;
  const { effectInput, effectOutput } = nodesRef.current;
  clearEffectChain();
  // ... rest of function
}, [clearEffectChain, effectIntensity]);
```

**REPLACE WITH:**
```typescript
const applyEffectChain = useCallback((effectType: EffectType | null) => {
  audioEngine.current.applyEffect(effectType, effectIntensity);
}, [effectIntensity]);
```

---

### Change 6: Update EQ Sync Effect (Lines ~242-262)

**FIND:**
```typescript
useEffect(() => {
  if (nodesRef.current && audioCtxRef.current) {
    const { low, mid, hi, filter } = nodesRef.current;
    const now = audioCtxRef.current.currentTime;
    const ramp = 0.05;
    // ... EQ updates
  }
}, [eq]);
```

**REPLACE WITH:**
```typescript
useEffect(() => {
  audioEngine.current.updateEQ({
    low: eq.low,
    mid: eq.mid,
    hi: eq.hi,
    filter: eq.filter
  });
}, [eq]);
```

---

### Change 7: Update Wet/Dry Mix Effect (Lines ~264-272)

**FIND:**
```typescript
useEffect(() => {
  if (!nodesRef.current || !audioCtxRef.current) return;
  const { dryGain, wetGain } = nodesRef.current;
  const wet = Math.min(1, Math.max(0, effectWet));
  const now = audioCtxRef.current.currentTime;
  const ramp = 0.05;
  dryGain.gain.setTargetAtTime(Math.cos(wet * Math.PI * 0.5), now, ramp);
  wetGain.gain.setTargetAtTime(Math.sin(wet * Math.PI * 0.5), now, ramp);
}, [effectWet]);
```

**REPLACE WITH:**
```typescript
useEffect(() => {
  audioEngine.current.updateWetDryMix(effectWet);
}, [effectWet]);
```

---

### Change 8: Fix loadLocalFile (Lines 483-557) - **CRITICAL**

**FIND:**
```typescript
const loadLocalFile = (
  url: string,
  metadata?: { title?: string, author?: string },
  loadMode: 'load' | 'cue' = 'load'
) => {
  console.log(`[Deck ${id}] loadLocalFile called:`, { url, loadMode, metadata });
  // Only init if not already done
  initAudioEngine();
  setIsLoading(loadMode !== 'cue');

  // Pause any existing YT stream (don't trust state.sourceType here; it can be stale)
  if (playerRef.current) {
    try { playerRef.current.pauseVideo(); } catch (e) { }
    try { playerRef.current.seekTo?.(0, true); } catch (e) { }
  }

  if (localAudioRef.current) {
    // Clear current source to prevent memory leak / ghost audio
    localAudioRef.current.pause();
    localAudioRef.current.src = url;
    localAudioRef.current.load();
    // ... rest
  }
};
```

**REPLACE WITH:**
```typescript
const loadLocalFile = (
  url: string,
  metadata?: { title?: string, author?: string },
  loadMode: 'load' | 'cue' = 'load'
) => {
  console.log(`[Deck ${id}] loadLocalFile called:`, { url, loadMode, metadata });
  
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

**Impact**: Fixes P0-3 (Audio Source Lifecycle Management) - eliminates ghost audio and memory leaks

---

### Change 9: Add Cleanup on Unmount (End of component)

**ADD before final return:**
```typescript
useEffect(() => {
  return () => {
    audioEngine.current.cleanup();
  };
}, []);
```

---

### Change 10: Update togglePlay to Resume Audio Context (Lines ~468-478)

**FIND:**
```typescript
const togglePlay = useCallback(() => {
  // Resume context if suspended (browser policy)
  if (audioCtxRef.current?.state === 'suspended') {
    audioCtxRef.current.resume();
  }
  // ... rest
}, [state.playing, state.sourceType]);
```

**REPLACE WITH:**
```typescript
const togglePlay = useCallback(() => {
  // Resume context if suspended (browser policy)
  audioEngine.current.resumeContext();
  
  if (state.sourceType === 'youtube') {
    state.playing ? playerRef.current?.pauseVideo() : playerRef.current?.playVideo();
  } else {
    state.playing ? localAudioRef.current?.pause() : localAudioRef.current?.play();
  }
}, [state.playing, state.sourceType]);
```

---

## 🧪 Testing Protocol

### After Each Change
1. **Save file**
2. **Run TypeScript compiler** (`npm run build` or `tsc --noEmit`)
3. **Fix any type errors**
4. **Test in browser**

### Integration Test Sequence

#### Test 1: Audio Engine Lifecycle
1. Load YouTube track to Deck A
2. Load local file to Deck A
3. Load YouTube track again
4. Repeat 20 times
5. **Expected**: No audio artifacts, memory stable

#### Test 2: Crossfader Accuracy
1. Load tracks on both decks
2. Play both simultaneously
3. Move crossfader to center (0)
4. **Expected**: Both decks at equal volume
5. Move to -1 (full left) and +1 (full right)
6. **Expected**: Correct deck fading
7. Test all three curves (SMOOTH/CUT/DIP)

#### Test 3: Auto DJ Transitions (if implemented)
1. Queue 10 tracks
2. Enable Auto DJ
3. Let run for 5 transitions
4. **Expected**: 100% success rate, no skips/glitches
5. Modify queue during transition
6. **Expected**: Graceful handling

---

## 📊 Progress Tracking

### App.tsx
- [ ] Change 1: Import statements
- [ ] Change 2: Type safety (PlayerControl)
- [ ] Change 3: Add state machine ref
- [ ] Change 4: Add master gain nodes
- [ ] Change 5: Crossfader volume control
- [ ] Change 6: Auto DJ tick handler (optional, complex)

### Deck.tsx
- [ ] Change 1: Import audio engine
- [ ] Change 2: Replace audio node refs
- [ ] Change 3: Simplify initAudioEngine
- [ ] Change 4: Remove clearEffectChain
- [ ] Change 5: Simplify applyEffectChain
- [ ] Change 6: Update EQ sync
- [ ] Change 7: Update wet/dry mix
- [ ] Change 8: Fix loadLocalFile (CRITICAL)
- [ ] Change 9: Add cleanup on unmount
- [ ] Change 10: Update togglePlay

### Testing
- [ ] TypeScript compilation passes
- [ ] Audio engine lifecycle test passes
- [ ] Crossfader accuracy test passes
- [ ] Auto DJ test passes (if implemented)
- [ ] Memory leak test passes (1-hour session)

---

## 🚀 Next Steps

### Option A: Manual Local Editing (Recommended)
1. **Pull the branch**: `git checkout fix/core-audio-state-management`
2. **Open in VS Code**
3. **Use find/replace** for each change above
4. **Test incrementally** after each major change
5. **Commit when stable**: `git commit -am "feat: Integrate state machine and audio engine"`
6. **Push**: `git push origin fix/core-audio-state-management`

### Option B: Focused API Commits
I can create smaller, focused commits for individual changes that are low-risk:
- Type safety improvements (Change 2)
- Import statements (Changes 1)
- Reference additions (Changes 3, 4)

### Option C: Full File Upload
You can provide modified App.tsx and Deck.tsx files, and I'll commit them.

---

## 📞 Support

If you encounter issues:
1. **Check console errors** - TypeScript will guide you
2. **Test one change at a time** - easier to isolate problems
3. **Use git branches** - create `test-integration` branch for experiments
4. **Refer to implementation guide** - `PR1_IMPLEMENTATION_GUIDE.md`

---

**Updated:** February 6, 2026 7:55 PM CET
