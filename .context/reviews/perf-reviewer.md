# Performance / Concurrency Review — yt-batch-manager-web

## Findings

### PERF-1 — O(n) `find` inside per-video handlers and batch loop — LOW/MEDIUM (confirmed)
`this.state.allVideos.find(v => v.id === videoId)` is called in nearly every handler: `checkForChanges` (`app.ts:1656`), `addTag`/`removeTag` (1788,1856), `renderTagsContainer` (1816), `updateVideo` (1875), and per-iteration in `saveAllChanges` (1272). For a channel with hundreds/thousands of uploads, each keystroke-driven `checkForChanges` does a linear scan. `getVideos` defaults to `maxResults=200` but can page further.
- Fix: maintain a `Map<string, VideoData>` index alongside `allVideos` (you already keep `originalVideosState` as a Map — mirror it for the live videos).
- Confidence: High that the scans exist; Medium on real-world impact (200 default cap keeps it small).

### PERF-2 — `scroll` listener not throttled — MEDIUM (confirmed)
`app.ts:848` `window.addEventListener('scroll', () => this.handleScroll())` fires `handleScroll` on every scroll event (can be 60+/s). `handleScroll` reads `document.documentElement.scrollHeight`/`innerHeight` (forced layout) each time. With many rendered video items this causes layout thrashing and jank during scroll.
- Fix: throttle/debounce via `requestAnimationFrame` guard or a passive listener + rAF. Also pass `{ passive: true }`.
- Confidence: High.

### PERF-3 — Full re-render on sort instead of reorder — LOW
`sortVideos` (`app.ts:1148`) calls `renderVideos(true)` which clears and rebuilds all DOM from page 0. Acceptable given infinite-scroll paging resets, but for large lists this discards already-built nodes. Note for awareness.

### PERF-4 — `updatePageTexts` re-queries whole document on every render tick — LOW (confirmed)
`renderer-i18n.ts:140-175` does three `document.querySelectorAll` over the entire document and is invoked inside the per-video `setTimeout` in `renderVideos` (`app.ts:557`) — i.e. once per video added. Rendering 20 videos triggers 20 full-document i18n sweeps in a 10ms burst.
- Fix: call `updatePageTexts` once after the batch insert, not per item.
- Confidence: High.

### PERF-5 — Sequential network calls in `saveAllChanges` — LOW (by design)
`saveAllChanges` (`app.ts:1270-1301`) awaits each `updateVideo` serially. This is intentional (avoids quota bursts / rate limits) and shows progress; acceptable. Note: there is no inter-request backoff on 403/quotaExceeded — a quota error aborts that item but the loop keeps hammering. Consider stopping early on `quotaExceeded`.
- Confidence: Medium.

### PERF-6 — Repeated `JSON.parse(localStorage)` of the whole video cache — LOW
`updateVideoCache` (`app.ts:691-710`) re-reads + parses the entire cache just to recover `channelId`, then re-serializes all videos. Called after every single-video save when not in batch mode. For large channels this serializes the whole array on each save. Cache the channelId in memory.
- Confidence: Medium.

### PERF-7 — `docs/*.png` are ~2MB each, copied into the deployed site — LOW
`build` copies `docs/` (5 PNGs, ~10MB total) into `dist/`. These are README screenshots; if `about.html` references them they bloat the deploy. Confirm whether they need to ship; consider compressing.
- Confidence: Medium.

## Sweep
- `autoResizeTextarea` sets `height='auto'` then reads `scrollHeight` (forced reflow) on every `input` event for the description (`app.ts:336,1634`). Per-keystroke reflow on a 5000-char textarea is noticeable. Debounce or only resize on significant change. LOW.
- `setInterval(... ,30000)` (`app.ts:913`) just console.logs unsaved-change count forever — harmless but pointless wakeups. Remove.
