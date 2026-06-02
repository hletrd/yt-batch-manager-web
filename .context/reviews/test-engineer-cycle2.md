# Test Engineering Review — yt-batch-manager-web (cycle 2)

Repo has no test framework (CLAUDE/AGENTS confirm: client-side TS compiled by tsc, no
bundler, no test framework). Cycle-1 A31 (no tests) recorded as INFO. NEW angle:
test-gaps that the cycle-2 findings expose.

## Findings

### T-1 — No regression guard for the import→render XSS surface (INFO→relevant, Medium)
The S1/S2 (security) findings show `importVideoData` field coercion is incomplete (`id`,
`thumbnail_url`, `thumbnails[*].url` untrusted). Even without a test framework, the pure
sanitization logic in `importVideoData` is the highest-value unit to extract + assert
(e.g. that a malicious `id`/url is rejected/escaped). This is the same recommendation as
A31 but now with a concrete security motivation. If/when a harness is added, prioritize:
- `importVideoData` field coercion (incl. new id/url validation from S1/S2)
- `parseIsoDuration`/`formatDuration` (cycle-1 A21 already verified manually)
- `escapeHtmlAttribute` round-trips for `'`, `"`, `<`, `>`, `&`
- `videoDiffersFromBaseline` symmetry
Confidence: Medium (process recommendation).

### T-2 — Manual verification owed for S1/S2/V1 fixes (Medium)
The import-edit-save data-loss path (V1) and the import-XSS path (S1/S2) cannot be
exercised in CI here. When fixed, verify against a local `http-server dist` with a
hand-crafted backup JSON (malicious id/url; imported video with absent status fields)
and an authenticated session. Record results in the plan progress.

## Sweep
- Gates (eslint, tsc, build) are the only automated guard; all green at cycle-2 start.
- No flaky tests (none exist). No assertion to xfail.
