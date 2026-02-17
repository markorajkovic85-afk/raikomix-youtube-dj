/**
 * Unit tests for the Auto DJ transaction state machine pure logic.
 * These cover the 4 critical failure scenarios from IMPLEMENTATION_P0-1.md.
 * [TASK-003 / BUG-001]
 */

import { describe, it, expect } from 'vitest';
import {
  shouldAdvanceToReady,
  shouldCancelOnQueueChange,
  isTransactionTimedOut,
  shouldCancelOnManualLoad,
  AutoDjTransaction,
} from '../utils/autoDjTransaction';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const makeTxn = (overrides: Partial<AutoDjTransaction> = {}): AutoDjTransaction => ({
  id: 'txn-test-1',
  state: 'PRELOADING',
  targetDeck: 'B',
  sourceDeck: 'A',
  queueItem: { id: 'q-1', videoId: 'track-abc', title: 'Test Track' },
  startedAt: Date.now() - 5000, // 5s ago
  ...overrides,
});

// ─── shouldAdvanceToReady ────────────────────────────────────────────────────
// Covers: Scenario 1 (Preload Invalidation) and happy path

describe('shouldAdvanceToReady()', () => {
  it('returns true when all conditions are met', () => {
    const txn = makeTxn({ state: 'PRELOADING', targetDeck: 'B' });
    expect(shouldAdvanceToReady(txn, 'B', { isReady: true, playing: false, videoId: 'track-abc' })).toBe(true);
  });

  it('returns false when txn is null', () => {
    expect(shouldAdvanceToReady(null, 'B', { isReady: true, playing: false, videoId: 'track-abc' })).toBe(false);
  });

  it('returns false when deck does not match transaction targetDeck', () => {
    const txn = makeTxn({ targetDeck: 'B' });
    expect(shouldAdvanceToReady(txn, 'A', { isReady: true, playing: false, videoId: 'track-abc' })).toBe(false);
  });

  it('returns false when transaction is not in PRELOADING state', () => {
    const txn = makeTxn({ state: 'READY' });
    expect(shouldAdvanceToReady(txn, 'B', { isReady: true, playing: false, videoId: 'track-abc' })).toBe(false);
  });

  it('returns false when deck is not ready', () => {
    const txn = makeTxn({ state: 'PRELOADING' });
    expect(shouldAdvanceToReady(txn, 'B', { isReady: false, playing: false, videoId: 'track-abc' })).toBe(false);
  });

  it('returns false when deck is already playing', () => {
    const txn = makeTxn({ state: 'PRELOADING' });
    expect(shouldAdvanceToReady(txn, 'B', { isReady: true, playing: true, videoId: 'track-abc' })).toBe(false);
  });

  it('SCENARIO 1 FIX: returns false when videoId does not match transaction queueItem', () => {
    // This is the preload invalidation race condition fix:
    // User manually loaded a different video to deck B while Auto DJ was preloading track-abc.
    // Deck B becomes ready with the manually-loaded video — must NOT advance the stale transaction.
    const txn = makeTxn({ state: 'PRELOADING', queueItem: { id: 'q-1', videoId: 'track-abc' } });
    expect(
      shouldAdvanceToReady(txn, 'B', { isReady: true, playing: false, videoId: 'manual-track-xyz' })
    ).toBe(false);
  });

  it('returns true when videoId is null (deck still loading, no videoId yet)', () => {
    // When videoId is not yet populated, we allow the advance (deck hasn't loaded yet anyway,
    // but isReady would typically be false in this case — belt-and-suspenders)
    const txn = makeTxn({ state: 'PRELOADING' });
    expect(shouldAdvanceToReady(txn, 'B', { isReady: true, playing: false, videoId: null })).toBe(true);
  });
});

// ─── shouldCancelOnQueueChange ───────────────────────────────────────────────
// Covers: Scenario 3 (Rapid queue changes)

describe('shouldCancelOnQueueChange()', () => {
  it('returns false when txn is null', () => {
    expect(shouldCancelOnQueueChange(null, 'q-1')).toBe(false);
  });

  it('returns false when queue front matches transaction queueItem', () => {
    const txn = makeTxn({ queueItem: { id: 'q-1', videoId: 'track-abc' } });
    expect(shouldCancelOnQueueChange(txn, 'q-1')).toBe(false);
  });

  it('SCENARIO 3: returns true when queue front item changed (user reordered)', () => {
    const txn = makeTxn({ state: 'PRELOADING', queueItem: { id: 'q-1', videoId: 'track-abc' } });
    expect(shouldCancelOnQueueChange(txn, 'q-99')).toBe(true);
  });

  it('SCENARIO 3: returns true when queue becomes empty', () => {
    const txn = makeTxn({ state: 'PRELOADING' });
    expect(shouldCancelOnQueueChange(txn, undefined)).toBe(true);
  });

  it('returns false for PLAYING transaction even if queue changed (let mix complete)', () => {
    const txn = makeTxn({ state: 'PLAYING', queueItem: { id: 'q-1', videoId: 'track-abc' } });
    expect(shouldCancelOnQueueChange(txn, 'q-different')).toBe(false);
  });

  it('returns false for MIXING transaction even if queue changed (crossfade in progress)', () => {
    const txn = makeTxn({ state: 'MIXING', queueItem: { id: 'q-1', videoId: 'track-abc' } });
    expect(shouldCancelOnQueueChange(txn, undefined)).toBe(false);
  });
});

// ─── isTransactionTimedOut ───────────────────────────────────────────────────
// Covers: Scenario 2 (Network failure / early start failure)

