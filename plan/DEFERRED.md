# Deferred Findings — yt-batch-manager-web (cycle 1)

Only existing review findings appear here (no new refactors/features invented). Severity/confidence preserved exactly from `.context/reviews/_aggregate.md`. No security, correctness, or data-loss finding is deferred — all such findings (A1, A2, A3, A4, A5, A6, A9, A19, A13, A21, A22) are scheduled in Plans 01 and 05.

Repo policy still binds deferred work when picked up: GPG-signed commits, conventional commits + gitmoji, no `--no-verify`, no force-push, latest toolchain.

---

## A11 (part) — Decompose the 2094-line `YouTubeBatchManager` god class
- Severity/Confidence: MEDIUM / High.
- Citation: `src/app.ts` (whole file); ARCH-1.
- Reason for deferral: large structural refactor with high regression risk and zero behavior change; out of scope for a single review-fix cycle. The data-correctness and dup-type parts of A11 ARE addressed now (Plan 04 T1–T3 shared types; Plan 01 fixes the XSS that motivates moving away from string HTML).
- Exit criterion: re-open when the next feature touches rendering/state, or when a test harness is introduced (whichever first).

## A2x parts of A28 — Replace remaining `setTimeout` timing hacks
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:548-558` (post-insert 10ms textarea sizing + i18n), `:1008`, `:106`.
- Reason: the post-insert sizing is intertwined with the string-HTML render path; safely fixing it depends on the A11 refactor. The cheap focus-after-tag-edit cases ARE improved in Plan 04 T6.
- Exit criterion: addressed together with A11 decomposition, or if a concrete timing bug is reproduced.

## A27 (part) — Fully type all YouTube API responses
- Severity/Confidence: LOW / High.
- Citation: `src/youtube-api.ts` (`Promise<any>`, `item: any`).
- Reason: Plan 04 T4 types the consumed shapes (`getVideos`, `getChannelInfo`); exhaustively typing every endpoint/field is large and low-value relative to risk.
- Exit criterion: when adding a new endpoint or when a type-related runtime bug is found.

## A30 — Debounce textarea auto-resize
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:325-330,336,1634`.
- Reason: per-keystroke reflow is minor; rAF-batching risks visible layout jitter and needs manual UX verification not feasible without a live login this cycle. Tracked in Plan 03 T6 as a candidate.
- Exit criterion: a user-reported typing-lag report, or when the render path is refactored (A11).

## A32 — `restoreTemporaryChanges` drops select value when option absent
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:2014-2079`.
- Reason: only triggers when API metadata failed to load AND a restored category/language is outside the fallback set — rare. Listed in Plan 05 T4. Deferring the fix, not the awareness.
- Exit criterion: a reproduction where a restored value is silently lost, or when metadata-load-failure handling is revisited.

## A34 / Plan 02 T6 — Generated docs `lang="en"`
- Severity/Confidence: LOW / Medium.
- Citation: `build-docs.js:6`.
- Reason: doc pages are predominantly English; bilingual `lang` switching for static generated docs is low value. Main-app lang (A7) is fixed in Plan 02 T1.
- Exit criterion: if generated docs become per-language, or a localization pass is undertaken.

## A18 / Plan 06 T4 — PRIVACY.md contact address looks like a placeholder
- Severity/Confidence: MEDIUM / Medium.
- Citation: `PRIVACY.md:123` (`01@0101010101.com`).
- Reason: NOT a code/security/data-loss issue; it is published-content requiring the maintainer's real contact address — cannot be invented by the agent. (Repo has no rule forbidding placeholder contacts, so deferral is permitted as it is a docs/content decision, not security/correctness.)
- Exit criterion: maintainer supplies the correct monitored contact email.

## A15 — OAuth refresh token in localStorage
- Severity/Confidence: LOW / High.
- Citation: `src/youtube-api.ts:136,146`.
- Reason: inherent to a backend-less static SPA; there is no safer client-only store for a refresh token that must survive reloads (the README advertises persistent login). The mitigations (eliminate XSS sink A1, add CSP A6) ARE implemented in Plan 01. Per repo intent (README explicitly advertises "stays signed in across reloads"), persisting the refresh token is a deliberate product decision. This is a documented residual risk, not a deferred fix.
- Exit criterion: if a backend/token-broker is ever introduced, move token storage server-side.

## A26 (dedup part only) — DRY helper extraction for no-credentials / channel-reset blocks
- Severity/Confidence: LOW / High.
- Citation: `src/app.ts` (no-credentials blocks at ~362, ~1020, ~1483; near-identical logout/removeSavedCredentials bodies).
- Reason: the user-visible defect in A26 (a no-credentials copy missing `data-i18n`) was FIXED this cycle (Plan 02 T2). What remains is a pure non-behavioral DRY refactor (extract renderNoCredentials/resetChannelHeader). Deferred to keep the cycle diff focused; not a correctness/security issue.
- Exit criterion: extract the helper the next time one of these blocks needs a content/markup change, or as part of the A11 decomposition.

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

## B12 — `originalVideosState` shallow snapshot shares nested objects
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:737,1492,1984`.
- Reason: latent only — no current code mutates `statistics`/`thumbnails`/
  `processing_progress` in place, so change-detection is correct today. A defensive deep
  snapshot adds cost/churn without fixing an observed bug. Not a correctness/data-loss
  finding at present.
