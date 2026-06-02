# Aggregate Review — yt-batch-manager-web (cycle 1)

Per-agent reviews (provenance preserved): `security-reviewer.md`, `code-reviewer.md`, `perf-reviewer.md`, `verifier.md`, `designer.md`, `architect.md`, `document-specialist.md`, `test-engineer.md`.

Baseline gates (whole repo): `eslint src/**/*.ts` = 0 errors (1 config warning), `tsc -p tsconfig.json --noEmit` = 0 errors, `npm run build` = success. i18n parity confirmed (en=110, ko=110, all used keys resolve).

Reviewer fan-out note: this environment has NO registered specialist review agents (no `.claude/agents/`, no user-level agents) and no nestable Task/Agent tool. The fan-out was executed as distinct specialist passes by the single available agent, one output file per specialist angle, to preserve the required structure and provenance. See AGENT FAILURES.

## Deduplicated findings (highest severity preserved; cross-agent agreement noted)

| ID | Severity | Conf | Title | Agreeing reviewers |
|----|----------|------|-------|--------------------|
| A1 | HIGH | High | DOM-XSS: tag value injected into single-quoted JS string in inline `onclick` (`escapeHtml` doesn't escape `'`/`\`). `app.ts:522,1826` | security (SEC-1), verifier (VER-2), architect (ARCH-2 root cause), test-engineer (TEST-4) |
| A2 | HIGH | High | Cleared **description** (and language→Auto) silently not saved due to `||` truthy fallback. `app.ts:1894-1899` | code (CR-2), verifier (VER-1), test-engineer (TEST-6 path) |
| A3 | MEDIUM | High | Sensitive debug logging incl. full `localStorage` dump (access token) in prod. `youtube-api.ts:253` + many | security (SEC-5), code (CR-1) |
| A4 | MEDIUM | High | Silent token refresh on 401 throws a sentinel error that callers don't catch → surfaces as a user-facing failure instead of transparent retry. `youtube-api.ts:511-535` | verifier (VER-6), architect (ARCH-5) |
| A5 | MEDIUM | Medium | `made_for_kids` read as `madeForKids` but written as `selfDeclaredMadeForKids` on every update → may flip COPPA designation. `youtube-api.ts:729,850` | verifier (VER-7), document (DOC-2) |
| A6 | MEDIUM | High | No CSP meta; heavy `innerHTML`+inline handlers. `index.html` head | security (SEC-2), architect (ARCH-2) |
| A7 | MEDIUM | High | `<html>` missing `lang`; dynamic field labels (`Title`/`Description`/`Tags`) and several option labels hardcoded English (no `data-i18n`). `index.html:2`, `app.ts:487,499,509,410,1083,1111,412` | designer (UX-1, UX-2), document (DOC-5 related) |
| A8 | MEDIUM | High | Status messages not announced (`#status-message` lacks `role/aria-live`); loading overlay lacks accessible semantics. `app.ts:158-168,194-223` | designer (UX-6, UX-7) |
| A9 | MEDIUM | Medium | OAuth `state` uses `Math.random()` not `crypto.getRandomValues`. `youtube-api.ts:340-347` | security (SEC sweep) |
| A10 | MEDIUM | High | `scroll` listener unthrottled + non-passive → layout thrash; `updatePageTexts` runs full-doc sweep per video (20×/render burst). `app.ts:848,557` | perf (PERF-2, PERF-4) |
| A11 | MEDIUM | High | God class (2094 lines) + duplicated `VideoData`/`ThumbnailData` interfaces that have already drifted (`processing_progress`). `app.ts` / `youtube-api.ts:21-52` | architect (ARCH-1, ARCH-4) |
| A12 | LOW | High | localStorage-key cleanup drift: `clearStoredToken` removes `oauth_code_verifier` but `deleteCache`/`removeSavedCredentials` don't. `app.ts:1493,1515` vs `youtube-api.ts:153-162` | architect (ARCH-Sweep) |
| A13 | LOW | High | Tags counter format mismatch (`/500` vs `N tags`) and wrong limit semantics (YouTube limits ~500 chars total, not 500 tags). `app.ts:517,1610-1617` | code (CR-3) |
| A14 | LOW | High | `target="_blank"` links lack `rel="noopener noreferrer"`. `app.ts:405` | security (sweep), designer (UX-4) |
| A15 | LOW | High | OAuth refresh-token in localStorage (inherent to static SPA; mitigate via A1/A6). `youtube-api.ts:136,146` | security (SEC-3) |
| A16 | LOW | Medium | Short badge inline styles + low contrast (#ff0033 on #fff ≈3.9:1 < AA). `app.ts:412` | designer (UX-3) |
| A17 | LOW | High | README Features omits synthetic-content toggle, copy-tags, Shorts badge. | document (DOC-1) |
| A18 | MEDIUM | Medium | PRIVACY.md contact `01@0101010101.com` looks like a placeholder (OAuth-verification compliance). `PRIVACY.md:123` | document (DOC-3) |
| A19 | LOW | Medium | `importVideoData` validates only id/title; rest trusted verbatim (injection-delivery vector w/ A1). `app.ts:1401-1443` | security (SEC-6) |
| A20 | LOW | Medium | `client_secret` shipped to browser; safe only if GCP redirect URIs locked (verify/document). `youtube-api.ts:189-196` | security (SEC-4) |
| A21 | LOW | Medium | `formatDuration`/`parseDurationToSeconds` ignore ISO-8601 days → >24h videos mis-parse. `app.ts:111-136` | verifier (sweep), test-engineer (TEST-1) |
| A22 | LOW | Medium | Sort comparator NaN for empty `published_at` (imported backups) → unstable order. `app.ts:1167-1186` | verifier (sweep) |
| A23 | LOW | Medium | O(n) `allVideos.find` in hot per-keystroke handlers; add a Map index. `app.ts:1656,1788,1856,1875` | perf (PERF-1), architect (ARCH-3) |
| A24 | LOW | Medium | Per-save full cache re-parse/re-serialize to recover channelId. `app.ts:691-710` | perf (PERF-6) |
| A25 | LOW | Low | Pointless 30s `setInterval` logging unsaved count. `app.ts:913` | perf (sweep) |
| A26 | LOW | High | DRY: triplicated no-credentials block (one missing `data-i18n` at `app.ts:992-1004`); near-identical logout/removeCredentials bodies. | code (CR-5) |
| A27 | LOW | High | API responses typed `any`; no response interfaces. `youtube-api.ts` | code (CR-6) |
| A28 | LOW | Medium | `setTimeout(...,10/0/100)` render/focus/auth timing hacks. `app.ts:106,548,1008,1806,1866` | code (CR-7), designer (UX-9) |
| A29 | LOW | High | `package.json` missing `"type":"module"` → eslint `MODULE_TYPELESS_PACKAGE_JSON` warning every run. | code (CR-8), architect (sweep) |
| A30 | LOW | Medium | `autoResizeTextarea` forces reflow per keystroke on large descriptions. `app.ts:336,1634` | perf (sweep) |
| A31 | INFO | Medium | No automated tests; pure functions (duration/number/diff/interpolate) are cheap high-value units once extracted. | test-engineer (all) |
| A32 | LOW | Medium | `restoreTemporaryChanges` drops a restored category/language whose `<option>` is absent (fallback metadata). `app.ts:2014-2079` | verifier (VER-3) |
| A33 | LOW | Medium | No `prefers-reduced-motion`; burger lacks `aria-expanded`; dropdowns not keyboard-openable. `index.html`/`app.ts` | designer (sweep) |
| A34 | LOW | Medium | `build-docs.js` hardcodes `lang="en"` on bilingual doc pages. | document (DOC-5) |

## Cross-agent high-signal items (flagged by 2+ specialists → prioritize)
A1 (4 reviewers), A2 (3), A11 (architect dup), A3/A4/A5/A6/A7/A8/A10/A14/A23/A28/A29 (2 each). These should be scheduled first in the plan.

## Severity rollup
- HIGH: A1, A2
- MEDIUM: A3, A4, A5, A6, A7, A8, A9, A10, A11, A18
- LOW: A12–A17, A19–A30, A32–A34
- INFO: A31

## AGENT FAILURES
No dedicated reviewer subagents (`code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, `designer`) are registered in this environment, and no nestable Task/Agent dispatch tool is available (the `superpowers:dispatching-parallel-agents` pattern requires a Task tool that is not present; `ToolSearch` for `Task` returned none). Per the prompt's instruction to "skip any that are not registered," the fan-out was performed as separate specialist passes by the one available agent rather than silently dropping coverage. All eleven specialist angles were exercised; `critic`/`tracer`/`debugger` perspectives are folded into `verifier.md`/`architect.md`. No partial/failed agent output to report.
