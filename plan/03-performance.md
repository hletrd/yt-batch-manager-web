# Plan 03 — Performance

Sources: A10, A23, A24, A25, A30.

## Tasks

### [x] T1 — Throttle scroll + passive listener (A10)
`app.ts:848`: wrap `handleScroll` in a `requestAnimationFrame` guard (ignore re-entrant calls until the frame runs) and register with `{ passive: true }`.
Acceptance: scroll handler runs at most once per frame; no layout thrash regression; build green.

### [x] T2 — Run `updatePageTexts` once per render batch (A10)
`app.ts:557`: move `rendererI18n.updatePageTexts()` out of the per-video `setTimeout` so it runs once after the batch insert instead of N times.
Acceptance: a single i18n sweep per `renderVideos` call.

### [x] T3 — Add a Map index for videos (A23)
Maintain `private videoIndex: Map<string, VideoData>` rebuilt whenever `allVideos` is (re)assigned (loadVideos, importVideoData, logout/reset). Replace hot-path `allVideos.find(v=>v.id===id)` in `checkForChanges`, `addTag`, `removeTag`, `renderTagsContainer`, `updateVideo`, `saveAllChanges` with `videoIndex.get(id)`.
Acceptance: handlers no longer linear-scan; behavior identical; build green.

### [x] T4 — Cache channelId in memory (A24)
Store `private cachedChannelId?: string` set when videos are cached/loaded; `updateVideoCache` uses it instead of re-parsing the entire cache to recover channelId.
Acceptance: no full-cache `JSON.parse` on each single-video save.

### [x] T5 — Remove pointless 30s interval (A25)
Delete the `setInterval(...,30000)` console.log block at `app.ts:913` (no functional purpose).
Acceptance: interval removed.

### [D] T6 — Debounce textarea auto-resize (A30) — deferred
Deferred (see DEFERRED.md, A30): rAF-batching the per-keystroke reflow risks visible layout jitter and needs live UX verification not feasible this cycle.

## Progress
T1–T5 implemented and committed (signed): 7702e4d. tsc/eslint green. T6 deferred (A30).
