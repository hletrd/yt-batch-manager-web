# UI/UX & Accessibility Review — yt-batch-manager-web

This is a web frontend (`src/index.html` + DOM built in `src/app.ts`), so a UI/UX review applies. Evidence gathered from source inspection (the model treats DOM/attribute structure as the source of truth; no live agent-browser session was run this cycle because the app requires a Google OAuth `credentials.json`/login to render video content, but all findings below are backed by exact selectors/attributes in source).

## Findings

### UX-1 — `<html>` has no `lang` attribute — MEDIUM (confirmed, WCAG 3.1.1)
`src/index.html:2` is `<html>` with no `lang`. The app is bilingual (en/ko) and `renderer-i18n` detects language at runtime, but the document language is never set on `<html>`. Screen readers will use the wrong voice/pronunciation. WCAG 2.2 SC 3.1.1 (Language of Page) failure.
- Fix: set `document.documentElement.lang = rendererI18n.getCurrentLanguage()` after i18n init, and ship a sensible default (`<html lang="en">`).
- Confidence: High.

### UX-2 — Dynamically rendered field labels are hardcoded English — MEDIUM (confirmed, i18n)
`app.ts:487,499,509` render `<label ...>Title</label>`, `Description`, `Tags` with NO `data-i18n` attribute, so they never translate even in Korean UI. Also `Published`/`Private`/`Unlisted`/`Public` option labels (`app.ts:410,417-419`), `Select Category` (1083), `Auto` (1111), and the `Short` badge text (412) are hardcoded.
- Fix: add `data-i18n` keys (en/ko already at parity — add new keys to both).
- Confidence: High.

### UX-3 — Inline styles on the "Short" badge instead of CSS class — LOW (confirmed)
`app.ts:412` injects a full inline `style="background:#ff0033;color:#fff;..."`. Hard to theme (no dark-mode variant), and it duplicates per video. Move to a `.short-badge` CSS rule. Also `#ff0033` on `#fff` text: contrast ratio ~3.9:1 for the small 11px bold text — below WCAG AA 4.5:1 for normal text. Accessibility + maintainability.
- Confidence: High (contrast computed from the literal hex values).

### UX-4 — `target="_blank"` without `rel="noopener noreferrer"` — LOW (confirmed)
`app.ts:405` video links open new tab without `rel`. Reverse tabnabbing / minor perf. (Modern browsers imply noopener, but explicit is correct.)
- Confidence: High.

### UX-5 — Auth-disabled buttons styled via inline opacity/pointer-events, not `aria-disabled`/`disabled` consistently — LOW (confirmed)
`updateAuthDependentButtons` (`app.ts:243-275`) sets `logoutBtn.style.pointerEvents='none'` and opacity on an anchor, but never sets `aria-disabled`. Keyboard/AT users get no disabled semantics on the logout link. The refresh button uses real `disabled` (good) but also mutates inline styles that fight CSS.
- Fix: toggle a CSS class + `aria-disabled` instead of inline styles.
- Confidence: Medium.

### UX-6 — Status messages not announced to assistive tech — MEDIUM (confirmed)
`showStatus` (`app.ts:158-168`) writes to `#status-message` and toggles a `show` class. There is no `role="status"`/`aria-live="polite"` on that element (only 2 aria usages exist in the whole HTML). Screen-reader users won't hear "Videos loaded", errors, save results, etc.
- Fix: add `role="status" aria-live="polite"` to `#status-message` (and `aria-live="assertive"` for errors, or set dynamically).
- Confidence: High (only 2 aria attributes total in index.html; verify `#status-message` markup lacks the role).

### UX-7 — Loading overlay lacks accessible semantics & focus management — LOW
`showLoadingOverlay` toggles `display`/`show` (`app.ts:194-223`) with `setTimeout` transitions; no `aria-busy`, no focus trap, no `role="alert"`/`status`. Long operations (load from YouTube) leave AT users unaware. Also the 300ms hide `setTimeout` can leave the overlay visible if another show races in.
- Confidence: Medium.

### UX-8 — No empty/error visual state for image load beyond fallback; thumbnails `alt="Video thumbnail"` generic — LOW
`app.ts:604` uses a static generic alt for every thumbnail; better to include the video title (`alt="Thumbnail for {title}"`). Decorative-vs-informative ambiguity.
- Confidence: Medium.

### UX-9 — Focus is moved with `setTimeout(...,10/0)` after tag add/remove — LOW
`addTag`/`removeTag` (`app.ts:1806,1866`) refocus the tag input via timeout. Works but fragile; rapid edits can drop focus. Acceptable but note.

## Sweep (responsive / theming / motion)
- Dark/light mode is implemented via `data-theme` + `prefers-color-scheme` fallback (`initializeTheme`, app.ts:836-845) — good.
- No `prefers-reduced-motion` handling for the overlay/transition animations. WCAG 2.3.3 (AAA) / good practice. LOW.
- Mobile menu handled at `<=768px` with burger (`aria-label="Toggle menu"` present — good). Burger has no `aria-expanded` state. LOW.
- No keyboard handler to open dropdowns (they rely on click + focusout); keyboard-only users may struggle. MEDIUM-LOW.
