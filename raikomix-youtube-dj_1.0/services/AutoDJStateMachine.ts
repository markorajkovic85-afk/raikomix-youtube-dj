/**
 * Auto DJ State Machine
 * Implements transaction-safe state transitions for Auto DJ with rollback capability
 * Fixes P0-1: Auto DJ Track Transition Failures
 */

import { DeckId, PlayerState, QueueItem } from '../types';

export type AutoDJStage = 'idle' | 'preloading' | 'early_start' | 'crossfading' | 'finalizing';

export type AutoDJState = 
  | { stage: 'idle' }
  | { stage: 'preloading'; transaction: AutoDJTransaction }
  | { stage: 'early_start'; transaction: AutoDJTransaction }
  | { stage: 'crossfading'; transaction: AutoDJTransaction }
  | { stage: 'finalizing'; transaction: AutoDJTransaction };

export interface AutoDJTransaction {
  id: string;
  targetDeck: DeckId;
  queueItem: QueueItem;
  startTime: number;
  preloadedVideoId: string | null;
  validUntil: number;
}

export interface StateContext {
  deckStates: { A: PlayerState | null; B: PlayerState | null };
  queue: QueueItem[];
  currentTime: number;
}

export type AutoDJError = 
  | { code: 'DECK_NOT_READY'; deck: DeckId }
  | { code: 'QUEUE_EMPTY' }
  | { code: 'PRELOAD_FAILED'; videoId: string; reason: string }
  | { code: 'STALE_TRANSACTION'; transactionId: string }
  | { code: 'INVALID_TRANSITION'; from: AutoDJStage; to: AutoDJStage };

export type Result<T, E> = 
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Auto DJ State Machine
 * Manages state transitions for automated DJ mixing with transaction safety
 */
export class AutoDJStateMachine {
  private state: AutoDJState = { stage: 'idle' };
  private transactionHistory: AutoDJTransaction[] = [];
  private readonly MAX_TRANSACTION_HISTORY = 10;
  private readonly TRANSACTION_TIMEOUT_MS = 30000; // 30 seconds

  constructor() {
    console.log('[AutoDJ SM] Initialized');
  }

  /**
   * Get current state
   */
  public getState(): AutoDJState {
    return this.state;
  }

  /**
   * Get current transaction (if any)
   */
  public getCurrentTransaction(): AutoDJTransaction | null {
    return this.state.stage !== 'idle' ? this.state.transaction : null;
  }

  /**
   * Check if state machine can transition to a new stage
   */
  public canTransitionTo(to: AutoDJStage, context: StateContext): Result<boolean, AutoDJError> {
    const from = this.state.stage;

    // Idle can transition to preloading
    if (from === 'idle' && to === 'preloading') {
      if (context.queue.length === 0) {
        return { success: false, error: { code: 'QUEUE_EMPTY' } };
      }
      return { success: true, value: true };
    }

    // Preloading can transition to early_start or crossfading
    if (from === 'preloading' && (to === 'early_start' || to === 'crossfading')) {
      return { success: true, value: true };
    }

    // Early_start can transition to crossfading
    if (from === 'early_start' && to === 'crossfading') {
      return { success: true, value: true };
    }

    // Crossfading can transition to finalizing
    if (from === 'crossfading' && to === 'finalizing') {
      return { success: true, value: true };
    }

    // Finalizing can transition to idle
    if (from === 'finalizing' && to === 'idle') {
      return { success: true, value: true };
    }

    // Any stage can transition back to idle (abort/reset)
    if (to === 'idle') {
      return { success: true, value: true };
    }

    return {
      success: false,
      error: { code: 'INVALID_TRANSITION', from, to }
    };
  }

  /**
   * Validate deck state for transition
   */
  public validateDeckState(deckState: PlayerState | null, stage: AutoDJStage): boolean {
    if (!deckState) return false;

    switch (stage) {
      case 'preloading':
        // Deck should be ready to accept new track
        return true;
      case 'early_start':
        // Deck should be ready and have correct track loaded
        return deckState.isReady;
      case 'crossfading':
        // Deck should be playing
        return deckState.isReady && deckState.playing;
      case 'finalizing':
        return deckState.isReady;
      default:
        return true;
    }
  }

