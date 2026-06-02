# Plan 05 — Correctness Edge Cases

Sources: A13, A21, A22, A32.

## Tasks

### [x] T1 — Duration parsing handles ISO-8601 days (A21)
`formatDuration`/`parseDurationToSeconds` (`app.ts:111-136`) ignore `P#DT...`. Extend the regex to capture days and include `days*86400` in seconds; format `H:MM:SS` (days roll into hours, or show `D:HH:MM:SS`).
Acceptance: `P1DT2H3M4S` parses to 93784s and formats correctly; existing `PT3M`/`PT1H2M3S` unchanged.

### [x] T2 — Stable sort with missing/invalid published_at (A22)
In `sortAllVideos` (`app.ts:1167-1186`), guard `new Date(x).getTime()` against `NaN` (treat NaN as 0 or as oldest) so imported backups without `published_at` sort deterministically.
Acceptance: array with some empty `published_at` sorts without NaN comparisons; no thrown errors.

### [x] T3 — Tags counter format & limit semantics (A13)
Unify the counter: initial render (`app.ts:517`) and `updateTagsCounter` (`1610-1617`) should use the same format. Base the warning on total tag character count (YouTube ~500-char aggregate) rather than tag count; show e.g. `{usedChars}/500`.
Acceptance: counter format identical on first render and after edits; warning triggers near the real 500-char limit.

### [D] T4 — Restore temp changes safely when option absent (A32) — DEFERRED
Deferred (see DEFERRED.md, A32): rare (requires metadata-load failure AND an
out-of-fallback category/language). Exit criterion stated there.

## Progress
T1 (A21), T2 (A22), T3 (A13) implemented and committed (signed): addd0e3.
T4 deferred (A32). tsc/eslint/build green; duration parse verified (P1DT2H3M4S=93784s).
