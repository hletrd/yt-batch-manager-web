# Deferred Findings — yt-batch-manager-web (cycle 1)

Only existing review findings appear here (no new refactors/features invented). Severity/confidence preserved exactly from `.context/reviews/_aggregate.md`. No security, correctness, or data-loss finding is deferred — all such findings (A1, A2, A3, A4, A5, A6, A9, A19, A13, A21, A22) are scheduled in Plans 01 and 05.

Repo policy still binds deferred work when picked up: GPG-signed commits, conventional commits + gitmoji, no `--no-verify`, no force-push, latest toolchain.

---

## A11 (part) — Decompose the 2094-line `YouTubeBatchManager` god class
- Severity/Confidence: MEDIUM / High.
- Citation: `src/app.ts` (whole file); ARCH-1.
- Reason for deferral: large structural refactor with high regression risk and zero behavior change; out of scope for a single review-fix cycle. The data-correctness and dup-type parts of A11 ARE addressed now (Plan 04 T1–T3 shared types; Plan 01 fixes the XSS that motivates moving away from string HTML).
- Exit criterion: re-open when the next feature touches rendering/state, or when a test harness is introduced (whichever first).

## A2x parts of A28 — Replace remaining `setTimeout` timing hacks — RESOLVED
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:548-558` (post-insert 10ms textarea sizing + i18n), `:1008`, `:106`.
- Resolution: full inventory of the 9 `setTimeout` sites in `src/app.ts`. Replaced with
  rAF/direct sequencing (render-timing hacks): loading-overlay `.show` trigger (10ms →
  double rAF so the opacity transition still fires), end-of-`initializeApp` i18n sweep
  (100ms → rAF; all init-path DOM is inserted synchronously before it), and the three
  focus-after-tag-edit cases in `addTag`/`removeTag`/`renderTagsContainer` (10ms/0ms → rAF).
  The post-insert textarea sizing was already rAF-batched in an earlier cycle. KEPT as real
  timers, each with an in-code justification comment: the 3s status-toast auto-hide (by
  design), the 300ms overlay `display:none` (matches the 0.3s CSS transition; transitionend
  can be skipped under reduced-motion), the 100ms dropdown focusout grace period (focusout
  fires before the next element gains focus; rAF can run between the two and close the
  dropdown too early), and the 100ms constructor auth-button settle (races async i18n init;
  re-run authoritatively by `initializeApp`). Verified in browser: tag add/remove keeps
  focus in the tag input, textareas size correctly, overlay fade-in/out still works,
  zero console errors.

## A27 (part) — Fully type all YouTube API responses — RESOLVED
- Severity/Confidence: LOW / High.
- Citation: `src/youtube-api.ts` (`Promise<any>`, `item: any`).
- Resolution: all remaining `any` usages in `src/youtube-api.ts` are gone. Consumed-field-only
  interfaces now cover playlistItems, videos.list items (snippet/status/contentDetails/
  statistics/recordingDetails/fileDetails.videoStreams), channels.list (snippet and
  contentDetails.relatedPlaylists as separate per-`part` shapes), videoCategories,
  i18nLanguages, the Data API error envelope, OAuth token success/error bodies, and the
  videos.update request body. `getChannelInfo`/`getVideoCategories`/`getI18nLanguages` return
  the typed shapes (exported), and the `(category: any)`/`(language: any)` annotations in
  app.ts now rely on inference. Deliberately NOT exhaustive per the original scoping. tsc
  strict/lint/build green; verified in browser via stubbed-transport import → edit → save
  (PUT body JSON unchanged, including the status backfill round-trip).

## A30 — Debounce textarea auto-resize — RESOLVED
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:325-330,336,1634` (now `autoResizeTextarea`/`resizeTextareaNow`).
- Resolution: `autoResizeTextarea` is now a rAF throttle — a `WeakSet<HTMLTextAreaElement>`
  tracks textareas with a pending resize so rapid keystrokes coalesce into at most one
  reflow per textarea per frame; the synchronous logic lives in `resizeTextareaNow`, which
  the already-frame-aligned post-insert batch in `renderVideos` calls directly (no extra
  frame of unsized-textarea flash on first paint). Verified in browser: a 60-keystroke
  burst in one tick leaves the height untouched until the next frame (single coalesced
  resize), then settles at exactly `max(scrollHeight, 140)`; growth, shrink-to-min, and
  the character counter all behave as before; zero console errors.