  /**
   * Create a new transaction
   */
  private createTransaction(targetDeck: DeckId, queueItem: QueueItem, context: StateContext): AutoDJTransaction {
    const transaction: AutoDJTransaction = {
      id: `${targetDeck}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      targetDeck,
      queueItem,
      startTime: context.currentTime,
      preloadedVideoId: null,
      validUntil: context.currentTime + this.TRANSACTION_TIMEOUT_MS
    };

    console.log('[AutoDJ SM] Created transaction:', transaction.id);
    return transaction;
  }

  /**
   * Start preloading a track
   */
  public startPreload(targetDeck: DeckId, queueItem: QueueItem, context: StateContext): Result<AutoDJTransaction, AutoDJError> {
    console.log('[AutoDJ SM] startPreload:', { targetDeck, queueItem: queueItem.title });

    const canTransition = this.canTransitionTo('preloading', context);
    if (!canTransition.success) {
      return { success: false, error: canTransition.error };
    }

    const transaction = this.createTransaction(targetDeck, queueItem, context);
    this.state = { stage: 'preloading', transaction };

    return { success: true, value: transaction };
  }

  /**
   * Mark preload as complete
   */
  public completePreload(videoId: string): Result<void, AutoDJError> {
    if (this.state.stage !== 'preloading') {
      console.warn('[AutoDJ SM] completePreload called but not in preloading stage');
      return { success: false, error: { code: 'INVALID_TRANSITION', from: this.state.stage, to: 'preloading' } };
    }

    this.state.transaction.preloadedVideoId = videoId;
    console.log('[AutoDJ SM] Preload complete:', videoId);

    return { success: true, value: undefined };
  }

  /**
   * Start the target deck early (before crossfade)
   */
  public startEarly(context: StateContext): Result<void, AutoDJError> {
    console.log('[AutoDJ SM] startEarly');

    if (this.state.stage !== 'preloading') {
      return { success: false, error: { code: 'INVALID_TRANSITION', from: this.state.stage, to: 'early_start' } };
    }

    const targetDeckState = this.state.transaction.targetDeck === 'A' ? context.deckStates.A : context.deckStates.B;
    if (!this.validateDeckState(targetDeckState, 'early_start')) {
      return { success: false, error: { code: 'DECK_NOT_READY', deck: this.state.transaction.targetDeck } };
    }

    this.state = { stage: 'early_start', transaction: this.state.transaction };
    return { success: true, value: undefined };
  }

  /**
   * Start crossfade
   */
  public startCrossfade(context: StateContext): Result<void, AutoDJError> {
    console.log('[AutoDJ SM] startCrossfade');

    const canTransition = this.canTransitionTo('crossfading', context);
    if (!canTransition.success) {
      return { success: false, error: canTransition.error };
    }

    if (this.state.stage === 'idle') {
      return { success: false, error: { code: 'INVALID_TRANSITION', from: 'idle', to: 'crossfading' } };
    }

    this.state = { stage: 'crossfading', transaction: this.state.transaction };
    return { success: true, value: undefined };
  }

  /**
   * Finalize the transition
   */
  public finalize(): Result<void, AutoDJError> {
    console.log('[AutoDJ SM] finalize');

    if (this.state.stage === 'idle') {
      return { success: false, error: { code: 'INVALID_TRANSITION', from: 'idle', to: 'finalizing' } };
    }

    const transaction = this.state.transaction;
    this.addToHistory(transaction);
    this.state = { stage: 'idle' };

    return { success: true, value: undefined };
  }

  /**
   * Check if transaction is still valid (not expired)
   */
  public isTransactionValid(transactionId: string, currentTime: number): boolean {
    const transaction = this.getCurrentTransaction();
    if (!transaction || transaction.id !== transactionId) {
      return false;
    }

    return currentTime <= transaction.validUntil;
  }

  /**
   * Rollback current transaction
   */
  public rollback(): void {
    console.log('[AutoDJ SM] Rollback');

    if (this.state.stage !== 'idle') {
      const transaction = this.state.transaction;
      console.log('[AutoDJ SM] Rolling back transaction:', transaction.id);
      this.state = { stage: 'idle' };
    }
  }

  /**
   * Reset state machine completely
   */
  public reset(): void {
    console.log('[AutoDJ SM] Reset');
    this.state = { stage: 'idle' };
    this.transactionHistory = [];
  }

  /**
   * Add transaction to history
   */
  private addToHistory(transaction: AutoDJTransaction): void {
    this.transactionHistory.push(transaction);
    if (this.transactionHistory.length > this.MAX_TRANSACTION_HISTORY) {
      this.transactionHistory.shift();
    }
  }

  /**
   * Get transaction history
   */
  public getHistory(): AutoDJTransaction[] {
    return [...this.transactionHistory];
  }

  /**
   * Cleanup expired transactions from history
   */
  public cleanupHistory(currentTime: number): void {
    this.transactionHistory = this.transactionHistory.filter(
      t => currentTime - t.startTime < this.TRANSACTION_TIMEOUT_MS * 2
    );
  }
}
