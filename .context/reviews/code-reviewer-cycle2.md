# Code Review — yt-batch-manager-web (cycle 2)

NEW / residual findings only. Cycle-1 fixes (||-revert A2, dup types A11, index A23,
counter A13, etc.) re-verified intact.

## Findings

### C1 — `renderTagsContainer` re-render uses `onchange`, original render uses `oninput` (LOW→MEDIUM, High)
Citation: original tag input `src/app.ts:520` uses `oninput="app.handleTagChange(...)"`;
the re-rendered tag input in `renderTagsContainer` `src/app.ts:1906` uses
`onchange="app.handleTagChange(...)"`. After any add/remove tag (which calls
`renderTagsContainer`), the comma-splitting handler only fires on `change` (blur/commit)
instead of on every input. So after editing one tag, typing `a,b,` no longer
auto-splits into chips until the field loses focus — an inconsistent, surprising UX and
a behavioral drift between two code paths that should be identical.
Fix: use `oninput` in `renderTagsContainer` to match the initial render (and ideally
extract one shared template so they cannot drift again). Confidence: High.

### C2 — `originalVideosState` snapshot is a shallow copy; nested objects shared (LOW, Medium)
Citation: `src/app.ts:737,1492,1984`. `{ ...video, tags: [...] }` deep-copies only
`tags`. `statistics`, `thumbnails`, and `processing_progress` remain shared references
between the live `allVideos` entry and the "original" snapshot. Today nothing mutates
those nested objects in place, so no active bug — but it's a latent diff/restore hazard:
if a future edit mutates `video.statistics` or `video.thumbnails`, the "original"
silently mutates too and change-detection breaks. Fix: snapshot only the fields that
participate in diffing (title/description/privacy/category/lang/synthetic/tags) into a
dedicated structure, or structuredClone the snapshot. Confidence: Medium (latent).

### C3 — `interface TranslationData { [key:string]: any }` and `item: any` casts (LOW, High) — residual A27
Citation: `src/i18n/renderer-i18n.ts:1-3`; `src/app.ts:1079,1107`;
`src/youtube-api.ts:504,522,540,595,623` (`item: any`, `Promise<any>`). Same family as
cycle-1 A27 (deferred). The API-response `any`s remain; documented in DEFERRED.md.
No new action unless a typing-related runtime bug appears. Confidence: High (status).

### C4 — Duplicated reset bodies still present (LOW, High) — residual A26 dedup
Citation: `logout()` `src/app.ts:1501`, `removeSavedCredentials()` `:1574`,
`deleteCache()` `:1548` share near-identical channel/state-reset blocks; the
no-credentials markup is triplicated (`:351`, `:1004`). Deferred in cycle 1
(A26-dedup). Still accurate; non-behavioral. Confidence: High (status).

### C5 — `sortVideos` hardcodes English sort labels (LOW, Medium)
Citation: `src/app.ts:1170-1177` builds `sortLabels` in English and writes them to
`#current-sort` via `textContent`, bypassing i18n. After cycle-1 A7 translated most
dynamic labels, this one path still shows English ("Latest First", etc.) even in Korean
UI, and overwrites the `data-i18n` initial value set in index.html (line 1183) so the
next `updatePageTexts()` cannot re-localize it. Fix: map sort types to i18n keys and use
`rendererI18n.t(...)`, or set `data-i18n` + re-run updatePageTexts. Confidence: Medium.

## Sweep
- `refreshVideos` shows a hardcoded English string `'Authentication required to refresh
  videos'` (`app.ts:2025`) instead of an i18n key — minor i18n gap (see designer D-set).
- No dead code of note; `batchUpdateVideos` (`youtube-api.ts:784`) is unused by the app
  (only `updateVideo` is called in the batch loop) — candidate for removal, LOW.
