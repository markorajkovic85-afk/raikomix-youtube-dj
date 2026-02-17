/**
 * Pure transaction logic for the Auto DJ state machine.
 * Extracted from App.tsx so these critical rules can be unit-tested in isolation.
 *
 * The state machine lifecycle:
 *   PRELOADING → READY → PLAYING → MIXING → null (complete)
 *
 * [TASK-003 / BUG-001]
 */

import { DeckId } from '../types';

export interface TransactionQueueItem {
  id: string;
  videoId: string;
  title?: string;
}

export interface AutoDjTransaction {
  id: string;
  state: 'PRELOADING' | 'READY' | 'PLAYING' | 'MIXING';
  targetDeck: DeckId;
  sourceDeck: DeckId;
  queueItem: TransactionQueueItem;
  startedAt: number;
}

export interface DeckReadyState {
  isReady: boolean;
  playing: boolean;
  videoId: string | null | undefined;
}

/**
 * Determines whether a transaction should advance from PRELOADING to READY.
 *
 * Rules:
 * - Transaction must exist and target the correct deck
 * - Transaction must be in PRELOADING state
 * - Deck must be ready and not yet playing
 * - If the deck has a videoId, it must match the transaction's queueItem videoId
 *   (prevents advancing when a different video loaded due to a race condition)
 */
export function shouldAdvanceToReady(
  txn: AutoDjTransaction | null,
  deckId: DeckId,
  state: DeckReadyState
): boolean {
  if (!txn) return false;
  if (txn.targetDeck !== deckId) return false;
  if (txn.state !== 'PRELOADING') return false;
  if (!state.isReady || state.playing) return false;
  // Validate videoId matches — prevents race where a different video loads
  if (state.videoId && state.videoId !== txn.queueItem.videoId) return false;
  return true;
}

/**
 * Determines whether a transaction should be canceled due to a queue change.
 *
 * Rules:
 * - If no transaction exists, nothing to cancel
 * - If transaction is MIXING or PLAYING, allow it to complete
 * - If queue front item is different from transaction's queue item, cancel
 */
export function shouldCancelOnQueueChange(
  txn: AutoDjTransaction | null,
  queueFrontId: string | undefined
): boolean {
  if (!txn) return false;
  // Let PLAYING and MIXING complete — they've already started audio
  if (txn.state === 'PLAYING' || txn.state === 'MIXING') return false;
  // Cancel if queue no longer has this item at the front
  return !queueFrontId || queueFrontId !== txn.queueItem.id;
}

/**
 * Determines whether a transaction has timed out.
 * A transaction that stalls in PRELOADING or READY for too long should be abandoned
 * so the next queue item can be tried.
 */
export function isTransactionTimedOut(
  txn: AutoDjTransaction | null,
  timeoutMs: number,
  nowMs: number = Date.now()
): boolean {
  if (!txn) return false;
  if (txn.state === 'MIXING') return false; // Never time out mid-crossfade
  return nowMs - txn.startedAt > timeoutMs;
}

/**
 * Determines whether a manual load to a deck should cancel an active transaction.
 *
 * Rules:
 * - Cancel if the manual load targets the same deck as the transaction
 * - Do NOT cancel if the transaction is already MIXING (crossfade in progress)
 */
export function shouldCancelOnManualLoad(
  txn: AutoDjTransaction | null,
  deckId: DeckId
): boolean {
  if (!txn) return false;
  if (txn.targetDeck !== deckId) return false;
  if (txn.state === 'MIXING') return false; // Mid-crossfade, let it complete
  return true;
}