## A32 — `restoreTemporaryChanges` drops select value when option absent — RESOLVED
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:2014-2079` (now `restoreTemporaryChanges` / `setSelectValuePreservingChoice`).
- Resolution: restoring into the category/audio-language/default-language selects now goes
  through `setSelectValuePreservingChoice`, which appends a missing `<option>` (value as
  its label, created via DOM APIs so no escaping is needed) and selects it instead of
  silently leaving the select empty. Verified in browser by restoring a snapshot with a
  category id outside the fallback list.

## A34 / Plan 02 T6 — Generated docs `lang="en"` — RESOLVED (by rationale, no code change)
- Severity/Confidence: LOW / Medium.
- Citation: `build-docs.js:6`.
- Resolution: the generated docs are English content — privacy.html/terms.html are
  English-only, and about.html (from README.md) is English-primary with a single
  clearly-labeled Korean features section — so the document-level `lang="en"` is
  factually accurate and `build-docs.js` needs no change. The only "true" fix would be
  localizing the docs themselves, which is out of scope. Re-open only if the generated
  docs become bilingual/per-language (then emit a matching `lang` per page, and mark
  any embedded Korean section with `lang="ko"`).

## A18 / Plan 06 T4 — PRIVACY.md contact address looks like a placeholder — RESOLVED
- Severity/Confidence: MEDIUM / Medium.
- Resolution: the maintainer confirmed `01@0101010101.com` IS the real monitored contact
  address (not a placeholder). It is now used consistently in both PRIVACY.md and
  TERMS.md (exit criterion met).

## A15 — OAuth refresh token in localStorage
- Severity/Confidence: LOW / High.
- Citation: `src/youtube-api.ts:136,146`.
- Reason: inherent to a backend-less static SPA; there is no safer client-only store for a refresh token that must survive reloads (the README advertises persistent login). The mitigations (eliminate XSS sink A1, add CSP A6) ARE implemented in Plan 01. Per repo intent (README explicitly advertises "stays signed in across reloads"), persisting the refresh token is a deliberate product decision. This is a documented residual risk, not a deferred fix.
- Exit criterion: if a backend/token-broker is ever introduced, move token storage server-side.

## A26 (dedup part only) — DRY helper extraction for no-credentials / channel-reset blocks — RESOLVED
- Severity/Confidence: LOW / High.
- Citation: `src/app.ts` (no-credentials blocks, previously duplicated in `renderVideos` and `initializeApp`; near-identical logout/removeSavedCredentials bodies).
- Resolution: extracted `renderNoCredentials(container)` (single canonical no-credentials
  markup, indentation kept byte-identical to the pre-refactor startup output) and split the
  shared logout core into `clearSessionAndVideoState()`, `resetChannelHeader()`, and
  `showSignedOutVideoList()`; `logout()`/`removeSavedCredentials()` now compose these in
  their original order (logout keeps its extra `updateAuthDependentButtons()` call).
  Verified in browser: startup no-credentials innerHTML byte-identical before/after
  (cmp), logout + removeSavedCredentials DOM/state byte-identical including the
  monkey-patched `hasCredentials() === true` branch with a `youtubeAPI.logout` spy. The
  renderVideos-path markup differs only in leading whitespace (canonicalized).

## A20 (storage part) — `client_secret` shipped to browser
- Severity/Confidence: LOW / Medium.
- Citation: `src/youtube-api.ts:189-196`.
- Reason: architecture is a public client; PKCE is enforced. The actionable doc note (lock GCP redirect URIs/origins) IS scheduled in Plan 06 T5. Eliminating the secret entirely would require switching OAuth client type — a GCP-side change outside this repo.
- Exit criterion: migrate the OAuth client to a PKCE-public (no-secret) type in Google Cloud Console.

---

# Cycle 2 deferred findings

Only existing cycle-2 review findings (`.context/reviews/_aggregate-cycle2.md`) appear
here. Severity/confidence preserved exactly. NONE of the deferred items below are
security, correctness, or data-loss findings — those (B1, B2, B3) are scheduled in
Plan 07 T1–T3 and are not deferrable. Repo policy still binds these when picked up
(GPG-signed commits, conventional + gitmoji, no `--no-verify`, no force-push, latest
toolchain).

## B12 — `originalVideosState` shallow snapshot shares nested objects — RESOLVED
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:737,1492,1984` (now `loadVideos`/`importVideoData`/`updateVideo`).
- Resolution: all three baseline-snapshot sites (load, import, save-success) now use
  `structuredClone(video)` instead of `{ ...video, tags: [...] }`, so nested objects
  (statistics/thumbnails/processing_progress) are deep-copied and can never be shared
  with the live record. Change-detection verified in browser (edit → marked changed,
  revert → unmarked).

