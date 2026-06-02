# Plan 04 — Maintainability / Refactor

Sources: A11, A12, A26, A27, A28.

## Tasks

### [x] T1 — Fix localStorage cleanup drift (A12) — DONE
`clearStoredToken` removes `oauth_code_verifier` but `deleteCache` (`app.ts:1493`) and `removeSavedCredentials` (`app.ts:1515`) hardcode a key list omitting it. Add `oauth_code_verifier` (and prefer routing both through `youtubeAPI.logout()` which already calls `clearStoredToken`).
Acceptance: all reset paths clear the same key set including `oauth_code_verifier`.

### [~] T2 — De-duplicate no-credentials / channel-reset blocks (A26) — PARTIAL
The missing-`data-i18n` copy (the user-visible part of A26) was fixed in Plan 02 T2.
The pure DRY helper-extraction (renderNoCredentials/resetChannelHeader) is a
non-behavioral refactor and is DEFERRED this cycle (see DEFERRED.md, A26-dedup)
to keep the cycle's diff focused. Exit criterion: when one of these blocks next
needs a content change, extract the helper then.

### [x] T3 — Shared domain types (A11/A4 dup) — DONE
Create `src/types.ts` with `VideoData`, `ThumbnailData`, `ThumbnailMap` and import in both `app.ts` and `youtube-api.ts`. Include `processing_progress` so the two no longer drift. (tsconfig `isolatedModules` ok for type-only modules; emit a `.js` is fine since interfaces erase — ensure build copies nothing extra.)
Acceptance: one definition of `VideoData`; tsc green; build emits cleanly.

### [D] T4 — Type YouTube API responses (A27) — DEFERRED
Deferred (see DEFERRED.md, A27): scoped typing is lower value than the security/
correctness work prioritized this cycle and risks churn. Exit criterion stated there.

### [D] T5 — God-class decomposition (A11) — DEFER
Splitting `YouTubeBatchManager` into Renderer/Store/Cache services is a large refactor with regression risk and no behavior change. Defer (see DEFERRED.md) — exit criterion: when adding the next feature that touches rendering or when introducing tests.

### [D] T6 — Replace `setTimeout` timing hacks (A28) — DEFERRED
Deferred (see DEFERRED.md, A28): the post-insert sizing is intertwined with the
string-HTML render path; safe removal depends on the A11 render refactor.

## Progress
T1 (A12) and T3 (A11 shared types) implemented and committed (signed): a708ca1,
7fd2704. T2 partially done (missing-i18n part fixed in Plan 02; DRY dedup deferred).
T4/T5/T6 deferred (A27/A11/A28) — recorded in DEFERRED.md. tsc/eslint/build green.
