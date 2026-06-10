# Aggregate Review — yt-batch-manager-web (cycle 7)

Specialist angles covered this cycle (folded into this single aggregate for
provenance, since no nestable Agent/Task dispatcher and no `.claude/agents/`
reviewer agents are registered in this environment — re-verified below):
code-review, perf, security, critic, verifier/tracer/debugger, architect,
test-engineer, designer, document-specialist.

## Baseline gates (whole repo) at cycle-7 start
- `eslint "src/**/*.ts"` = 0 errors / 0 warnings.
- `tsc -p tsconfig.json --noEmit` = 0 errors.
- `npm run build` = success (tsc + html/i18n/docs copy + build-docs).
- i18n parity: en.json 131 keys, ko.json 131 keys, 0 missing either direction.

## Scope
Focused on the surface changed in cycles 5–6 and its cross-cutting interactions,
since the rest of the repo was exhaustively reviewed in cycles 1–6 and re-verified
fixed/deferred there:
- The cycle-6 F1 fix (Plan 11): `TemporaryFormData` (`src/app.ts:21-39`),
  `saveTemporaryChanges` (`:2311-2360`), `restoreTemporaryChanges` (`:2362-2486`).
- Change detection `hasCurrentChanges` / `checkForChanges` (`:309-339`, `:1951-1985`).
- `updateVideo` update-collector (`:2180-2284`) and `parseCoordInput` (`:1943-1949`).
- The `recordingDetails` request-build path in `youtube-api.ts` (`:874-896`) and the
  lat/lng/recording_date read-back (`:656-658`).

## Deduplicated NEW findings (highest severity preserved; cross-agent agreement)

| ID | Severity | Conf | Title | Agreeing reviewers |
|----|----------|------|-------|--------------------|
| (none) | — | — | No genuinely new issue found this cycle. | code, perf, security, verifier/tracer/debugger, architect, test-engineer, designer, document-specialist |

## Verification of the cycle-6 F1 fix (re-confirmed correct and complete)
- `TemporaryFormData` extended with `recording_date?`, `latitude?` (string),
  `longitude?` (string), `license?`, `default_language?`,
  `contains_synthetic_media?` (`src/app.ts:33-38`). Coordinates stored as raw
  STRINGS, so a cleared coordinate round-trips as `''` through `JSON.stringify`
  instead of being dropped (a parsed `number | undefined` would be lost). Correct.
- `saveTemporaryChanges` (`:2334-2351`) spreads each newer field in ONLY when its
  input element exists, so an older layout still round-trips the original six fields.
- `restoreTemporaryChanges` (`:2408-2459`) guards each newer field with an `in`
  check (older snapshots leave the input untouched) and a value-differs check,
  then calls the matching `handle*Change` so change detection re-marks the video.
- `hasCurrentChanges` (`:309-339`) and `checkForChanges` (`:1951-1985`) already
  compare ALL the newer fields against the original snapshot, so a restored edit is
  correctly re-flagged and an un-edited field is not falsely flagged.

## Edge cases examined and found NOT to be new bugs
- `saveTemporaryChanges` entry guard (`:2333`) lists only the original five element
  refs (`titleEl || descriptionEl || privacyEl || categoryEl || languageEl ||
  currentTags.length > 0`), not the newer ones. NOT a loss path: every video card
  renders title/description/etc. together with the newer inputs, so whenever a newer
  input exists the original ones exist too and the guard is true. No reachable case
  where only a newer field is present.
- Coordinate clear-on-save: clearing both lat/lng with no recording_date yields an
  empty `recordingDetails` body, so the part is not attached and the existing
  location is NOT deleted on YouTube. This is the SAME deliberate "don't send an
  empty part" design accepted in cycle 5 (E1/E2) to avoid wiping data on incidental
  saves — a documented limitation, not a new regression. Clearing a recording_date
  while a location remains populated still attaches the part and re-sends the
  location (preserved); the date-only-clear with no location is the documented
  can't-clear-via-empty-part limitation.
- Lat/lng/recording_date are read back from the API (`youtube-api.ts:656-658`) and
  pre-fill the inputs (`app.ts:471,475-476`), so an incidental save of an unrelated
  recordingDetails field re-sends the loaded value and does not wipe it.
- `restoreTemporaryChanges` location restore compares against `formData.latitude || ''`
  without `.trim()`, whereas `hasCurrentChanges` trims; harmless because the restore
  sets the value then immediately calls `handleLocationChange` → `checkForChanges`,
  which re-evaluates with the trimmed comparison. No false/missed change state.

## Residual (re-confirmed STILL TRUE — already deferred/by-design, NOT re-counted)
- A11 god-class / string-HTML render; A15 refresh token in localStorage; A20
  client_secret in browser (PKCE enforced); A18 PRIVACY.md placeholder contact;
  A34 docs lang=en; A26 DRY dedup; A27 API-response `any`; A30/A28 textarea reflow +
  setTimeout timing; A32 restore-select.
- B12 shallow snapshot; B14 static html lang; B15 made_for_kids read-but-unused
  (by design); B17 README import-trust note.
- C2 imported-records cache pollution (latent, self-healing).
- E3 README feature-list completeness (docs, deferred cycle 5).
- F1 (cycle 6) — FIXED in Plan 11 (verified above).
- CSP `script-src 'unsafe-inline'` required by inline-handler architecture; P2
  `updatePageTexts` whole-doc sweep — residuals.

## Convergence
No new finding scheduled or deferred this cycle. The repo is in a converged state:
all A*/B*/C*/D*/E*/F* findings are fixed or correctly deferred with severity
preserved, and all gates are green. Correct outcome: NEW_FINDINGS = 0, COMMITS = 0.

## AGENT FAILURES
No dedicated reviewer subagents are registered (no project `.claude/agents/`, no
`~/.claude/agents/`, ToolSearch exposes no Task/Agent dispatcher — re-verified this
cycle). Per the prompt's "skip any that are not registered," the fan-out was
performed as separate specialist passes by the single available agent rather than
silently dropping coverage. The designer pass used static markup + render-code
evidence (no live agent-browser) because the authenticated app requires real Google
OAuth `credentials.json` not available here, as the prompt permits for non-multimodal
review. No partial/failed agent output to report.