## B14 — `<html lang>` static `en`, updated only by JS post-init — RESOLVED
- Severity/Confidence: LOW / Medium.
- Citation: `src/index.html:2`, `src/app.ts:933`.
- Resolution: a tiny inline script near the top of `<head>` (after the CSP meta so the
  document policy still governs it; the page CSP already allows 'unsafe-inline') now sets
  `document.documentElement.lang` from `navigator.languages` before any app JS loads,
  mirroring the detection in `src/i18n/renderer-i18n.ts` (ko → ko, else en). The
  post-i18n-init runtime assignment in `initializeApp` remains authoritative. Verified
  in browser for both en and ko locales.

## B15 — `made_for_kids` modeled + read but never written/displayed — RESOLVED
- Severity/Confidence: LOW / Low.
- Citation: `src/types.ts:23`, `src/youtube-api.ts:644`.
- Resolution: the field is now displayed as a read-only "Made for kids" badge
  (`.made-for-kids-badge`, theme-aware, i18n `video.madeForKids` en/ko) in the video
  card metadata row when `made_for_kids === true`. Deliberately NOT editable and
  `selfDeclaredMadeForKids` is still never written — the COPPA designation must not be
  toggled from this app (rationale documented in `src/youtube-api.ts`). Badge show/hide
  verified in browser.

## B16 — Unused `batchUpdateVideos` public method — RESOLVED
- Severity/Confidence: LOW / Low.
- Resolution: the dead `batchUpdateVideos` method (no call sites anywhere in the repo)
  was removed from `src/youtube-api.ts`. No behavior change; tsc/eslint/build all green.

## B17 — README lacks an import trust-model note — RESOLVED
- Severity/Confidence: INFO / Medium.
- Resolution: the README Features section now states that imported backups are validated
  and sanitized before anything is rendered or saved (B1/B2 sanitization shipped earlier,
  so the note is accurate). Done in the post-convergence docs pass.

---

# Cycle 3 deferred findings

Only existing cycle-3 review findings (`.context/reviews/_aggregate-cycle3.md`) appear
here. Severity/confidence preserved exactly. The single deferred item is NOT a security,
correctness, or data-loss finding (it is a latent, self-healing cache-freshness issue),
so deferral is permitted by the deferred-fix rules. Repo policy still binds this work when
picked up (GPG-signed commits, conventional + gitmoji, no `--no-verify`, no force-push,
latest toolchain).

## C2 — Saving an imported video persists thin backup records into the video cache — RESOLVED
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:2078` (`updateVideo` → `updateVideoCache` → `saveVideosToCache`);
  backup field stripping at `filterVideoDataForBackup` (`app.ts:1439-1453`).
- Resolution: `state.allVideos` provenance is now tracked in a private
  `videosSource: 'youtube' | 'import'` field (set by `loadVideos` / `importVideoData`),
  and `updateVideoCache` skips persistence for imported sets, so saving an imported
  video no longer overwrites `yt_video_cache` with thin backup records. The thin-cache
  discard in `loadVideosFromCache` stays as defense-in-depth. Verified in browser:
  import → save (intercepted API) → cache untouched.

---

# Cycle 5 deferred findings

Only existing cycle-5 review findings (`.context/reviews/_aggregate-cycle5.md`) appear
here. Severity/confidence preserved exactly. The deferred item is NOT a security,
correctness, or data-loss finding (it is a documentation-completeness gap), so deferral
is permitted by the deferred-fix rules. The cycle-5 data-loss finding (E1) and its coupled
MEDIUM (E2) are NOT deferred — both are addressed in Plan 10. Repo policy still binds this
work when picked up (GPG-signed commits, conventional + gitmoji, no `--no-verify`, no
force-push, latest toolchain).

## E3 — README feature list omits the newest editable fields — RESOLVED
- Severity/Confidence: LOW / INFO (Medium).
- Resolution: the README Features sections (EN + KO) now document recording
  date/location editing, license and title/description language, the vertical-aware
  Shorts badge, full-channel loading, and the complete (null-including) JSON backup
  template. Done in the post-convergence docs pass (exit criterion met).
