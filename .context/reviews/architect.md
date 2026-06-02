# Architecture Review — yt-batch-manager-web

## Findings

### ARCH-1 — `YouTubeBatchManager` is a 2094-line god class — MEDIUM
`src/app.ts` holds DOM rendering, state, OAuth-flow orchestration, caching, i18n wiring, tag editing, import/export, and event wiring in one class. Cohesion is low; testability is near zero (everything depends on `document` + the singleton). 
- Recommendation: extract `VideoRenderer` (DOM/template), `VideoStore` (state + indexing + diffing), `CacheService` (localStorage cache), and keep `YouTubeBatchManager` as a thin controller. This also enables unit tests (see test-engineer review).
- Confidence: High (structural fact).

### ARCH-2 — HTML built via string concatenation + `innerHTML` everywhere — MEDIUM
Rendering uses template-literal HTML + `insertAdjacentHTML`/`innerHTML` with inline `on*` handlers referencing a global `window.app`. This couples markup to a global singleton, makes escaping error-prone (root cause of SEC-1), and prevents CSP hardening (SEC-2). 
- Recommendation: build nodes with `document.createElement` + `addEventListener`, or adopt a tiny templating helper that auto-escapes. Removes the inline-handler/global-app coupling and the XSS sink class.
- Confidence: High.

### ARCH-3 — Two parallel "changed?" computations — LOW/MEDIUM
`hasCurrentChanges` (DOM-based) and `videoDiffersFromBaseline` (object-based) plus `arraysEqual` implement diffing in two places that must agree (see VER-4). Centralize into the proposed `VideoStore`.
- Confidence: Medium.

### ARCH-4 — Duplicated `VideoData`/`ThumbnailData` interfaces — LOW (confirmed)
`VideoData` and `ThumbnailData` are declared in BOTH `src/app.ts:4-40` and `src/youtube-api.ts:21-52`, and they have already drifted: `app.ts` adds `processing_progress` which `youtube-api.ts` lacks. Two sources of truth for the core domain type.
- Fix: a shared `types.ts` imported by both. (tsconfig `isolatedModules` is on, so a type-only module is fine.)
- Confidence: High (drift confirmed).

### ARCH-5 — Auth retry/refresh control flow communicates via thrown sentinel strings — MEDIUM
`handleApiResponse` signals "retry" and "re-auth triggered" by throwing `Error` objects whose `.message` is string-matched by callers (`youtube-api.ts:504,518,528,532` and `app.ts` checks `error.includes('Redirecting')`). String-matched control flow is brittle (a translation or message tweak breaks it) and is the root of VER-6 (silent refresh surfaces as a user error).
- Recommendation: model auth outcomes as a typed result/enum and implement a real request-retry wrapper.
- Confidence: High.

### ARCH-6 — No build-time guard that i18n keys used in code exist in JSON — LOW
i18n correctness is currently maintained by hand (verified at parity this cycle). A drift would only surface at runtime as `console.warn` + raw key shown to the user. A tiny build check (the same script used in this review) would catch it in CI.
- Confidence: Medium.

## Sweep
- `build-docs.js` is CommonJS while the rest is ESM (CR-8 tension). Keep it `.cjs` if package becomes `"type":"module"`.
- The `dist/` directory is committed/tracked? `.gitignore` lists `dist` — good, build output is not tracked.
- No abstraction over `localStorage` keys: keys are string literals scattered (`youtube_access_token`, `oauth_state`, `yt_video_cache`, `yt_temp_form_changes`, `theme`). `deleteCache`/`removeSavedCredentials` hardcode subsets of these and can drift (e.g. they remove `oauth_state` but not `oauth_code_verifier`). LOW but a real consistency bug: `clearStoredToken` removes `oauth_code_verifier` but `deleteCache`/`removeSavedCredentials` do not.