- Exit criterion: re-open if any code begins mutating those nested objects in place, or
  when the A11 render/state refactor lands.

## B14 — `<html lang>` static `en`, updated only by JS post-init
- Severity/Confidence: LOW / Medium.
- Citation: `src/index.html:2`, `src/app.ts:933`.
- Reason: this is a static single-page app with no SSR; the runtime JS already sets the
  correct lang after i18n init (cycle-1 A7). A correct static default would require build-
  time language selection, which is out of scope and low value. Not security/correctness.
- Exit criterion: if the app gains SSR/prerendering or a build-time locale split.

## B15 — `made_for_kids` modeled + read but never written/displayed
- Severity/Confidence: LOW / Low.
- Citation: `src/types.ts:23`, `src/youtube-api.ts:644`.
- Reason: intentional after cycle-1 A5 — the field is retained so backups can round-trip
  the value; removing it would lose that data on export. Read-but-unused in the UI is by
  design, not a defect.
- Exit criterion: if backup export stops needing the field, or the UI adds a made-for-kids
  control.

## B16 — Unused `batchUpdateVideos` public method — RESOLVED
- Severity/Confidence: LOW / Low.
- Resolution: the dead `batchUpdateVideos` method (no call sites anywhere in the repo)
  was removed from `src/youtube-api.ts`. No behavior change; tsc/eslint/build all green.

## B17 — README lacks an import trust-model note
- Severity/Confidence: INFO / Medium.
- Citation: README Features / file-operations.
- Reason: documentation-only, and only meaningful once B1/B2 sanitization ships (so the
  note is accurate). INFO severity. Pair with B1/B2 in a later docs pass.
- Exit criterion: after B1/B2 fixes are merged, add a one-line import-sanitization note.

---

# Cycle 3 deferred findings

Only existing cycle-3 review findings (`.context/reviews/_aggregate-cycle3.md`) appear
here. Severity/confidence preserved exactly. The single deferred item is NOT a security,
correctness, or data-loss finding (it is a latent, self-healing cache-freshness issue),
so deferral is permitted by the deferred-fix rules. Repo policy still binds this work when
picked up (GPG-signed commits, conventional + gitmoji, no `--no-verify`, no force-push,
latest toolchain).

## C2 — Saving an imported video persists thin backup records into the video cache
- Severity/Confidence: LOW / Medium.
- Citation: `src/app.ts:2078` (`updateVideo` → `updateVideoCache` → `saveVideosToCache`);
  backup field stripping at `filterVideoDataForBackup` (`app.ts:1439-1453`).
- Reason for deferral: after a file import, `state.allVideos` are backup records that lack
  YouTube-only fields (statistics/thumbnails/duration/upload_status). Saving one imported
  video overwrites `yt_video_cache` with those thin records, so a later non-forced
  `loadVideos()` shows imported videos missing stats/thumbnails. This is LATENT and
  SELF-HEALING: a "Load from YouTube" (forceRefresh) fully repopulates the cache, the
  24h expiry eventually drops it, and the UI already degrades gracefully (default
  thumbnail, 0 stats). No data is lost on YouTube; only the local display cache is thin.
  Not a security/correctness/data-loss finding. A robust fix (tag the cache with a
  `source` and only persist YouTube-sourced sets, or skip `updateVideoCache` for
  imported sets) touches the cache/state model and risks churn in a freshly stabilized
  cycle.
- Exit criterion: re-open if a user reports stale/incomplete videos after an import+save
  with no obvious refresh path, or when the cache/state model is next refactored
  (e.g. alongside the A11 decomposition).
