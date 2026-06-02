# Code Quality Review — yt-batch-manager-web

Files: `src/app.ts` (2094 lines), `src/youtube-api.ts` (1005), `src/i18n/renderer-i18n.ts` (179), `build-docs.js`, `src/index.html`.

## Findings

### CR-1 — Verbose/sensitive debug logging left in production — MEDIUM (confirmed)
`src/youtube-api.ts:98-106, 251-266, 538-542, 570-574` and many `console.log` throughout log auth internals, token lengths, and at line 253 the entire `localStorage` (`{...localStorage}`) which includes the raw access token. eslint `no-console` is intentionally `off`, but shipping this to a production static site is noise + token disclosure (overlaps SEC-5). 
- Fix: gate debug logs behind a `DEBUG` flag or remove. At minimum remove token-bearing logs.
- Confidence: High.

### CR-2 — `updateVideo` truthy-fallback drops legitimately empty fields — MEDIUM (confirmed)
`src/app.ts:1894-1899`:
```
title: titleEl?.value || video.title,
description: descriptionEl?.value || video.description,
...
defaultAudioLanguage: languageEl?.value || video.defaultAudioLanguage,
```
Uses `||`, so when the user intentionally clears the **description** to empty string, `'' || video.description` reverts to the old description — the cleared description is silently NOT saved. Same for title (though title has a UI counter, an empty title is plausible the user wants rejected by API anyway). `defaultAudioLanguage: languageEl?.value || video.defaultAudioLanguage` means selecting the "Auto" option (value `""`) cannot clear a previously-set language.
- Failure scenario: user empties a description and clicks Update; the update reports success but the description is unchanged on YouTube. Data-integrity / silent-no-op bug.
- Fix: read element values explicitly and only fall back when the element is missing (`titleEl ? titleEl.value : video.title`), not on empty string.
- Confidence: High.

### CR-3 — `updateTagsCounter` text/threshold inconsistent with rendered counter — LOW (confirmed)
Initial render shows `${(video.tags||[]).length}/500` (`src/app.ts:517`) but `updateTagsCounter` (line 1610-1617) sets `${tagCount} tags` — different format. Also the warning threshold `tagCount > 500` counts number of tags, whereas YouTube's real limit is ~500 characters total across tags, not 500 tags. The "/500" label is misleading either way.
- Fix: unify format and base the limit on total tag character count (YouTube enforces a 500-char aggregate). 
- Confidence: High (format inconsistency); Medium (semantic limit).

### CR-4 — `arraysEqual` is order-sensitive for tags — LOW
`src/app.ts:1691-1693` compares tag arrays positionally. Reordering tags marks the video changed, which is arguably fine, but combined with paste/dedupe it can produce surprising "changed" states. Acceptable; note for awareness.

### CR-5 — Duplicated no-credentials / logout-reset HTML blocks — LOW (maintainability)
The "No Credentials Found" block is inlined three times (`app.ts:362-374, 992-1004` with one lacking `data-i18n`, `1476-1481`, `1547-1552`). The `logout()` and `removeSavedCredentials()` bodies (lines 1445-1559) are near-identical. DRY violation; the 992-1004 copy is missing `data-i18n` attributes so it won't translate.
- Fix: extract helpers (`renderNoCredentials()`, `resetChannelHeader()`).
- Confidence: High (duplication + the missing-i18n inconsistency are confirmed).

### CR-6 — `any` types pervasive at API boundary — LOW
`getChannelInfo`, `getVideoCategories`, `getVideos` etc. return `Promise<any>` and iterate `item: any` (`youtube-api.ts:537,569,703-741`). Loses type safety on the YouTube response shape (e.g. `item.snippet.title` would throw if `snippet` missing). Define response interfaces.
- Confidence: High.

### CR-7 — `setTimeout(..., 10)` render hacks — LOW
`app.ts:548-558` schedules per-video DOM work 10ms after insertion to autosize textareas and run i18n. Fragile timing dependency; on slow devices or large pages this races. Prefer synchronous post-insert work or `requestAnimationFrame`. Also `app.ts:106-108` `setTimeout(updateAuthDependentButtons, 100)` and `app.ts:1008` are similar magic-delay patterns.
- Confidence: Medium.

### CR-8 — `package.json` missing `"type": "module"` — LOW (confirmed)
eslint emits `MODULE_TYPELESS_PACKAGE_JSON` warning because `eslint.config.js` uses ESM syntax but package.json has no `"type"`. Harmless today but a real warning on every lint run. Adding `"type": "module"` would also affect `build-docs.js` (uses CommonJS `require`) — so it must be renamed to `.cjs` or converted. Tradeoff; smallest fix is to live with the warning or rename the eslint config to `.mjs`.
- Confidence: High (warning reproduced).

## Sweep
- `formatNumber`/`parseInt` without radix in several places (`app.ts:117-119,149,1179`); `parseInt(x)` defaults to base 10 for these inputs but explicit radix is best practice. LOW.
- `loadFromFile`/`selectCredentialsFile` create a fresh `<input type=file>` each call but never remove it from any container (they are never appended, so GC reclaims them) — fine.
