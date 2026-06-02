# Architecture Review — yt-batch-manager-web (cycle 2)

NEW / residual only.

## Findings

### AR1 — String-HTML render path is the root cause behind S1/S2 (security) and C1 (drift) (MEDIUM, High)
Citation: `renderVideos` `src/app.ts:387-533`, `renderTagsContainer` `:1888-1910`,
`generateResponsiveImageHtml` `:591-600`. The app builds DOM by string concatenation +
`insertAdjacentHTML`/`innerHTML`, interpolating data into both attribute and inline-JS
contexts. This is the structural reason the same XSS class keeps reappearing in
different fields (tags fixed in cycle 1; ids/urls still open — see S1/S2) and the reason
two render paths drifted (C1: `oninput` vs `onchange`). The god-class decomposition
(A11/T5) is deferred, but the *render-as-strings + inline-handlers* pattern is the
higher-leverage architectural risk. Exit criterion (already in DEFERRED for A11): when a
feature next touches rendering, migrate to `data-*` + delegated listeners and DOM
construction, removing the need for `'unsafe-inline'` in `script-src` (which would let
Plan-01-T8's CSP be tightened — currently `'unsafe-inline'` is required *only* because of
these inline handlers). Confidence: High.

### AR2 — Two sources of truth for the per-video form template (LOW, High)
Citation: tag chip + input markup is duplicated between `renderVideos` (`:508-523`) and
`renderTagsContainer` (`:1888-1910`). C1 (the oninput/onchange drift) is a direct symptom.
Extract a single `tagInputTemplate(videoId)` helper. Confidence: High.

### AR3 — `made_for_kids` modeled in domain type but semantically read-only (LOW, Low)
Citation: `types.ts:23`. After A5, this field is read but never written/displayed.
Either drop it from the active model or comment that it exists only for backup
round-trip. Minor layering/clarity nit. Confidence: Low.

## Sweep
- `YouTubeAPI` cleanly encapsulates auth/token/refresh; `authedFetch` wrapper (A4) is a
  good seam. `app.ts` remains a 2163-line god class (A11 deferred) — unchanged.
- Shared `types.ts` (A11/T3) prevents the prior interface drift — good.
