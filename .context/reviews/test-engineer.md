# Test Engineering Review — yt-batch-manager-web

## Current state
There is NO test framework and NO tests in the repo (no `*.test.ts`, no vitest/jest config; package.json scripts are clean/build/lint/serve/dev only). The cycle rules state "no test framework" — so tests are not a gate. This review records coverage gaps and the cheapest high-value testing opportunities, but does NOT mandate introducing a framework (that would be a new-feature decision for the maintainer, see deferral guidance).

## High-value pure-function units (testable without DOM)
These are the functions most worth covering if/when a test harness is added; they are also the ones with confirmed/suspected bugs:

### TEST-1 — `formatDuration` / `parseDurationToSeconds` (`app.ts:111-136`)
No handling for ISO-8601 days (`P#DT...`) → long archives mis-parse (see VER sweep). A unit test with inputs `PT3M`, `PT1H2M3S`, `P1DT2H`, `PT0S`, `''`, `undefined` would lock behavior and expose the days bug.

### TEST-2 — `isLikelyShort` boundary (`app.ts:141-144`)
`seconds > 0 && seconds <= 180`. Tests at 0, 1, 180, 181 confirm the heuristic boundary. Currently a 0-duration (live/processing) video is NOT a short — correct, but untested.

### TEST-3 — `videoDiffersFromBaseline` / `arraysEqual` (`app.ts:1691-1705`)
Core diff logic driving the "unsaved changes" prompt and import-marking. Order-sensitivity (CR-4) and field coverage should be pinned by tests.

### TEST-4 — `escapeHtml` JS-string-context gap (SEC-1)
A test asserting that a tag containing `'` is rendered without breaking out of the onclick handler would have caught SEC-1. After the fix, add a regression test for `'`, `\`, `</script>`, and `"` in tags and titles.

### TEST-5 — `formatNumber` (`app.ts:146-156`)
Boundaries 999/1000/999999/1000000; negative or NaN inputs. Cheap.

### TEST-6 — `interpolate` (`renderer-i18n.ts:134-138`)
`{count}` substitution, missing param passthrough, repeated tokens.

## Integration-level gaps (would need DOM/mocked fetch)
- OAuth callback state mismatch and PKCE verifier roundtrip (`youtube-api.ts:handleOAuthCallback`).
- Silent-refresh-on-401 retry behavior (VER-6) — currently surfaces as an error; a test would document the intended retry.
- `updateVideo` truthy-fallback bug (CR-2/VER-1) — a test feeding an empty description would catch the silent revert.
- Cache expiry (`loadVideosFromCache`, 24h) and temp-changes restore.

## Recommendation
Given the no-framework constraint, the lowest-friction option is a tiny `node --test` (built-in, zero deps) suite over the pure functions if they are extracted to a side-effect-free module (ties into ARCH-1 refactor). This is optional/maintainer-discretion and should be treated as a deferred enhancement, not a blocking finding.
