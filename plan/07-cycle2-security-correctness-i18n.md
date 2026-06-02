# Plan 07 — Cycle 2: Security, Correctness, i18n & Polish

Sources: `.context/reviews/_aggregate-cycle2.md` (findings B1–B17). Security/correctness
findings (B1, B2, B3) are NOT deferrable per repo rules. All other NEW findings are
either scheduled below or recorded in `DEFERRED.md` with severity preserved.

Repo rules binding this work (from user global CLAUDE.md; no project CLAUDE.md/AGENTS.md):
GPG-signed commits (`git commit -S`), Conventional Commits + gitmoji, fine-grained
commits, `git pull --rebase` before push, no suppressions, gates green (eslint, tsc,
build), deploy auto on push (no separate deploy).

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred

## Tasks

### [x] T1 — Validate imported `video.id`; harden inline-handler id sink (B1, HIGH, non-deferrable)
Problem: `importVideoData` (`app.ts:1446,1460-1469`) leaves `id` unsanitized while
`renderVideos`/`renderTagsContainer` interpolate `'${video.id}'` into single-quoted JS
strings inside inline `on*` handlers. A malicious backup `id` like `x'); alert(1); ('`
executes JS in-origin (token theft).
Fix (defense-in-depth):
- In `importVideoData`, reject any record whose `id` is not a string matching
  `/^[A-Za-z0-9_-]{11}$/` (YouTube video-id charset/length). Filter such records out and
  surface the existing invalid-data status if any are dropped.
- Add a `escapeJsString`-free approach by keeping ids constrained; since ids are now
  guaranteed `[A-Za-z0-9_-]{11}`, the inline-handler interpolation is safe. (Full move to
  delegation is tracked under A11/AR1 deferral.)
Acceptance: importing JSON with id `x'); alert(1); ('` does not render that record / does
not execute script; valid 11-char ids still load; tsc+eslint+build green.

### [x] T2 — Attribute-escape thumbnail URLs + validate on import (B2, MEDIUM, non-deferrable)
Problem: `generateResponsiveImageHtml` (`app.ts:591-600`) interpolates `thumbnail_url`
and `thumbnails[*].url` raw into `src`/`srcset`. Import does not validate these.
Fix:
- Wrap URL interpolation with `escapeHtmlAttribute(...)` for `src` and each srcset URL.
- In `importVideoData`, coerce `thumbnail_url` to a string and drop it unless it is a
  safe `http(s):`/`data:` URL; coerce `thumbnails` to a `Record<string,{url,width,height}>`
  keeping only string urls. Non-conforming → omit (falls back to default thumbnail).
Acceptance: a backup with `thumbnail_url` containing `"` + `onerror=` neither breaks the
attribute nor injects a handler; normal YouTube thumbnails still render; gates green.

### [x] T3 — Don't wipe status fields when saving imported videos (B3, MEDIUM, non-deferrable)
Problem: imported videos lack `license`/`embeddable`/`public_stats_viewable`
(`youtube-api.ts:645-647` only populates them on YouTube fetch; backup export strips
them at `app.ts:1394-1408`). On save, `updateVideo` omits undefined fields and
`videos.update` treats omitted `status` subfields as reset (the code relies on this for
`containsSyntheticMedia`). So saving an imported-then-edited video can wipe these.
Fix (lowest-risk, correctness-preserving): in `updateVideo` (app.ts), before building the
PUT for a video whose `license`/`embeddable`/`public_stats_viewable` are all undefined
(i.e. an imported record never refreshed from YouTube), fetch the current video status
first OR skip sending `part=status` subfields the user did not change. Chosen approach:
omit `license/embeddable/public_stats_viewable` from the request ONLY when they are
undefined (already the case) BUT also omit them from the `status` part by not adding them
— AND, to avoid the reset, when ALL three are undefined fetch the live `status` via a
lightweight `videos.list?part=status&id=` and merge before PUT. If a live fetch is too
heavy, fall back to documenting the limitation (B3/DOC-4). Decide during implementation;
prefer the merge-fetch for correctness.
Acceptance: saving an imported video that only had its title changed does not clear its
existing license/embeddable/publicStatsViewable on YouTube (reasoned/verified against API
replace semantics); YouTube-loaded videos unaffected; gates green.

### [x] T4 — Localize the sort-order label (B4, MEDIUM)
Problem: `app.ts:1170-1178` writes English sort labels to `#current-sort`, overwriting
its `data-i18n`. Fix: map sort types to existing i18n keys (`sorting.dateNewestFirst`,
`sorting.dateOldestFirst`, `sorting.titleAZ`, `sorting.titleZA`, plus add keys for the
views variants if exposed) and set both `data-i18n` and `textContent` (or set the key and
re-run `updatePageTexts`). Keep en/ko parity.
Acceptance: Korean UI shows localized sort label; switching sorts keeps it localized; en/ko parity preserved; gates green.

