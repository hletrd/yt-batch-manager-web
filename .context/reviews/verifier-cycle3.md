# Verifier / Critic / Tracer / Debugger / Architect / Test — yt-batch-manager-web (cycle 3)

Folded multi-angle pass (no dedicated subagents registered — see AGENT FAILURES in the
aggregate). Evidence-based correctness check against stated behavior; competing-hypothesis
tracing of the one suspicious flow found; latent-bug sweep; architecture risk note;
test-gap note.

## Behavior re-verification (matches README + code intent)
- Persistent login via refresh token + silent restore on load: `initializeApp` calls
  `tryRestoreSession()` when access token expired but refresh token present; `authedFetch`
  does a single silent refresh+retry on 401. CONFIRMED, matches README "stays signed in".
- Import does NOT pre-mark unchanged videos as changed unless they differ from a loaded
  YouTube baseline: `importVideoData` (`app.ts:1534-1552`) keeps `baselineState` and only
  adds to `changedVideos` via `videoDiffersFromBaseline`. CONFIRMED (cycle-1 A-fix intact).
- Status round-trip on save (B3): when `license/embeddable/public_stats_viewable` are all
  undefined (imported record), `updateVideo` backfills from `getVideoStatus` before PUT so
  `videos.update` does not wipe them. CONFIRMED (`app.ts:2023-2033`, `youtube-api.ts:716-749`).

## Tracer — one flow examined with competing hypotheses

### TR-C3-1 (LOW) — imported-then-saved video can replace YouTube cache with thin records
Hypothesis A (bug): after `loadFromFile` → `importVideoData`, `state.allVideos` are backup
records lacking statistics/thumbnails/duration. A single `updateVideo` save calls
`updateVideoCache()` (`app.ts:2078`) which persists `state.allVideos` to `yt_video_cache`.
A later non-forced `loadVideos()` then renders cached imported records missing stats/thumbs.
Hypothesis B (not a bug): the cache is replaced wholesale on the next "Load from YouTube"
(forceRefresh=true) and expires in 24h; the UI degrades gracefully (default thumb, 0 stats).
Verdict: real but LOW-impact latent behavior, no data loss, self-healing on refresh.
Same finding as code-review C-C3-2. Recommend DEFER with exit criterion.

## Debugger — latent-bug sweep
- No new null-deref, race, or invariant violation found beyond known deferrals.
- `refreshPromise` single-flight guard correct; `clearStoredToken` clears the full key set
  including `oauth_code_verifier` (cycle-1 fix intact).
- `restoreTemporaryChanges` select-value-when-option-absent (A32) still deferred; unchanged.

## Architect — coupling note
- The 2243-line `YouTubeBatchManager` god class + string-HTML render path remains the root
  structural risk (A11, deferred). C3 findings (unescaped option markup) are again symptoms
  of string-concatenated HTML. No new architectural regression; deferral stands.

## Test-engineer — coverage note
- Repo has no test framework (by design — client-side TS, tsc-only). Verification remains
  static + node unit-level checks. The one cheaply-unit-testable NEW item is the option
  escaping (S-C3-1/C-C3-1): can be verified with a node check that `escapeHtml('&<>"')`
  and `escapeHtmlAttribute('"')` produce entity-encoded output. No flaky tests (none exist).

## NEW actionable (deduped at aggregate): S-C3-1/C-C3-1 only. Everything else is residual.
