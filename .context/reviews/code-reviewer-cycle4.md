# Code Review — yt-batch-manager-web (cycle 4)

Full re-review of `src/app.ts`, `src/youtube-api.ts`, `src/types.ts`,
`src/i18n/renderer-i18n.ts`, and `build-docs.js`. Cycle-1/2/3 findings re-verified;
only genuinely NEW or residual items reported here. Baseline gates green at start
(eslint 0 errors/0 warnings, tsc 0 errors, `npm run build` success, i18n parity
en=117/ko=117).

## Re-verification (all intact)
- C1 (option-markup escaping) FIXED: `generateCategoryOptions` (`app.ts:1104-1107`) and
  `generateLanguageOptions` (`app.ts:1135-1138`) now wrap `id` with
  `escapeHtmlAttribute` and the text with `escapeHtml`. Confirmed.
- A1 DOM-XSS tag-remove FIXED: tag-remove uses `data-video-id`/`data-tag` +
  delegated click handler (`app.ts:863-871`, `:513`, `:1956`); no inline-JS-string
  interpolation of the tag value. Confirmed.
- B1/B2 import sanitization FIXED: `importVideoData` validates the 11-char id charset
  (`:1503`), coerces fields, constrains `privacy_status`, and sanitizes thumbnail URLs
  (`:1520-1534`). Confirmed.
- A2 cleared-description revert FIXED (`:2046-2052` reads live element values).
- Status round-trip on update FIXED (`youtube-api.ts:716-749`, `app.ts:2030-2040`).
- Token-refresh transparent retry, crypto state, PKCE all intact (`youtube-api.ts`).

## NEW findings

### D1 (LOW) — `saveInProgress` is dead state (declared, never used)
`app.ts:50` declares `private saveInProgress: Set<string> = new Set();`. A repo-wide
grep shows it is NEVER read or written — there is no `saveInProgress.add/delete/has`
anywhere. The only other token "saveInProgress" in the file is the unrelated i18n key
`status.saveInProgress` (`:1341`) and the live batch flag is the separate field
`batchSaveInProgress`. The field has existed unused since the initial commit
(`git log -S saveInProgress` → only `init`). This is dead instance state: it adds a
misleading "looks like there is a per-video save guard" signal where there is none
(single-video re-entrancy is in fact bounded only by `updateBtn.disabled` at
`:2012`/`:2101`). Distinct from B16 (`batchUpdateVideos` dead method) and A26 (DRY
no-credentials blocks). Fix: delete the field. No behavior change; gates stay green.
Confidence: High (unused) / Medium (worth fixing as hygiene).

### D2 (INFO) — `renderTagsContainer` re-injects the tag-input placeholder raw
`app.ts:1969` builds the rebuilt tag input with `placeholder="${placeholder}"` where
`placeholder` is `tagInput?.placeholder || rendererI18n.t('form.tagsPlaceholder')`
(`:1961`). Unlike the option-markup path (C1, just fixed) this value is NOT passed
through `escapeHtmlAttribute`. In practice the only source of this string is the i18n
value `form.tagsPlaceholder` (en `"Add tags (comma-separated)"`, ko
`"쉼표로 구분해서 입력하세요"`) — neither contains a `"`/`<`/`>`/`&`, and there is no
path by which attacker-controlled data reaches it. So there is no practical XSS or
markup-break today; this is a pure defense-in-depth/consistency note. Recommend wrapping
with `escapeHtmlAttribute` to match the hygiene now applied everywhere else in the render
path, OR leaving as-is given zero attacker reachability. Confidence: High (unescaped) /
Low (impact). NOT a security/correctness finding.

## Non-issues confirmed
- `escapeHtml` (div.textContent→innerHTML) and `escapeHtmlAttribute` are correct.
- `parseIsoDuration` handles the days (D) component; sort NaN-guard (`publishedTime`)
  correct; `arraysEqual`/`videoDiffersFromBaseline` correct.
- `updateVideo` reads live element values (no cleared-field revert); status round-trip
  intact; `getVideoStatus` backfill guarded.
