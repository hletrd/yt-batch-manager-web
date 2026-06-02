# Designer / UI-UX Review — yt-batch-manager-web (cycle 2)

UI/UX present (web frontend). NEW / residual only. Cycle-1 a11y fixes (lang, aria-live
status/loading, short-badge contrast, reduced-motion, aria-expanded burger) re-verified
in `src/index.html` and `app.ts`.

Method note: the review model is treated as non-multimodal; findings are backed by
text-extractable evidence (selectors, hex colors, computed CSS) read directly from
`src/index.html` and the render code. A live agent-browser pass is not run because the
app requires real Google OAuth credentials (`credentials.json`) which are not available
in this environment, so the authenticated video-grid cannot be exercised; the
pre-auth/no-credentials states and static markup were reviewed from source.

## Findings

### D1 — `<html lang>` is statically `en` and only updated at runtime by JS (LOW, Medium)
Citation: `src/index.html:2` (`<html lang="en">`); `src/app.ts:933` sets
`document.documentElement.lang` after i18n init. For a Korean browser the initial paint
and any no-JS/slow-JS window expose `lang="en"` while Korean text may render. Minor;
acceptable for an SPA. Confidence: Medium.

### D2 — Sort-order label not localized + hardcoded English (MEDIUM-for-i18n, High)
Citation: `src/app.ts:1170-1178` (mirrors code-review C5). `#current-sort` is set to
English strings ("Latest First", etc.) regardless of UI language, and overwrites the
`data-i18n` attribute set in `index.html:1183`, so it stays English permanently after
the first sort. WCAG aside, this is a visible i18n defect in the Korean UI. Fix: localize
via i18n keys. Confidence: High.

### D3 — `refreshVideos` error uses a hardcoded English string (LOW, High)
Citation: `src/app.ts:2025` `'Authentication required to refresh videos'`. Not run
through `rendererI18n.t()`. Add a key (e.g. `status.authRequiredToRefresh`) to both
en/ko. Confidence: High.

### D4 — `updateAuthDependentButtons` sets `title="Authentication required"` in English (LOW, Medium)
Citation: `src/app.ts:243,256`. The disabled-button tooltip is hardcoded English. Should
use an i18n key for parity with the rest of the localized UI. Confidence: Medium.

### D5 — Tag chips truncate at `max-width:200px` with ellipsis and no title/tooltip (LOW, Medium)
Citation: `src/index.html:1003-1011` (`.tag-chip{max-width:200px;overflow:hidden}` +
`.tag-text{text-overflow:ellipsis}`). A long tag is visually truncated with no way to see
the full value (no `title` attr on `.tag-text`). Affordance/discoverability gap. Fix:
add `title="${escapeHtmlAttribute(tag)}"` to `.tag-text` (note: must be attribute-escaped
— ties into S1/S2 hygiene). Confidence: Medium.

### D6 — Loading overlay `aria-busy="true"` is static, never toggled (LOW, Medium)
Citation: `src/index.html:1293`; `showLoadingOverlay`/`hideLoadingOverlay`
(`app.ts:183-212`) toggle the `show` class + `display` but never update `aria-busy`.
So AT always sees `aria-busy=true` on the overlay even when hidden. Because the overlay
also has `display:none` when hidden it is removed from the a11y tree, so impact is low,
but the attribute is misleading. Fix: set `aria-busy` true/false in show/hide, or rely
on the `role="status"` + visibility. Confidence: Medium.

## Sweep (verified OK)
- Short badge `#fff` on `#c00000` ≈ 5.9:1 (AA pass) — cycle-1 fix holds.
- `prefers-reduced-motion` media query disables animations/transitions globally.
- Burger `aria-expanded` toggled in `toggleMobileMenu` + resize/escape handlers.
- `#status-message` has `role=status aria-live=polite aria-atomic=true`.
- External links carry `rel="noopener noreferrer"` (video link `app.ts:394`); the
  privacy/terms `target=_blank` links in index.html (`:1229,1239`) do NOT carry `rel`.
  → D7 below.

### D7 — `target="_blank"` privacy/terms links lack `rel="noopener noreferrer"` (LOW, High)
Citation: `src/index.html:1229,1239`. Cycle-1 A14 fixed the *video* link but the two
doc links in the dropdown still open with `target=_blank` and no `rel`. Same reverse-
tabnabbing/`window.opener` hardening should apply. Fix: add
`rel="noopener noreferrer"`. Confidence: High.
