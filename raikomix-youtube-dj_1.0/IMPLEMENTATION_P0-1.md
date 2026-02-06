# P0-1: Auto DJ Track Transition Failures - Implementation Plan

## Status: ✅ IN PROGRESS - Phase 2

## Root Cause Analysis

### Problem
The Auto DJ system uses **three separate refs** without synchronization causing race conditions:

1. **`preloadedTrackRef`** (line 116) - Assumes cued track is still valid
2. **`earlyStartedTrackRef`** (line 118) - Never validates if playback succeeded  
3. **`pendingMixRef`** (line 112) - Cleared separately causing desync

### Critical Failure Scenarios

**Scenario 1: Preload Invalidation**
```
1. Track A → 15s remaining → Preload Track B  
2. User manually loads Track C to Deck B  
3. Track A → 8s remaining → System assumes Track B still preloaded  
4. System starts playback on Deck B → Track C plays instead  
5. Queue desync: Track B removed but Track C playing
```

**Scenario 2: Early Start Failure**
```
1. Track A → 10s remaining → Start Track B early  
2. Track B fails to load (network issue, YouTube block)  
3. earlyStartedTrackRef marks as "started" anyway  
4. Track A → 6s remaining → System skips crossfade (thinks B is playing)  
5. Result: Dead air when Track A ends
```

## Solution: Transaction State Machine

### Design Principles
- **Single source of truth**: One ref tracks entire transition lifecycle
- **Atomic operations**: Start/complete/cancel as single units
- **Validation gates**: Check state before every critical action
- **Explicit cleanup**: Clear state only after confirmed success/failure

### Implementation

#### 1. State Machine Structure
```typescript
interface TransitionTransaction {
  id: string;                    // Unique transaction ID
  state: 'PRELOADING' | 'READY' | 'PLAYING' | 'MIXING';
  targetDeck: DeckId;           // Deck receiving new track
  sourceDeck: DeckId;           // Deck currently playing
  queueItem: QueueItem;         // Track being loaded
  startedAt: number;            // Timestamp for timeout detection
}
```

#### 2. Transaction Lifecycle
```
PRELOADING → Track cued to target deck
   ↓
READY → Track confirmed loaded and ready
   ↓  
PLAYING → Track started on target deck
   ↓
MIXING → Crossfade in progress
   ↓
null → Transaction complete, cleanup
```

#### 3. Helper Functions
```typescript
// Start new transaction (replaces preloadNextQueueItem)
function startTransition(targetDeck, queueItem): string

// Validate transaction still valid
function validateTransaction(id): boolean

// Advance transaction to next state
function advanceTransaction(id, newState): boolean

// Cancel and cleanup transaction
function cancelTransaction(id): void
```

## Implementation Steps

### ✅ Phase 1: Setup (COMPLETED)
- [x] Create feature branch `fix/p0-1-transaction-state-machine`
- [x] Create IMPLEMENTATION_P0-1.md tracking document
- [x] Update Notion bug tracker with analysis
- [x] First commit pushed

### 🔄 Phase 2: Refactor Auto DJ Logic (IN PROGRESS)
- [ ] Replace `preloadedTrackRef`, `earlyStartedTrackRef` with `activeTransactionRef`
- [ ] Implement transaction helper functions
- [ ] Refactor Auto DJ interval logic (lines 843-912)
- [ ] Add validation checks before state transitions
- [ ] Commit changes

### Phase 3: Testing & Validation
- [ ] Test Scenario 1: Manual deck override during preload
- [ ] Test Scenario 2: Network failure during early start
- [ ] Test Scenario 3: Rapid queue changes
- [ ] Test Scenario 4: Normal happy path (5+ transitions)
- [ ] Document test results

### Phase 4: Integration & Documentation
- [ ] Update Notion with test results
- [ ] Create pull request with detailed description
- [ ] Add inline code comments explaining state machine
- [ ] Update user-facing documentation if needed

## Code Changes Required

### Files to Modify
1. **App.tsx** (primary changes)
   - Lines 116-118: Remove old refs, add `activeTransactionRef`
   - Lines 843-912: Complete Auto DJ logic refactor
   - Add transaction helper functions after line 840

### Backward Compatibility
- No API changes visible to users
- Existing queue/library data unaffected
- Settings preserved

## Success Criteria
- [ ] Zero race conditions in 100+ consecutive Auto DJ transitions
- [ ] Manual deck loads properly cancel pending transitions  
- [ ] Network failures don't cause dead air
- [ ] Queue remains synchronized with actual playback
- [ ] No performance regression (transition timing within 200ms variance)

## Rollback Plan
If critical issues found:
1. Revert to `main` branch
2. Keep bug P0-1 in "In Progress" status
3. Analyze failure mode
4. Adjust implementation plan

---

**Next Action**: Begin Phase 2 refactoring of Auto DJ logic