# Plan 02 — Accessibility & i18n

Sources: A7, A8, A16, A33, A34, plus the i18n part of A26.

## Tasks

### [x] T1 — Set document language (A7, WCAG 3.1.1)
Add `lang="en"` to `<html>` in `src/index.html`, and set `document.documentElement.lang = rendererI18n.getCurrentLanguage()` after i18n init in `initializeApp`/`updatePageTexts`.
Acceptance: `<html lang>` present and updates to `ko` when Korean detected.

### [x] T2 — Translate dynamic labels & option text (A7/A26 i18n)
Add `data-i18n` to dynamically rendered labels (`Title`/`Description`/`Tags` at `app.ts:487,499,509`), privacy options, `Select Category` (1083), `Auto` (1111), `Published` text, and the `Short` badge (412). Add the new keys to BOTH `en.json` and `ko.json` (keep parity). Fix the missing `data-i18n` in the no-credentials block at `app.ts:992-1004`.
Acceptance: en/ko key parity preserved; Korean UI shows translated field labels; build green.

### [x] T3 — Announce status & loading to assistive tech (A8)
Add `role="status" aria-live="polite"` to `#status-message`. Add `aria-busy`/`role="status"` semantics to the loading overlay (or `aria-live` region). 
Acceptance: status text and loading state exposed to AT (verify via accessibility snapshot of the markup).

### [x] T4 — Short badge → CSS class with accessible contrast (A16)
Move the inline-styled `Short` badge to a `.short-badge` CSS rule in `index.html`, with a dark-mode variant, and choose a background/foreground meeting WCAG AA (≥4.5:1) for the 11px bold text (e.g. darker red `#c00` on white, or white text on `#cc0000` — verify ratio). 
Acceptance: computed contrast ≥4.5:1; no inline style on the badge.

### [x] T5 — Misc a11y polish (A33)
`aria-expanded` on burger menu toggled with state; add `@media (prefers-reduced-motion: reduce)` to disable overlay/transition animations; ensure dropdowns are keyboard-operable (Enter/Space + Escape already closes). 
Acceptance: burger reflects `aria-expanded`; reduced-motion respected.

### [D] T6 — Generated docs language (A34)
Deferred — see DEFERRED.md (A34). Decision: generated docs stay `lang="en"`; bilingual doc lang switching is low value. The main-app lang (A7) is fixed.

## Progress
T1–T5 implemented and committed (signed): d0e6b2e (a11y markup A8/A16/A33), dfa3852 (i18n A7/A26/A33-aria). T6 deferred (A34). tsc/eslint/build green; i18n parity 115/115; fixed a latent shadowed-key bug (video.views/saveChanges) while at it.
