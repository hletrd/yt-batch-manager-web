# Security Review — yt-batch-manager-web (cycle 3)

Scope: full re-review of `src/app.ts`, `src/youtube-api.ts`, `src/types.ts`,
`src/i18n/renderer-i18n.ts`, `src/index.html`, `build-docs.js`. Cycle-1 (A*) and
cycle-2 (B*) findings were re-verified as fixed or deferred and are NOT re-reported.

Baseline gates (whole repo) at cycle-3 start: `eslint "src/**/*.ts"` = 0/0;
`tsc -p tsconfig.json --noEmit` = 0; `npm run build` = success; i18n parity en=117/ko=117.

## Re-verification of prior security fixes (all intact)
- A1/B1 video-id DOM-XSS: `importVideoData` enforces `/^[A-Za-z0-9_-]{11}$/`; ids are
  safe to interpolate into inline handlers. CONFIRMED (`app.ts:1496-1500`).
- B2 thumbnail URL: `sanitizeImageUrl` + `escapeHtmlAttribute` on src/srcset; import
  drops non-http(s)/data: URLs. CONFIRMED (`app.ts:573-609,1302-1325,1525-1526`).
- A6 CSP meta present and reasonable. CONFIRMED (`index.html:6`).
- OAuth: crypto state + PKCE S256, state validated, no token/secret logging of values
  (only booleans/lengths/error reasons). CONFIRMED (`youtube-api.ts:184-303,880-950`).
- Tag values read from `data-*` via delegation, not inline handlers. CONFIRMED.

## NEW finding

### S-C3-1 (LOW/Medium) — Unescaped category/language option markup
- Citation: `app.ts:1099-1104` (`generateCategoryOptions`), `app.ts:1127-1132`
  (`generateLanguageOptions`). `category.id`, `category.title`, `language.id`,
  `language.name` are interpolated raw into `<option value="...">...text...</option>`.
- Source of the data: YouTube Data API `videoCategories.list` / `i18nLanguages.list`
  responses (or the hardcoded English fallback). These are Google-controlled strings,
  so practical XSS via these endpoints is LOW likelihood — but this is the ONLY
  remaining raw HTML interpolation of API string data in the render path that lacks the
  `escapeHtml`/`escapeHtmlAttribute` hygiene applied everywhere else (titles, tags,
  thumbnails). It is both a defense-in-depth gap (a compromised/spoofed response, or a
  future locale with `&`/`<` in a name) and a correctness bug: a title/name containing
  `&`, `<`, `>`, or `"` would render incorrectly or break the option.
- Failure scenario: a category/language title containing `"` breaks the `value`
  attribute; one containing `<` corrupts the option list. With a hostile response it
  could inject markup into the same origin.
- Fix: wrap `category.id`/`language.id` (the `value`) with `escapeHtmlAttribute(...)`
  and `category.title`/`language.name` (option text) with `escapeHtml(...)`, matching
  the hygiene already used for the category/language *placeholder* options on the same
  lines (which already call `escapeHtml(rendererI18n.t(...))`).
- Confidence: High that it is unescaped; Medium that it is worth fixing (low real-world
  XSS, real correctness/defense-in-depth value, trivial + consistent fix).

## Confirmed non-issues / residual (no change)
- A20 client_secret in browser, A15 refresh token in localStorage: deferred residuals,
  unchanged, still acceptable per repo product intent (DEFERRED.md). XSS sinks that made
  them risky are closed.
- `made_for_kids` read but never written: intentional (DEFERRED.md B15); the
  `getVideoStatus` merge backfills it only to avoid a wipe, and `updateVideo`
  deliberately omits `selfDeclaredMadeForKids` to avoid flipping COPPA. Correct.
