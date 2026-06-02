# Plan 01 — Security & Data-Correctness (HIGH priority, non-deferrable)

Sources: A1, A2, A3, A4, A5, A6, A9, A19 in `_aggregate.md`. Security/correctness/data-loss findings are NOT deferrable per repo rules.

## Tasks

### [x] T1 — Fix DOM-XSS in tag remove button (A1, HIGH)
Problem: `app.ts:522` and `app.ts:1826` interpolate `${this.escapeHtml(tag)}` into a single-quoted JS string inside inline `onclick`. `escapeHtml` does not escape `'`/`\`, so a tag with `'` breaks out and injects JS.
Fix (chosen, minimal & robust): remove the inline `onclick` arg for the tag value. Use event delegation / `data-tag` attribute:
- Render the remove button with the tag in an HTML-escaped `data-tag` attribute and no JS-string interpolation.
- Attach a delegated click handler on the tags container that reads `data-tag`/`data-video-id` and calls `removeTag`.
Acceptance: a tag literally equal to `x'); alert(1); ('` can be added/removed with no script execution; tsc+eslint+build green.

### [x] T2 — Fix cleared-description silent revert (A2, HIGH)
Problem: `app.ts:1894-1899` uses `||`, so an emptied description/title reverts to old value and "Auto" language cannot clear a set language.
Fix: read element values explicitly; fall back to the stored value only when the element is absent (not when empty): `title: titleEl ? titleEl.value : video.title`, etc. For `defaultAudioLanguage`, allow empty string to clear.
Acceptance: emptying a description and saving sends the empty description; "Auto" clears the language. tsc/build green.

### [x] T3 — Remove sensitive/verbose debug logging (A3, MEDIUM)
Problem: `youtube-api.ts:253` logs `{...localStorage}` (full access token); many `console.log` dump auth internals/token lengths.
Fix: delete the `All localStorage items` log and other token-bearing logs; keep only non-sensitive `console.warn`/`console.error`.
Acceptance: grep shows no `{...localStorage}` and no token-value/length logging; eslint green.

### [x] T4 — Transparent retry after silent 401 refresh (A4, MEDIUM)
Problem: `handleApiResponse` throws "Token was refreshed. Please retry" but no caller retries → user sees a failure.
Fix: introduce a private `authedFetch(url, init)` wrapper that issues the request, and on 401 attempts a silent refresh then re-issues ONCE with the new token before giving up. Route all read/update calls through it. Behavior unchanged when refresh fails (clear + re-auth via existing `handleApiResponse`).
Acceptance: a 401 followed by a successful refresh results in the original request succeeding without a user-visible error. build green.

### [x] T5 — Don't clobber made-for-kids on every save (A5, MEDIUM)
Problem: read `madeForKids`, write `selfDeclaredMadeForKids` unconditionally → can flip COPPA designation.
Fix: stop round-tripping `made_for_kids`; omit `selfDeclaredMadeForKids` from the update body (UI does not expose it). Omitting it leaves the prior self-declaration intact.
Acceptance: update body no longer contains `selfDeclaredMadeForKids`. build green.

### [x] T6 — Use crypto RNG for OAuth state (A9, MEDIUM)
Problem: `generateRandomString` uses `Math.random()` for the CSRF `state`.
Fix: generate `state` bytes via `crypto.getRandomValues` mapped onto the charset.
Acceptance: no `Math.random` in the auth path. build green.

### [x] T7 — Validate imported video data fields (A19, LOW, injection-adjacent → here)
Problem: `importVideoData` validates only id/title.
Fix: per-field coercion: `tags` → array of strings, `privacy_status` → known values (default private), `category_id`/`title`/`description` → string, `contains_synthetic_media` → boolean. Drop unknown fields. Defense-in-depth alongside T1.
Acceptance: importing JSON with a non-string tag or object description neither crashes nor injects; build green.

### [x] T8 — Add a defense-in-depth meta CSP (A6, MEDIUM)
Problem: no CSP; heavy `innerHTML`+inline handlers. A strict CSP that drops `unsafe-inline` requires the large inline-handler refactor (deferred, Plan 04 T5), but a meaningful CSP can ship now.
Fix: add `<meta http-equiv="Content-Security-Policy">` to `index.html` allowing current inline handlers (`script-src 'self' 'unsafe-inline'`) but restricting the high-value directives:
`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com; form-action https://accounts.google.com 'self'`.
Verify the OAuth redirect to accounts.google.com (a top-level navigation, not subject to connect-src) still works and the token fetch/connect endpoints are allowed.
Acceptance: CSP meta present; app still loads videos, authenticates, and refreshes tokens (reasoned against directives; build green). Full removal of `unsafe-inline` tracked as exit criterion of Plan 04 T5.

## Progress
All tasks T1–T8 implemented and committed (signed). Commits: 221de3a (auth: A3/A4/A5/A9), c090066 (editor: A1/A2/A5/A19/A7-lang), 9e08ac9 (CSP: A6/A7). tsc + eslint + build green after changes.
