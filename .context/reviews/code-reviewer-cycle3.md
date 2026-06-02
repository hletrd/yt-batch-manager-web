# Code Review — yt-batch-manager-web (cycle 3)

Re-review of all `src/**` + `build-docs.js`. Cycle-1/2 findings re-verified; only
NEW/residual items reported. Gates green at start (eslint 0, tsc 0, build ok).

## Re-verification (intact)
- B4 sort label i18n, B5 tag `oninput` parity, B8 tags-only restore → checkForChanges,
  B9/B10 tag tooltip, B11 overlay aria-busy, B13 rAF batch: all CONFIRMED in `app.ts`.
- B7/B8 hardcoded English strings → i18n keys (`tooltips.authRequired`,
  `status.authRequiredToRefresh`): CONFIRMED.
- Shared types extracted to `types.ts`; both modules import them: CONFIRMED.

## NEW / residual findings

### C-C3-1 (LOW) — Option markup not escaped (cross-listed with security S-C3-1)
`generateCategoryOptions`/`generateLanguageOptions` (`app.ts:1099-1132`) interpolate
API-sourced `id`/`title`/`name` raw. Inconsistent with the escaping used for the
placeholder option on the very same lines. Fix: `escapeHtmlAttribute` the value,
`escapeHtml` the text. Correctness (special chars) + defense-in-depth.

### C-C3-2 (LOW) — Imported records pollute the YouTube video cache on save
`updateVideo` → `updateVideoCache()` (`app.ts:2078`) serializes `state.allVideos` to the
`yt_video_cache` key. After a file import, `allVideos` are backup records that lack
`statistics`/`thumbnails`/`duration`/`upload_status` (those are YouTube-only and are
stripped on export at `filterVideoDataForBackup`). Saving one imported video therefore
overwrites the cache with incomplete records, so a later cache-backed `loadVideos()`
shows imported videos missing stats/thumbnails until a forced refresh. LOW: the cache is
24h/expiry-bounded and a "Load from YouTube" (forceRefresh) fully repopulates it; the UI
already shows the default thumbnail and 0 stats gracefully. Candidate fix: skip
`updateVideoCache()` when the active set originated from a file import, or tag the cache
with a `source` and only persist YouTube-sourced sets. Recommend DEFER (latent, no data
loss, low impact) with an exit criterion.

### C-C3-3 (INFO) — `batchUpdateVideos` still dead (B16 carried)
`youtube-api.ts:827-855` remains unused. Already deferred (DEFERRED.md B16) with exit
criterion "remove next `youtube-api.ts` refactor or if still unused next cycle." It IS
still unused this cycle — eligible for removal, but it is pure non-behavioral cleanup;
keep deferred to avoid churn unless this cycle touches the file.

## Non-issues
- `escapeHtml` via `div.textContent`/`innerHTML` is correct for text-node escaping.
- `arraysEqual`, `videoDiffersFromBaseline`, `publishedTime` NaN-guard: correct.
- `parseIsoDuration` handles the days component; `formatDuration` rolls days into hours.
