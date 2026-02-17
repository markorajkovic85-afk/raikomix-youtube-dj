# RaikoMix YouTube DJ — Claude Project Memory

## Quick Reference
- **Stack:** React 19, TypeScript 5.8, Vite 6.2, Web Audio API, YouTube IFrame API
- **Deploy:** Vercel (`vercel.json` in project root)
- **Entry:** `main.tsx` → `App.tsx` (monolith — all state lives here)
- **North Star:** Consumer web DJ app — polished, easy-to-use for casual users
- **Project root:** `raikomix-youtube-dj_1.0/` (all source lives inside this subdirectory)

## File Map

### Core (read these to understand overall architecture)
- **App.tsx** — All application state, Auto DJ logic, MIDI handling, effects routing (~1,937 lines)
- **types.ts** — All TypeScript interfaces (PlayerState, QueueItem, LibraryTrack, TransitionTransaction, etc.)
- **main.tsx** — React entry point

### Components
| File | Purpose | Size |
|------|---------|------|
| `components/Deck.tsx` | DJ deck: YouTube player, waveform, tempo, hot cues, loops | ~1,600 lines |
| `components/Mixer.tsx` | Crossfader, volume, EQ knobs, Auto DJ settings | ~700 lines |
| `components/LibraryPanel.tsx` | Track library, search, import/export, playlist management | ~900 lines |
| `components/QueuePanel.tsx` | Play queue, drag-reorder, Auto DJ toggle | ~400 lines |
| `components/SearchPanel.tsx` | Real-time YouTube search | ~150 lines |
| `components/EffectsPanel.tsx` | 16 audio effects selection UI | ~300 lines |
| `components/PerformancePads.tsx` | 12-pad sampler with effects routing | ~1,000 lines |
| `components/PerformancePadDialog.tsx` | Pad config dialog with waveform trimming | ~1,800 lines |
| `components/Waveform.tsx` | High-performance multi-resolution waveform renderer | ~550 lines |
| `components/TrimWaveform.tsx` | Interactive trim waveform for pads | ~200 lines |
| `components/Toast.tsx` | Toast notification system | ~100 lines |
| `components/RotaryKnob.tsx` | Rotary knob visualization | ~100 lines |
| `components/ui/Fader.tsx` | Slider component | small |
| `components/ui/Knob.tsx` | Rotary knob control | small |
| `components/ui/Toggle.tsx` | Toggle button | small |

### Utilities
| File | Purpose |
|------|---------|
| `utils/audioEngine.ts` | Web Audio API context, gain nodes, audio graph setup |
| `utils/effectsChain.ts` | Audio effect nodes (reverb, delay, flanger, etc.) |
| `utils/youtubeApi.ts` | YouTube Data API v3 search + Invidious fallback |
| `utils/libraryStorage.ts` | localStorage CRUD for track library |
| `utils/queueStorage.ts` | localStorage CRUD for queue |
| `utils/performancePadsStorage.ts` | localStorage + IndexedDB for pad configs and audio samples |
| `utils/waveform.ts` | Waveform data generation from audio buffers |
| `utils/bpmDetection.ts` | BPM detection algorithm |
| `utils/errorHandler.ts` | Error handling utilities |
| `utils/analytics.ts` | Usage analytics |
| `utils/storage.ts` | Generic storage helpers |
| `utils/id.ts` | `makeId()` — unique ID generation |

### Hooks
| File | Purpose |
|------|---------|
| `hooks/useKeyboardShortcuts.ts` | Global keyboard event handler |
| `hooks/useTheme.ts` | Theme management |
| `hooks/useFitCentralStage.ts` | Responsive scaling for central mixer stage |

### Styles
- `styles/tokens.css` — Design tokens
- `styles/elevation.css` — Shadow/elevation utilities
- `styles/motion.css` — Animation utilities
- `styles/deck-visual.css` — Deck-specific visual styles

## Key Architecture Decisions
1. **All state in App.tsx** — useState hooks, no Redux/Zustand. Deck components use forwardRef + useImperativeHandle for imperative control.
2. **Auto DJ Transaction State Machine** — `TransitionTransaction` interface at App.tsx:78. States: PRELOADING → READY → PLAYING → MIXING → null. Replaces old broken multi-ref approach.
3. **Audio graph:** YouTube IFrame → MediaElementSource → BiquadFilter (EQ) → Effects chain → GainNode → AudioContext.destination
4. **Storage:** localStorage for library/playlists/settings, IndexedDB for large audio samples (performance pads)
5. **YouTube fallback:** If `VITE_YOUTUBE_API_KEY` missing, search falls back to Invidious instances

## Active Bugs
- ✅ **BUG-001 (P0) — RESOLVED:** Fixed in TASK-003 (`bd605fe`) with Auto DJ transaction-state-machine hardening.
- ✅ **BUG-002 (P1) — RESOLVED:** Fixed in TASK-004 (`93ddc53`) with YouTube playback failure handling hardening.
- Current status: no active P0/P1 bug tickets open.

## Next Steps Status (Audited 2026-02-17)
- **TASK-005:** ✅ Complete in `2783999` (empty `catch {}` blocks removed from active source files, replaced with explicit recoverable logging).
- **TASK-006:** Not started (no dedicated startup env validation module yet).
- **TASK-007:** Not started (`App.tsx` monolith still in place).
- **TASK-008:** Not started (`@google/genai` still present in dependencies).
- **TASK-009:** Not started (ESLint/Prettier config not added).
- **TASK-010:** Pending (depends on TASK-005 through TASK-009).

## Test Infrastructure (TASK-001 — COMPLETE 2026-02-17)
- **Framework:** Vitest ^4.0.18 + jsdom + @testing-library/react
- **Commands:** `npm run test` (CI), `npm run test:watch` (dev), `npm run test:ui` (browser)
- **Setup file:** `setupTests.ts` — imports jest-dom matchers, clears localStorage `beforeEach`
- **Smoke tests:** `__tests__/smoke.test.ts` — 21 tests across 7 utility functions, all green
- **Scope:** Utilities only. Component tests (Deck, App) require Web Audio + YouTube IFrame mocks — deferred.

## Known Technical Debt
- TASK-005 completed: silent `catch {}` swallowing removed from active source files in `2783999`; continue monitoring new code for explicit handling.
- No linting/formatting tools → TASK-009
- `@google/genai` dependency unused (deprioritized) → TASK-008
- App.tsx is a 1,937-line monolith → TASK-007

## Conventions
- Component files are self-contained
- IDs generated via `utils/id.ts` (`makeId()`)
- Toast notifications via `components/Toast.tsx` (`showToast(msg, type)`)
- CSS uses design tokens from `styles/tokens.css`
- localStorage keys prefixed with `raikomix_` (e.g., `raikomix_library`)
- Tests live in `__tests__/` directory; reference `plan.md` for QA checklists
