# RaikoMix YouTube DJ — Master Implementation Plan

**Version:** 1.0
**Date:** 2026-02-17
**North Star:** Consumer web DJ app — polished, easy-to-use browser-based mixer for casual users
**Deployment:** Vercel (web-only)
**Status:** Pre-execution review

---

## Table of Contents

1. [Architecture Assessment](#1-architecture-assessment)
2. [.claude Directory & Project Memory](#2-claude-directory--project-memory)
3. [Reusable Skills (Token Efficiency)](#3-reusable-skills-token-efficiency)
4. [Execution Roadmap — Task List](#4-execution-roadmap--task-list)
5. [Sub-agent Strategy](#5-sub-agent-strategy)
6. [QA/Testing Workflow](#6-qatesting-workflow)

---

## 1. Architecture Assessment

### Current State Summary

| Area | Files | Lines (est.) | Health |
|------|-------|-------------|--------|
| App shell & state | `App.tsx` | ~1,937 | CRITICAL — monolith, all state + Auto DJ logic |
| Deck engine | `Deck.tsx` | ~1,600 | LARGE — playback, waveform, cues, loops |
| Audio engine | `utils/audioEngine.ts`, `effectsChain.ts` | ~800 | OK — Web Audio routing |
| Mixer UI | `Mixer.tsx` | ~700 | OK |
| Library | `LibraryPanel.tsx`, `libraryStorage.ts` | ~900 | OK |
| Queue | `QueuePanel.tsx`, `queueStorage.ts` | ~400 | OK |
| Perf Pads | `PerformancePads.tsx`, `PerformancePadDialog.tsx` | ~2,800 | LARGE — dialog alone is 61KB |
| Search | `SearchPanel.tsx`, `youtubeApi.ts` | ~350 | OK |
| Effects UI | `EffectsPanel.tsx` | ~300 | OK |
| Waveform | `Waveform.tsx`, `TrimWaveform.tsx`, `waveform.ts` | ~900 | OK |
| Types | `types.ts` | ~150 | OK |
| Hooks | 3 custom hooks | ~400 | OK |
| Styles | 4 CSS token files | ~200 | OK |

### Critical Bugs (User-Confirmed)

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| **BUG-001** | P0 | Auto DJ | Race conditions in transition state machine — preload invalidation & early-start failures cause dead air |
| **BUG-002** | P1 | YouTube | Videos failing to load, playback state getting stuck, search failures |

### Architectural Risks

| Risk | Impact | Location |
|------|--------|----------|
| **R1: App.tsx monolith** | All state, Auto DJ logic, MIDI, effects routing in one 1,937-line file. Any bug fix risks regressions. | `App.tsx` |
| **R2: No test infrastructure** | Zero tests. No Vitest/Jest configured. No CI. Changes cannot be verified automatically. | `package.json` |
| **R3: No linting/formatting** | No ESLint or Prettier configured. Code style inconsistencies across files. | `package.json` |
| **R4: 25+ empty catch blocks** | Silent error swallowing across the codebase — makes debugging nearly impossible. | Various |
| **R5: No env validation** | `VITE_YOUTUBE_API_KEY` not validated at startup. Failures surface deep in runtime. | `youtubeApi.ts` |
| **R6: Unused Gemini dependency** | `@google/genai` adds bundle weight with no current use. | `package.json` |

---

## 2. `.claude` Directory & Project Memory

### Proposed Structure

```
.claude/
├── claude.md              # Permanent project memory (loaded every session)
├── settings.json          # Claude Code tool permissions
└── skills/
    ├── bugfix.md          # Bug-fixing workflow skill
    ├── build-check.md     # Build verification skill
    └── deploy-check.md    # Pre-deploy checklist skill
```

### `claude.md` — Project Memory Design

The `claude.md` file eliminates redundant file reads across sessions. It will contain:

```markdown
# RaikoMix YouTube DJ — Claude Project Memory

## Quick Reference
- **Stack:** React 19, TypeScript 5.8, Vite 6.2, Web Audio API, YouTube IFrame API
- **Deploy:** Vercel (vercel.json in project root)
- **Entry:** main.tsx → App.tsx (monolith — all state lives here)
- **North Star:** Consumer web DJ app for casual users

## File Map (read these files to understand the area)
- State & Auto DJ logic: App.tsx (lines 91-1937)
- Transaction state machine: App.tsx (lines 70-85)
- Deck playback engine: components/Deck.tsx
- Audio routing & effects: utils/audioEngine.ts, utils/effectsChain.ts
- YouTube integration: utils/youtubeApi.ts
- Library persistence: utils/libraryStorage.ts
- Types: types.ts

## Key Architecture Decisions
- All application state is in App.tsx via useState hooks (no Redux/Zustand)
- Deck components expose imperative handles via React.forwardRef + useImperativeHandle
- Auto DJ uses a transaction state machine (TransitionTransaction interface)
- Audio graph: YouTube IFrame → MediaElementSource → EQ → Effects → GainNode → Destination
- Storage: localStorage for library/playlists/settings, IndexedDB for audio samples

## Active Bugs
- BUG-001 (P0): Auto DJ race conditions — see IMPLEMENTATION_P0-1.md
- BUG-002 (P1): YouTube playback failures — stuck states, load errors

## Conventions
- No test framework yet — manual testing only
- Component files are self-contained (styles colocated or in styles/ tokens)
- IDs generated via utils/id.ts (makeId)
- Toast notifications via components/Toast.tsx
```

---

## 3. Reusable Skills (Token Efficiency)

Skills trigger focused, repeatable workflows without re-explaining context each time.

### Skill 1: `bugfix` — Bug Investigation & Fix Workflow

**Trigger:** When working on any bug
**Steps:**
1. Read the relevant file(s) identified in `claude.md` file map
2. Search for the specific symptom (error messages, state names)
3. Identify root cause and propose a minimal fix
4. Apply fix, verify build passes (`npm run build`)
5. Document fix in commit message with bug ID

### Skill 2: `build-check` — Build Verification

**Trigger:** After any code change
**Steps:**
1. Run `npm run build` — check for TypeScript errors
2. If errors, fix them
3. Confirm clean build before commit

### Skill 3: `deploy-check` — Pre-Deploy Checklist

**Trigger:** Before pushing to production
**Steps:**
1. Verify `npm run build` succeeds
2. Check `vercel.json` configuration
3. Confirm no hardcoded localhost URLs
4. Verify env vars documented
5. Check bundle size hasn't regressed dramatically

---

## 4. Execution Roadmap — Task List

### Priority Legend
- **P0** = Must fix — app broken without it
- **P1** = Should fix — significant user impact
- **P2** = Nice to have — quality of life
- **P3** = Future — post-launch enhancement

### Task Dependency Graph

```
TASK-001 (Test infra) ─────────────────────────────────────┐
    │                                                       │
TASK-002 (Build check) ──┐                                  │
    │                     │                                  │
TASK-003 (BUG-001 fix) ──┤                                  │
    │                     │                                  │
TASK-004 (BUG-002 fix)   │                                  │
    │                     │                                  │
TASK-005 (Error handling) ┘                                  │
    │                                                       │
TASK-006 (Env validation) ─── TASK-007 (App.tsx refactor) ──┤
                                    │                       │
                              TASK-008 (Gemini cleanup)     │
                                    │                       │
                              TASK-009 (Lint + format) ─────┘
                                    │
                              TASK-010 (Final QA + deploy)
```

---

### TASK-001: Set Up Vitest Test Infrastructure
**Priority:** P0 | **Blocks:** TASK-003, TASK-004, TASK-005, TASK-010
**Scope:** Add Vitest + testing-library. Create first smoke tests.
**Details:**
- Install `vitest`, `@testing-library/react`, `jsdom`
- Configure `vite.config.ts` with test settings
- Add `test` script to `package.json`
- Write smoke tests: App renders, library loads, queue operations work
- **Why first:** Every subsequent fix needs verification. Without tests we're flying blind.

**Sub-agent candidate:** Yes — isolated setup, no business logic dependency.

---

### TASK-002: Verify & Fix Current Build
**Priority:** P0 | **Blocks:** TASK-003, TASK-004
**Scope:** Ensure `npm run build` passes cleanly.
**Details:**
- Run `npm install` and `npm run build`
- Fix any TypeScript compilation errors
- Fix any Vite build warnings
- Establish baseline: "main branch builds clean"

**Sub-agent candidate:** Yes — isolated build verification.

---

### TASK-003: Fix BUG-001 — Auto DJ Race Conditions
**Priority:** P0 | **Blocked by:** TASK-001, TASK-002
**Scope:** Complete the P0-1 Transaction State Machine (Phase 2-4 from `IMPLEMENTATION_P0-1.md`).
**Details:**
- Audit current `activeTransactionRef` implementation in `App.tsx` (lines 70-85, 982+)
- Complete Phase 2: Replace remaining old refs, add validation gates
- Complete Phase 3: Write tests for all 4 failure scenarios
- Complete Phase 4: Update documentation
- **Success criteria from IMPLEMENTATION_P0-1.md:**
  - Zero race conditions in 100+ consecutive Auto DJ transitions
  - Manual deck loads properly cancel pending transitions
  - Network failures don't cause dead air
  - Queue remains synchronized with actual playback

**Sub-agent candidate:** No — requires deep App.tsx context, main thread work.

---

### TASK-004: Fix BUG-002 — YouTube Playback Failures
**Priority:** P1 | **Blocked by:** TASK-002
**Scope:** Diagnose and fix YouTube video load failures and stuck states.
**Details:**
- Investigate YouTube IFrame API error handling in `Deck.tsx`
- Audit `onError`, `onStateChange` callbacks for unhandled states
- Fix stuck states (player reports BUFFERING/UNSTARTED indefinitely)
- Add retry logic for transient load failures
- Add user-facing error states ("Video unavailable" instead of silent failure)
- Test with age-restricted, region-locked, and removed videos
- Test Invidious fallback search path

**Sub-agent candidate:** Yes — scoped to `Deck.tsx` + `youtubeApi.ts` only.

---

### TASK-005: Fix Silent Error Swallowing
**Priority:** P1 | **Blocked by:** TASK-002
**Scope:** Replace 25+ empty catch blocks with proper error handling.
**Details:**
- Grep all empty `catch` blocks across the codebase
- Categorize: user-facing (show toast) vs. internal (log + continue)
- Replace with appropriate handling:
  - User actions: Toast notification with actionable message
  - Background ops: `console.error` + optional telemetry
  - Critical failures: ErrorBoundary escalation
- Add the `errorHandler.ts` utility (file exists but may be incomplete)

**Sub-agent candidate:** Yes — mechanical refactoring across many files, no cross-cutting logic.

---

### TASK-006: Add Environment Validation
**Priority:** P2 | **Blocked by:** TASK-002
**Scope:** Validate env vars at startup with clear error messages.
**Details:**
- Create `utils/env.ts` validation module
- Check `VITE_YOUTUBE_API_KEY` at startup
- Show clear UI warning if missing (not just console error)
- Document all env vars in README

**Sub-agent candidate:** Yes — small, isolated task.

---

### TASK-007: Refactor App.tsx — Extract Auto DJ Logic
**Priority:** P2 | **Blocked by:** TASK-003
**Scope:** Break the 1,937-line monolith into focused modules.
**Details:**
- Extract Auto DJ state machine → `hooks/useAutoDJ.ts`
- Extract MIDI logic → `hooks/useMIDI.ts`
- Extract effects routing → `hooks/useEffectsRouting.ts`
- Keep App.tsx as orchestrator (~500 lines)
- **Do NOT refactor until BUG-001 is fixed** — refactoring a buggy system creates moving targets

**Sub-agent candidate:** No — requires full understanding of state flow, main thread work.

---

### TASK-008: Clean Up Gemini Dependency
**Priority:** P3 | **Blocked by:** TASK-002
**Scope:** Remove unused `@google/genai` to reduce bundle size.
**Details:**
- Verify no active imports/usage beyond `package.json`
- Remove from `dependencies`
- Run build to confirm no breakage
- Note: User said "not sure yet" — deprioritize, can re-add later if needed

**Sub-agent candidate:** Yes — trivial, isolated.

---

### TASK-009: Add ESLint + Prettier
**Priority:** P3 | **Blocked by:** TASK-007
**Scope:** Enforce consistent code style.
**Details:**
- Install ESLint + Prettier with React/TypeScript presets
- Configure with reasonable defaults (not overly strict)
- Fix auto-fixable issues
- Add `lint` script to `package.json`
- **After TASK-007** so we lint the refactored, cleaner structure

**Sub-agent candidate:** Yes — isolated config + auto-fix.

---

### TASK-010: Final QA & Production Deploy
**Priority:** P0 | **Blocked by:** ALL previous tasks
**Scope:** End-to-end validation and production deployment.
**Details:**
- Full manual QA pass (see Section 6)
- Verify Vercel deployment config
- Performance check (bundle size, load time)
- Cross-browser smoke test (Chrome, Firefox, Safari)
- Tag release `v1.0.0`

**Sub-agent candidate:** No — requires holistic assessment.

---

## 5. Sub-agent Strategy

Sub-agents protect the main context window and enable parallel work on independent modules.

| Task | Agent Type | Context Window Contents | Why Isolated |
|------|-----------|------------------------|--------------|
| TASK-001 | `Bash` agent | `package.json`, `vite.config.ts` | Config-only, no business logic needed |
| TASK-002 | `Bash` agent | Build output only | Just runs build and reports errors |
| TASK-004 | `Explore` + `general-purpose` | `Deck.tsx`, `youtubeApi.ts`, `types.ts` | Scoped to YouTube layer, no Auto DJ overlap |
| TASK-005 | `general-purpose` | All files (grep-driven) | Mechanical refactoring, no design decisions |
| TASK-006 | `general-purpose` | `youtubeApi.ts`, `utils/env.ts` (new) | Small, isolated utility |
| TASK-008 | `Bash` agent | `package.json` | One-liner removal + build check |
| TASK-009 | `general-purpose` | Config files only | Linting config is isolated from app logic |

### Main Thread Reserved Tasks (require full context)

- **TASK-003** (BUG-001 Auto DJ fix) — touches `App.tsx` deeply, needs understanding of all state interactions
- **TASK-007** (App.tsx refactor) — architectural restructuring of the core file
- **TASK-010** (Final QA) — holistic assessment across all modules

### Token Efficiency Estimate

| Approach | Est. Tokens/Session |
|----------|-------------------|
| Naive (re-read everything) | ~150K input per session |
| With `claude.md` memory | ~15K input per session (10x reduction) |
| With sub-agents for isolated tasks | ~40K total across agents vs ~80K in main thread |
| With skills for repeatable workflows | ~5K per invocation vs ~15K explaining from scratch |

---

## 6. QA/Testing Workflow

Every task must pass this gate before the next task begins.

### Per-Task QA Checklist

```
[ ] 1. Build passes: `npm run build` — zero errors
[ ] 2. Tests pass: `npm run test` (after TASK-001 sets this up)
[ ] 3. Manual smoke test of affected area:
      - Load the app in browser
      - Test the specific feature changed
      - Test one adjacent feature (regression check)
[ ] 4. No new console errors/warnings in browser DevTools
[ ] 5. Commit with descriptive message referencing task ID
```

### Feature-Specific QA Scripts

**Auto DJ (TASK-003):**
```
[ ] Load 5+ tracks to queue
[ ] Enable Auto DJ — verify first transition
[ ] Let 3+ transitions run unattended
[ ] During a preload, manually load a track to the target deck — verify graceful cancel
[ ] Simulate network lag (DevTools throttling) — verify no dead air
[ ] Disable Auto DJ mid-transition — verify clean stop
```

**YouTube Playback (TASK-004):**
```
[ ] Search for a track — verify results appear
[ ] Load result to Deck A — verify playback starts
[ ] Load result to Deck B — verify independent playback
[ ] Search with no API key — verify Invidious fallback works
[ ] Load an unavailable/removed video — verify error message shown
[ ] Rapid-fire load 3 tracks in sequence — verify no stuck state
```

**Error Handling (TASK-005):**
```
[ ] Trigger a known error path — verify toast appears
[ ] Check browser console — no uncaught exceptions
[ ] Verify ErrorBoundary catches component crashes
```

### Final QA (TASK-010) — Full Regression Suite

```
CORE PLAYBACK
[ ] Load YouTube track to Deck A — plays correctly
[ ] Load YouTube track to Deck B — plays correctly
[ ] Crossfader sweeps audio smoothly between decks
[ ] Volume faders work on both decks
[ ] Play/pause/seek work on both decks

MIXING
[ ] EQ knobs (high/mid/low) affect audio on both decks
[ ] Filter sweep works
[ ] All 3 crossfader curves work (Smooth/Cut/Dip)

AUTO DJ
[ ] Enable with 5+ tracks in queue — runs unattended for 10+ minutes
[ ] Manual override during transition — graceful handling
[ ] Empty queue — Auto DJ stops gracefully

LIBRARY & QUEUE
[ ] Add track to library from search
[ ] Remove track from library
[ ] Import/export library
[ ] Add track to queue
[ ] Reorder queue via drag-and-drop
[ ] Import YouTube playlist

EFFECTS
[ ] Apply each effect category — audio changes heard
[ ] Wet/dry knob works
[ ] FX target switching (A/B/AB/Pads) works

PERFORMANCE PADS
[ ] Load a sample to a pad
[ ] Trigger pad — audio plays
[ ] Trim editing works
[ ] Key binding works

MIDI
[ ] Connect MIDI controller — detected
[ ] MIDI learn maps a control
[ ] Mapped control operates as expected

KEYBOARD
[ ] All documented shortcuts work
[ ] No conflicts between shortcuts

RESPONSIVE / VISUAL
[ ] App loads without errors
[ ] Waveform displays correctly
[ ] No layout overflow on standard screen sizes
```

---

## Execution Order Summary

```
Phase 0 — Foundation (this session)
  ├── Create .claude/claude.md (project memory)
  └── Create plan.md (this document) ✅

Phase 1 — Build Stability
  ├── TASK-002: Verify build passes
  └── TASK-001: Set up Vitest

Phase 2 — Critical Bug Fixes
  ├── TASK-003: Fix Auto DJ race conditions (P0)
  └── TASK-004: Fix YouTube playback failures (P1)  [parallel with TASK-003]

Phase 3 — Reliability
  ├── TASK-005: Fix silent error swallowing
  └── TASK-006: Add env validation

Phase 4 — Code Quality
  ├── TASK-007: Refactor App.tsx
  ├── TASK-008: Remove Gemini dependency
  └── TASK-009: Add ESLint + Prettier

Phase 5 — Ship It
  └── TASK-010: Final QA & deploy v1.0.0
```

---

*This plan is designed for maximum token efficiency. The `.claude/claude.md` eliminates redundant file reads. Sub-agents keep the main thread lean. Skills make repeatable workflows instant. The dependency graph prevents wasted work on features that would need to be redone.*