describe('isTransactionTimedOut()', () => {
  it('returns false when txn is null', () => {
    expect(isTransactionTimedOut(null, 60000)).toBe(false);
  });

  it('returns false when transaction is within timeout window', () => {
    const txn = makeTxn({ startedAt: Date.now() - 5000 }); // 5s ago
    expect(isTransactionTimedOut(txn, 60000)).toBe(false);
  });

  it('SCENARIO 2: returns true when transaction has exceeded timeout (network failure)', () => {
    // Network fails to load track — transaction stalls in PRELOADING for > 60s
    const txn = makeTxn({ state: 'PRELOADING', startedAt: Date.now() - 61000 }); // 61s ago
    expect(isTransactionTimedOut(txn, 60000)).toBe(true);
  });

  it('returns true for READY state timeout (track loaded but not started)', () => {
    const txn = makeTxn({ state: 'READY', startedAt: Date.now() - 61000 });
    expect(isTransactionTimedOut(txn, 60000)).toBe(true);
  });

  it('SCENARIO 2: never times out a MIXING transaction (would cause dead air mid-crossfade)', () => {
    const txn = makeTxn({ state: 'MIXING', startedAt: Date.now() - 120000 }); // 2min ago
    expect(isTransactionTimedOut(txn, 60000)).toBe(false);
  });

  it('accepts custom nowMs for deterministic testing', () => {
    const baseTime = 1700000000000;
    const txn = makeTxn({ startedAt: baseTime });
    expect(isTransactionTimedOut(txn, 60000, baseTime + 59000)).toBe(false);
    expect(isTransactionTimedOut(txn, 60000, baseTime + 61000)).toBe(true);
  });
});

// ─── shouldCancelOnManualLoad ────────────────────────────────────────────────
// Covers: Scenario 1 (Preload Invalidation — manual override detection)

describe('shouldCancelOnManualLoad()', () => {
  it('returns false when txn is null', () => {
    expect(shouldCancelOnManualLoad(null, 'B')).toBe(false);
  });

  it('SCENARIO 1: returns true when manual load targets the preloading deck', () => {
    // Auto DJ preloaded track to deck B, user manually loads different track to deck B
    const txn = makeTxn({ state: 'PRELOADING', targetDeck: 'B' });
    expect(shouldCancelOnManualLoad(txn, 'B')).toBe(true);
  });

  it('returns false when manual load targets a different deck', () => {
    const txn = makeTxn({ state: 'PRELOADING', targetDeck: 'B' });
    expect(shouldCancelOnManualLoad(txn, 'A')).toBe(false);
  });

  it('returns true for READY state (track cued but user overrides)', () => {
    const txn = makeTxn({ state: 'READY', targetDeck: 'B' });
    expect(shouldCancelOnManualLoad(txn, 'B')).toBe(true);
  });

  it('returns true for PLAYING state (track started but not mixing yet)', () => {
    const txn = makeTxn({ state: 'PLAYING', targetDeck: 'B' });
    expect(shouldCancelOnManualLoad(txn, 'B')).toBe(true);
  });

  it('SCENARIO 2 SAFETY: returns false for MIXING state (crossfade in progress — do not interrupt)', () => {
    // Once we are in MIXING state (crossfade playing), a manual load should not cancel
    // or the crossfade would stop mid-fade creating a jarring cut
    const txn = makeTxn({ state: 'MIXING', targetDeck: 'B' });
    expect(shouldCancelOnManualLoad(txn, 'B')).toBe(false);
  });
});

// ─── Happy Path Scenario 4 ───────────────────────────────────────────────────
// Simulate a complete successful transition lifecycle

describe('SCENARIO 4: Happy path — complete transaction lifecycle', () => {
  it('advances correctly through all states without triggering any cancellation', () => {
    const queueItem = { id: 'q-1', videoId: 'track-abc', title: 'Track ABC' };
    let txn: AutoDjTransaction = {
      id: 'txn-happy',
      state: 'PRELOADING',
      targetDeck: 'B',
      sourceDeck: 'A',
      queueItem,
      startedAt: Date.now(),
    };

    // Queue is stable — no cancel on queue change
    expect(shouldCancelOnQueueChange(txn, 'q-1')).toBe(false);

    // Not timed out
    expect(isTransactionTimedOut(txn, 60000)).toBe(false);

    // No manual load — no cancel
    expect(shouldCancelOnManualLoad(txn, 'B')).toBe(true); // Still cancels if user manually loads
    expect(shouldCancelOnManualLoad(txn, 'A')).toBe(false); // Other deck is fine

    // Deck B becomes ready with correct videoId → advance to READY
    expect(shouldAdvanceToReady(txn, 'B', { isReady: true, playing: false, videoId: 'track-abc' })).toBe(true);
    txn = { ...txn, state: 'READY' };

    // In READY state — no longer cancelable by queue change (shouldCancelOnQueueChange returns false for READY)
    // Actually READY state IS cancelable by queue change — let's verify
    expect(shouldCancelOnQueueChange(txn, 'q-different')).toBe(true); // Still cancelable in READY

    // Simulated: deck starts playing → advance to PLAYING (this is done inline in App.tsx)
    txn = { ...txn, state: 'PLAYING' };
    // PLAYING: queue change no longer cancels
    expect(shouldCancelOnQueueChange(txn, 'q-different')).toBe(false);

    // Simulated: crossfade starts → advance to MIXING
    txn = { ...txn, state: 'MIXING' };
    // MIXING: timeout never fires
    expect(isTransactionTimedOut(txn, 60000)).toBe(false);
    // MIXING: manual load doesn't cancel
    expect(shouldCancelOnManualLoad(txn, 'B')).toBe(false);
    // MIXING: queue change doesn't cancel
    expect(shouldCancelOnQueueChange(txn, undefined)).toBe(false);
  });
});
