# Performance Review — yt-batch-manager-web (cycle 2)

NEW / residual only. Cycle-1 perf fixes (rAF scroll A10, single i18n sweep, Map index
A23, in-memory channelId A24, removed 30s interval A25) re-verified intact.

## Findings

### P1 — Per-video `setTimeout(...,10)` in render loop schedules N timers per batch (LOW, Medium)
Citation: `src/app.ts:537-546`. For each inserted video a separate `setTimeout(fn,10)`
runs textarea sizing + 3 counter updates. For a 20-video page that is 20 timers firing
~together, each forcing layout reads (`scrollHeight`) → a layout-thrash burst right
after insert. The batch i18n sweep was already hoisted out (A10/cycle1), but this
per-video timer was not. Fix: do the post-insert sizing/counters in a single
`requestAnimationFrame` that iterates `videosToAdd` once. Related to deferred A28/A30.
Confidence: Medium. (Lower priority; correctness fixes come first.)

### P2 — `updatePageTexts()` full-document sweep still O(elements) per call (LOW, Medium) — residual
Citation: `src/i18n/renderer-i18n.ts:140-175`; called after every render batch, after
auth prompts, and twice in init. Each call `querySelectorAll('[data-i18n]')` over the
whole document plus two more selector sweeps. With hundreds of rendered videos this is a
non-trivial repeated scan. Cycle 1 reduced call frequency (A10); scoping the sweep to
the newly-inserted subtree would remove the residual cost. Confidence: Medium (residual,
acceptable for current scale).

### P3 — `autoResizeTextarea` per-keystroke reflow (LOW, Medium) — residual A30, deferred
Citation: `src/app.ts:314-318,325-327,1699`. Unchanged; tracked in DEFERRED.md (A30).

## Sweep
- `getVideos` paginates the uploads playlist (1 quota unit/page) — good (cycle-1 A* perf).
- `saveAllChanges` updates videos sequentially (await in loop). This is intentional to
  respect quota / avoid 409s and to drive the progress overlay; not flagged.
- No memory leaks: listeners are delegated at document level; per-video listeners in
  `setupInputEditListenersForVideo` remove-then-add to avoid duplicates.
