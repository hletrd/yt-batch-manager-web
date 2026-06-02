# Security Review — yt-batch-manager-web (cycle 2)

Scope: re-review after cycle-1 fixes (A1–A34). This pass focuses on NEW / residual
security findings only; already-fixed items (tag-value XSS sink A1, CSP A6, crypto
state A9, token-log removal A3, import field coercion A19, transparent 401 A4) were
re-verified as still present/correct and are NOT re-reported.

Inventory reviewed: `src/app.ts`, `src/youtube-api.ts`, `src/types.ts`,
`src/i18n/renderer-i18n.ts`, `src/index.html`, `build-docs.js`, i18n JSON.

## Findings

### S1 — DOM-XSS via unsanitized `video.id` interpolated into inline JS-string handlers (HIGH, High)
Citation: `src/app.ts:405,412,417,423,483,493,499,507,519-522,528` (renderVideos) and
`src/app.ts:1905-1908` (renderTagsContainer). Each interpolates `'${video.id}'` /
`'${videoId}'` into a single-quoted JavaScript string inside an inline `on*` handler,
e.g. `onchange="app.handlePrivacyChange('${video.id}')"`.

Cycle 1 (A1) fixed the *tag value* sink by moving to `data-*` + delegation, and added
field coercion in `importVideoData` (A19/T7) — but that coercion explicitly does NOT
sanitize the `id` field. `importVideoData` (`app.ts:1460-1469`) spreads `...video` and
re-coerces title/description/privacy/category/tags/lang/synthetic, leaving `id`
verbatim. The only `id` check is truthiness (`importVideoData` line 1446:
`video && video.id && video.title`).

Failure scenario: a user loads a malicious backup JSON containing
`"id": "x'); alert(document.cookie); ('"`. When `renderVideos` builds the markup,
the inline handler becomes `onchange="app.handlePrivacyChange('x'); alert(document.cookie); ('')"`,
which executes attacker JS in the app origin — with access to the OAuth access/refresh
tokens in `localStorage`. This is the same class of bug A1 fixed for tags, just via a
different (un-coerced) field. The "Load from File" feature is a first-class workflow
(README advertises it), so the delivery vector is realistic (shared/downloaded backup).

Fix (defense-in-depth, two layers):
- In `importVideoData`, validate `id` against a strict charset (YouTube video IDs are
  `[A-Za-z0-9_-]{11}`); reject/skip records whose id does not match.
- Preferably also stop interpolating ids into inline JS strings: move the remaining
  `app.*('${video.id}')` handlers to `data-video-id` + delegated listeners (the pattern
  already used for `.tag-remove`). At minimum, escape the id for a JS-string context.
Confidence: High (verified by tracing import → render).

### S2 — DOM-XSS via unsanitized thumbnail URLs in `src`/`srcset` attributes (MEDIUM, Medium)
Citation: `src/app.ts:591-600` (`generateResponsiveImageHtml`). `fallbackUrl`
(`video.thumbnail_url`) and each `thumb.url` are interpolated raw into double-quoted
`src="..."` / `srcset="..."` attributes with no attribute-escaping.

For YouTube-fetched data these are googleusercontent URLs and safe. But `importVideoData`
does NOT validate `thumbnail_url` or `thumbnails[*].url` (the import coercion at
`app.ts:1460-1469` omits both). A backup with
`"thumbnail_url": "x\" onerror=\"alert(1)\" data-x=\""` breaks out of the `src`
attribute and injects an event handler.

Note: CSP (`script-src 'self' 'unsafe-inline'`) currently *permits* inline event
handlers, so injected `onerror`/`onload` would execute. Fix: attribute-escape both URLs
via the existing `escapeHtmlAttribute`, and coerce/drop non-string URL fields in
`importVideoData` (also re-validate the URL scheme is http/https/data). Confidence:
Medium (requires malicious import; same vector as S1).

### S3 — Residual: `client_secret` shipped to browser (LOW, Medium) — STILL TRUE, already deferred
Citation: `src/youtube-api.ts:149,153,367-369,864-866`. Unchanged from cycle-1 A20.
PKCE is enforced; inherent to the public-client architecture. Recorded in
`plan/DEFERRED.md` (A20). No new action.

### S4 — Refresh token in localStorage (LOW, High) — STILL TRUE, already deferred
Citation: `src/youtube-api.ts:105,118`. Unchanged residual (A15). Closing S1/S2 is what
keeps this residual acceptable; flagged to link the dependency.

## Sweep (no issue, recorded for provenance)
- OAuth state compared against stored state (`youtube-api.ts:207,841`); PKCE verifier
  used; `prompt=consent` for refresh token — all correct.
- `connect-src` CSP correctly scoped to googleapis/oauth2/accounts.
- No secrets logged after A3.
