# Security Review — cycle 5

Scope: new feature code since cycle 4. Baseline gates green.

## No new security findings (HIGH/MEDIUM)

The new feature surface was reviewed for injection, unsafe sinks, and untrusted-input
handling:

- Recording location handlers: `viewLocationOnMap` (`app.ts:1921`) builds a Google Maps
  URL with `encodeURIComponent(lat)`/`encodeURIComponent(lng)` and opens it with
  `window.open(..., '_blank', 'noopener')`. Inputs are `type="number"` with min/max and
  are URL-encoded — no injection. OK.
- `useCurrentLocation` writes `pos.coords.*.toFixed(6)` into number inputs — no sink. OK.
- Category/language option generators (`generateCategoryOptions:1184`,
  `generateLanguageOptions:1215`) escape API-sourced id/title via
  `escapeHtmlAttribute`/`escapeHtml` (C1 hygiene from cycle 3 extended to the new
  language/license selects). Verified the new `default-language` and `license` selects
  reuse the same escaped generators / static option markup. OK.
- `recording-date` input value is wrapped in `escapeHtmlAttribute` (`app.ts:460`). OK.
- Latitude/longitude `value="${typeof video.latitude === 'number' ? video.latitude : ''}"`
  (`app.ts:464-465`): interpolates only a JS number or empty string into the attribute —
  a number's string form cannot contain HTML-significant chars, so no escaping needed and
  no breakout. OK.
- Import sanitization (`importVideoData:1582`) constrains id to `[A-Za-z0-9_-]{11}`,
  coerces text fields, constrains privacy, and runs thumbnail URLs through
  `sanitizeImageUrl`/`sanitizeThumbnailMap` (rejecting `javascript:` etc.). The newly
  imported optional fields (recording_date, lat, lng, license, default_language,
  made_for_kids, embeddable, public_stats_viewable) are type-checked and `null`→`undefined`
  normalized. No new untrusted value reaches a dangerous sink unescaped. OK.
- API error stripping (`youtube-api.ts:stripHtml:760`) removes tags and decodes a fixed
  entity set; the result is shown via `textContent` (`showStatus:162`), so even if a tag
  slipped through it would not execute. Defense-in-depth, fine. OK.
- CSP (`index.html:6`): `connect-src` scoped to googleapis/oauth2/accounts;
  `form-action` allows the OAuth redirect; `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'self'`. `script-src 'unsafe-inline'` remains required by the inline-handler
  architecture (documented residual). No regression.

## Note on E1 (cross-listed from code-reviewer)
E1 is a **data-integrity** bug (silent deletion of the user's recordingDate on YouTube),
not an attacker-exploitable security hole, but it IS data loss. Under the deferred-fix
rules data-loss findings are not deferrable; scheduled for implementation.

## Residual security posture (unchanged, already deferred/documented)
A15 refresh token in localStorage; A20 client_secret shipped to browser (PKCE enforced).
No change this cycle.
