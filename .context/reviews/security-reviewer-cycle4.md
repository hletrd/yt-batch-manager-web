# Security Review — yt-batch-manager-web (cycle 4)

OWASP-oriented re-review. Gates green at start. Cycle-1/2/3 security findings
re-verified; only NEW/residual reported.

## Re-verification (intact)
- DOM-XSS sinks: tag values via `data-*` + delegated handler (no inline-JS-string
  interpolation); imported id constrained to `^[A-Za-z0-9_-]{11}$`; thumbnail URLs
  passed through `sanitizeImageUrl`/`sanitizeThumbnailMap` (scheme allow-list);
  category/language option markup now escaped (C1). All CONFIRMED.
- OAuth: cryptographically-strong `state` (CSRF nonce) + PKCE S256; state validated on
  callback; no raw state/token echoed to UI; `client_secret` only sent to Google token
  endpoint over TLS. CONFIRMED.
- CSP meta present and tight (`index.html:6`): `default-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, scoped `connect-src` to googleapis/
  oauth2/accounts. `script-src 'unsafe-inline'` remains (required by the app's
  `onclick="app.*"` inline handlers + inline `<script>`); documented residual.
- Token storage in localStorage (A15) and `client_secret` in browser (A20): documented
  architectural residuals (backend-less static SPA + public OAuth client + PKCE).

## NEW findings
- None at security severity this cycle. The only NEW item with any security adjacency is
  the tag-input placeholder re-injection (`app.ts:1969`, cross-listed as code D2) — it is
  NOT exploitable: the placeholder string is sourced exclusively from the static i18n key
  `form.tagsPlaceholder`, which contains no HTML-significant characters and is not
  attacker-reachable. Classified INFO (defense-in-depth consistency only), not a security
  finding.

## Residual (re-confirmed, already documented in DEFERRED.md)
- A15 refresh token in localStorage — deliberate persistent-login product decision.
- A20 `client_secret` shipped to browser — public OAuth client; PKCE enforced.
- `script-src 'unsafe-inline'` — required by the inline-handler architecture (would need
  the A11 render refactor + CSP nonce/hashing to remove); documented residual, not new.

No new injection, auth/authz, SSRF, secret-leak, or unsafe-deserialization issues found.
