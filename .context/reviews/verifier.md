# Verifier / Debugger — evidence-based correctness review

Gates run at baseline: `eslint src/**/*.ts` → 0 errors (1 config warning, CR-8); `tsc -p tsconfig.json --noEmit` → 0 errors; `npm run build` → success. i18n key parity: en=110, ko=110, no missing keys; all `rendererI18n.t()` keys (48) and all HTML `data-i18n` keys (27) resolve in both locales.

## Confirmed bugs

### VER-1 — Cleared description not saved (truthy fallback) — HIGH
Same as CR-2. `app.ts:1894-1899` uses `||`. Emptying description and saving silently keeps the old value while reporting success. Confirmed by reading code path: `updates.description = descriptionEl?.value || video.description`; `updateVideo` in youtube-api only adds `snippet.description` when `updates.description !== undefined` — it is always defined here, but with the wrong (old) value. Data-integrity bug.

### VER-2 — Tag JS-string injection — HIGH
Same as SEC-1. Verified `escapeHtml` (`app.ts:1238-1242`) does not escape `'`. Confirmed sink at `app.ts:522,1826`.

### VER-3 — `restoreTemporaryChanges` can lose category/language/privacy if metadata not yet loaded — MEDIUM (likely)
`restoreTemporaryChanges` (`app.ts:2014-2079`) sets `<select>.value` for category/language. The category/language `<option>`s are generated from `videoCategories`/`i18nLanguages` which are loaded asynchronously (`loadVideoMetadata`). In `authenticate()` flow the order is `loadVideoMetadata()` → `loadVideos()` → `restoreTemporaryChanges()` (app.ts:628-630), so options exist. But assigning a `value` to a `<select>` that lacks that `<option>` silently no-ops (value stays at default), so a restored category that isn't in the (possibly fallback) category list is dropped. Edge case; verify with a category id outside the fallback set when API metadata failed to load.
- Confidence: Medium.

### VER-4 — `hasCurrentChanges` ignores tags-but-counts-synthetic asymmetry vs `videoDiffersFromBaseline` — LOW
`hasCurrentChanges` (`app.ts:295-315`) reads live DOM and compares to saved values including synthetic media + tags. `videoDiffersFromBaseline` (1695-1705) compares stored objects. These are two separate "is it changed" implementations that must stay in sync; they currently diverge slightly (hasCurrentChanges does not compare `made_for_kids`/`license`/`embeddable`/`public_stats_viewable`, which is fine because the UI can't edit them, but it's an invariant worth documenting).
- Confidence: Medium.

### VER-5 — `getVideos` maxResults paging math can request 0 — LOW
`app.ts`→`youtube-api.ts:646`: `maxResults: Math.min(50, maxResults - videos.length)`. When `videos.length === maxResults` the loop condition `videos.length < maxResults` (line 747) already exits, so 0 is not requested. But if a page returns fewer items than requested and `nextPageToken` persists, the `Math.min` could compute a small positive value — fine. No bug, but the `continue` at line 677 when `videoIds.length===0` keeps `nextPageToken` and can loop on empty pages. Low risk (YouTube returns token only with items).
- Confidence: Low.

### VER-6 — `handleApiResponse` "retry" semantics throw on success path — MEDIUM (design smell, confirmed)
On 401, after a successful silent refresh, `handleApiResponse` (`youtube-api.ts:518`) `throw new Error('Token was refreshed. Please retry the request.')`. Callers (`getVideos`, `updateVideo`, etc.) call `await this.handleApiResponse(response)` and do NOT catch this to retry — the thrown error propagates up as a failure to the UI ("Failed to load videos: Token was refreshed..."). So a silent refresh during a request surfaces as an error to the user instead of transparently retrying. The user must manually re-trigger. Functional but poor UX and arguably a correctness bug (the operation fails even though auth recovered).
- Fix: implement an internal retry wrapper that, on the "Token was refreshed" signal, re-issues the original request once with the new token.
- Confidence: High that the throw propagates; Medium on severity.

### VER-7 — `made_for_kids` round-trip mismatch — MEDIUM (likely)
`getVideos` reads `made_for_kids` from `item.status.madeForKids` (`youtube-api.ts:729`), but `updateVideo` writes it to `status.selfDeclaredMadeForKids` (`youtube-api.ts:850`). The Data API returns `madeForKids` (the effective value) but only accepts `selfDeclaredMadeForKids` on write. On a video where YouTube computed `madeForKids=true` but the channel-level self-declaration differs, re-sending the read value as the self-declared value could flip the COPPA designation unexpectedly. Since the UI doesn't expose this field, every save re-sends whatever was read, potentially overwriting the creator's self-declaration with the effective value.
- Fix: do not send `selfDeclaredMadeForKids` unless the user explicitly changed it; or fetch the self-declared value (not available via Data API readback reliably). Safer to omit it from updates entirely when unchanged.
- Confidence: Medium (depends on API semantics; worth validating against live API).

## Sweep
- `formatDuration`/`parseDurationToSeconds` regex `PT(?:(\d+)H)?...` does not handle ISO 8601 days (`P#DT...`) — videos > 24h (livestream archives) mis-parse. LOW.
- `new Date(b.published_at).getTime()` in sort returns `NaN` for empty `published_at`; `NaN - NaN = NaN` so comparator returns NaN → unstable/implementation-defined order. Imported backups without `published_at` could sort erratically. LOW.
