# Security Review — yt-batch-manager-web

Scope: client-side TypeScript SPA (no backend). Files reviewed: `src/app.ts`, `src/youtube-api.ts`, `src/i18n/renderer-i18n.ts`, `src/index.html`, `build-docs.js`, `.github/workflows/deploy.yml`, `PRIVACY.md`, `TERMS.md`, `README.md`.

Threat model: OAuth tokens live in `localStorage`; the app injects user-controlled and YouTube-controlled data into the DOM via `innerHTML`/`insertAdjacentHTML`; the OAuth `client_secret` is shipped to the browser in `credentials.json`.

## Findings

### SEC-1 — JS-string-context injection in tag remove button (XSS) — HIGH (confirmed)
`src/app.ts:522` and `src/app.ts:1826`:
```
onclick="app.removeTag('${video.id}', '${this.escapeHtml(tag)}')"
```
`escapeHtml()` (line 1238) uses `div.textContent`→`innerHTML`, which encodes `<`, `>`, `&`, `"` but does NOT encode the single quote `'` or backslash. The tag value is interpolated inside a single-quoted JavaScript string literal inside an HTML attribute. A tag containing a `'` (e.g. `a');app.logout();//`) breaks out of the string-literal context and injects arbitrary JS into the inline `onclick` handler.
- Failure scenario: a user imports a backup JSON (or types/pastes) a tag value `x');alert(document.cookie);('`. When the tag chip renders, clicking ✕ — or simply having the handler attribute parsed — executes attacker-controlled script with full access to `localStorage` (the OAuth access + refresh tokens). Tags are also fetched from the YouTube API, so a tag set on a video via another tool can carry an apostrophe; while ordinary apostrophes are common and benign, the same code path enables deliberate injection.
- Fix: stop building inline `onclick` with interpolated data. Either (a) attach listeners programmatically (`addEventListener`) using `dataset` attributes for the tag value, or (b) at minimum apply a JS-string-safe encoding (escape `\`, `'`, `"`, newlines) in addition to HTML escaping. Preferred: event delegation on the tags container reading `data-tag` from the chip. Same pattern should be audited for `video.id` (YouTube IDs are `[A-Za-z0-9_-]{11}` so currently safe, but relying on that is fragile).
- Confidence: High that the injection vector exists; Medium that a realistic attacker path is fully self-service (user injecting into their own session) vs. cross-user — but it is still a genuine DOM-XSS sink and data-loss/account-action risk.

### SEC-2 — No Content-Security-Policy — MEDIUM (confirmed)
`src/index.html` head (lines 1-5) contains only charset + viewport meta. There is no CSP `<meta http-equiv="Content-Security-Policy">`. GitHub Pages cannot send CSP response headers, so a meta CSP is the only available control. Given the heavy use of `innerHTML` and inline event handlers, a CSP would be hard to make strict (inline handlers require `unsafe-inline`), but a CSP restricting `connect-src`, `img-src`, `frame-ancestors 'none'`, and `base-uri 'self'` would materially reduce token-exfiltration and clickjacking surface and is a defense-in-depth layer against SEC-1.
- Fix: add a meta CSP. At minimum `frame-ancestors 'none'` (clickjacking), `base-uri 'self'`, `object-src 'none'`, `connect-src 'self' https://*.googleapis.com https://oauth2.googleapis.com https://accounts.google.com`, `img-src 'self' data: https:`. Inline handler refactor (SEC-1) is a prerequisite for removing `unsafe-inline`.
- Confidence: High (absence confirmed); the value depends on refactoring inline handlers.

### SEC-3 — OAuth tokens stored in localStorage — MEDIUM (confirmed, partly inherent)
`src/youtube-api.ts:136,146` store `youtube_access_token` and `youtube_refresh_token` in `localStorage`. `localStorage` is readable by any script running on the origin, so any XSS (see SEC-1) yields long-lived refresh tokens. The refresh token is especially sensitive because it survives access-token expiry and grants `youtube.force-ssl` (read/modify all the user's videos).
- This is partly inherent to a static-hosted SPA with no backend. The mitigation is to eliminate XSS sinks (SEC-1) and add CSP (SEC-2). Documented tradeoff acceptable, but the refresh-token-in-localStorage decision should be explicitly recorded.
- Confidence: High.

### SEC-4 — `client_secret` shipped to the browser — LOW (known/by-design, but verify)
`src/youtube-api.ts:189-196,430-432,961-963` read `client_secret` from `credentials.json` (written from a GH secret at deploy time, `deploy.yml`) and send it to the Google token endpoint. The code comments (lines 308-311) correctly note that a public client_secret for a "Web application" client is not independently exploitable when PKCE is enforced AND Google validates the registered redirect URIs. This is acceptable for this architecture, but it relies on the OAuth client's authorized redirect URIs being locked to the deployed origin. 
- Fix/Action: ensure (and document) that the Google Cloud OAuth client restricts redirect URIs and JS origins to the canonical Pages domain; otherwise the shipped secret + an attacker-controlled redirect could enable token theft. Consider migrating to a "Desktop/Installed" or PKCE-public client type that has no secret.
- Confidence: Medium (depends on external GCP config not visible in repo).

### SEC-5 — `state`/error messages leak into UI and history — LOW
`src/youtube-api.ts:281` returns an error containing `Expected: ${storedState}, Got: ${state}`, surfaced via `showStatus`. Low sensitivity (CSRF state is single-use), but echoing it is unnecessary. Also extensive `console.log` of `localStorage` contents including `All localStorage items` (`src/youtube-api.ts:253`) dumps the access token to the console in production — token disclosure via shared screen / browser extension reading console. MEDIUM for the console token dump.
- Fix: remove the `console.log('All localStorage items', {...localStorage})` and other token-bearing logs (see also code-reviewer CR-1). Downgrade the state value from user-facing error text.
- Confidence: High for the console token dump (line 253 logs the full token).

### SEC-6 — `importVideoData` trusts arbitrary JSON shape — LOW
`src/app.ts:1401-1443` validates only `id`, `title` presence/type. Other fields (description, tags array contents, privacy_status, category_id) are taken verbatim and later sent to YouTube and rendered. Combined with SEC-1, a malicious backup file is an injection delivery vector. Field-level validation/sanitization recommended.
- Confidence: Medium.

## Sweep for commonly-missed issues
- `target="_blank"` links (`src/app.ts:405`) lack `rel="noopener noreferrer"` — reverse-tabnabbing. LOW. Modern browsers imply `noopener` for `target=_blank`, but explicit is better; the build minifier may also strip it.
- `Math.random()` used for OAuth `state` (`generateRandomString`, line 340-347) — not cryptographically strong. The PKCE verifier correctly uses `crypto.getRandomValues`, but `state` (CSRF token) should too. LOW/MEDIUM.
- No `autocomplete="off"` considerations; not applicable (no password fields).