### [x] T5 — Fix tag-input handler drift in `renderTagsContainer` (B5, MEDIUM)
Problem: re-render uses `onchange` (`app.ts:1906`) vs initial `oninput` (`:520`).
Fix: change `onchange` → `oninput` in `renderTagsContainer` to restore comma-splitting
after a tag edit. (Shared-template extraction tracked under AR2/A11 deferral.)
Acceptance: after adding/removing a tag, typing `a,b,` still auto-splits into chips; gates green.

### [x] T6 — Add `rel="noopener noreferrer"` to privacy/terms links (B6, LOW)
Citation: `index.html:1229,1239`. Add the rel. Acceptance: both doc links carry rel; gates green.

### [x] T7 — Localize hardcoded English strings (B7, B8, LOW)
- `refreshVideos` error (`app.ts:2025`) → new i18n key (e.g. `status.authRequiredToRefresh`).
- Disabled-button `title` (`app.ts:243,256`) → new i18n key (e.g. `tooltips.authRequired`).
Add keys to BOTH en.json and ko.json (preserve parity).
Acceptance: no hardcoded English in these paths; en/ko parity; gates green.

### [x] T8 — Mark video changed on tags-only restore (B9, LOW)
Citation: `app.ts:2126-2133`. After restoring tags, call `this.checkForChanges(videoId)`
(instead of the no-op `handleTagChange`). Acceptance: a tags-only temp-restore marks the
video changed and shows the Update button; gates green.

### [x] T9 — Tag chip tooltip for truncated tags (B10, LOW)
Citation: render `app.ts:510,1890`. Add `title="${this.escapeHtmlAttribute(tag)}"` to
`.tag-text`. (Must be attribute-escaped — consistent with B1/B2 hygiene.)
Acceptance: hovering a truncated tag shows its full value; no injection; gates green.

### [x] T10 — Toggle loading-overlay `aria-busy` (B11, LOW)
Citation: `index.html:1293`, `app.ts:183-212`. Set `aria-busy="true"` in
`showLoadingOverlay`, `"false"` in `hideLoadingOverlay`.
Acceptance: overlay `aria-busy` reflects visibility; gates green.

### [x] T11 — Batch post-insert sizing/counters into one rAF (B13, LOW perf)
Citation: `app.ts:537-546`. Replace the per-video `setTimeout(...,10)` with a single
`requestAnimationFrame` after the batch loop that iterates `videosToAdd` once for
textarea sizing + counters.
Acceptance: one scheduled callback per render batch instead of N; behavior identical; gates green.

### [D] T12 — Remove dead `batchUpdateVideos` (B16, LOW) — DEFERRED
Non-behavioral cleanup of an unused public method; defer to avoid churn (see DEFERRED.md B16).

### [D] T13 — `<html lang>` SSR/static (B14), `made_for_kids` dead field (B15), README import-trust note (B17), shallow snapshot (B12) — DEFERRED
See DEFERRED.md (B12, B14, B15, B17) with reasons + exit criteria.

## Progress
All scheduled tasks implemented and committed (GPG-signed), gates green
(eslint 0, tsc 0, build success), i18n parity 117/117, browser smoke test of the
built dist showed no page/console errors and correct no-credentials render.

- T1 (B1 import id validation) + T2 (B2 thumbnail URL sanitize/escape): commit `39d3bd6`.
- T3 (B3 preserve status on imported-video save, new getVideoStatus): commit `16b9f01`.
- T4 (B4 localize sort label) + T5 (B5 tag oninput drift) + T8 (B9 tags-only restore)
  + T9 (B10 tag tooltip) + T10 (B11 overlay aria-busy) + T11 (B13 rAF batch):
  commit `10d0270`.
- T6 (B6 rel=noopener on privacy/terms links): commit `fb28717`.
- T7 (B7/B8 localize hardcoded English): commit `4dde4b8`.
- T12 (B16) and T13 (B12/B14/B15/B17) deferred — recorded in DEFERRED.md.

Verification notes (test-engineer T-2): sanitizer semantics verified via node
(valid 11-char id accepted; `x'); alert(1); ('`, short id rejected; https/data:image
URLs kept; attribute-breakout and `javascript:` URLs rejected). The authenticated
import-edit-save path (B3) and live import-XSS path (B1/B2) require real OAuth
credentials not available in this environment; logic verified statically + by unit-level
node checks.
