# Plan 11 — Cycle 6: temporary-changes save/restore drops newer editable fields

Derived from `.context/reviews/_aggregate-cycle6.md`. Repo rules bind this work
(GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push,
gates green: eslint / tsc / build). Per the run's CRITICAL rule this cycle COMMITS
LOCALLY ONLY (no push — push auto-deploys GitHub Pages).

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred (see DEFERRED.md)

## Findings addressed
- F1 (LOW/MEDIUM, conf Medium) — The temporary-changes snapshot
  (`TemporaryFormData` `src/app.ts:21-29`; `saveTemporaryChanges` `:2300-2326`;
  `restoreTemporaryChanges` `:2335-2403`) omits the editable fields added in cycles 4–5:
  `recording_date`, `latitude`, `longitude`, `license`, `default_language`, and the
  pre-existing `contains_synthetic_media`. `saveTemporaryChanges` runs right before the
  OAuth redirect (`authenticate()` `:682`, auth watcher `:681`) to preserve in-progress
  unsaved edits; because these fields are absent from the snapshot, an unsaved edit to any
  of them is silently lost across the login redirect (the control reverts to the original
  value and the per-video change indicator clears). This is LOCAL unsaved-input loss, not
  YouTube-side data loss — but it is a correctness/data-consistency regression introduced
  by the cycle-4/5 feature work, so under the deferred-fix rules (loss of user input) it is
  SCHEDULED, not deferred.

## Tasks

### [x] T1 — Persist and restore the newer editable fields in the temp-changes snapshot
Extend `TemporaryFormData` (`src/app.ts:21-29`) with the missing optional fields:
`recording_date?: string`, `latitude?: number`, `longitude?: number`, `license?: string`,
`default_language?: string`, `contains_synthetic_media?: boolean`.

In `saveTemporaryChanges` (`:2300-2326`):
- Read the live values from the same element ids that `hasCurrentChanges` (`:305-309`) and
  the save collector (`:2218-2228`) use: `recording-date-${id}`, `latitude-${id}`,
  `longitude-${id}`, `license-${id}`, `default-language-${id}`, `synthetic-${id}`.
- Parse coordinates with the existing `parseCoordInput` helper so empty/invalid inputs
  become `undefined` (consistent with the save path); store `recording_date` as the raw
  input string (`''` when empty); store `license`/`default_language` as the select value;
  store `contains_synthetic_media` as the checkbox `checked` boolean.
- Keep these fields out of the snapshot when their input element is absent so an older
  layout still round-trips the original six fields.

In `restoreTemporaryChanges` (`:2335-2403`):
- After restoring the existing fields, set each newer input from the snapshot when the
  field is present (tolerate older snapshots that lack the keys → leave the input as-is),
  then call the matching `handle*Change(videoId)` (`handleRecordingDateChange`,
  `handleLocationChange`, `handleLicenseChange`, `handleDefaultLanguageChange`,
  `handleSyntheticMediaChange`) so change detection re-marks the video. Guard each on the
  element existing and the value actually differing, mirroring the existing restore blocks.

Acceptance:
- Editing ONLY a recording date (or license / latitude+longitude / default language /
  synthetic checkbox) and then triggering the OAuth redirect restores that exact edit after
  the redirect, with the per-video change indicator and Update button re-shown.
- The original six fields still round-trip unchanged.
- A snapshot written by the OLD code (missing the new keys) still restores without error
  (backward-compatible restore).
- eslint / tsc / build green.

Done: `src/app.ts` now (1) extends `TemporaryFormData` with `recording_date?`,
`latitude?`, `longitude?`, `license?`, `default_language?`, `contains_synthetic_media?`;
(2) captures them in `saveTemporaryChanges` from the rendered inputs, spread in only when
the input element exists (older layouts unaffected); (3) restores them in
`restoreTemporaryChanges` guarded by an `in` check (older snapshots leave inputs
untouched) and the value differing, calling the matching `handle*Change` to re-run change
detection.

Design refinement during implementation: coordinates are stored as the raw input STRINGS
(not parsed numbers). A parsed `number | undefined` is dropped by `JSON.stringify` when
empty, which would have lost a "user cleared a previously-set coordinate" edit on restore.
Storing the raw string makes an emptied coordinate round-trip as `''`, so the restore
correctly re-clears the input. Verified by node simulation of three cases — cleared
coordinate (restores to `''`), set values (all six fields preserved through the JSON
round-trip), and an OLD snapshot lacking the keys (inputs left untouched) — and by gates
(eslint 0, tsc 0, build OK).

## Notes
- This is the only NEW scheduled work this cycle. Nothing newly deferred (F1 is loss of
  user input → not deferrable).
- The durable de-duplication of "read a video's form state" into a single helper shared by
  the save collector and the temp-changes collector is the larger A11/A26 refactor already
  deferred; this plan does the bounded, low-risk field-parity fix only.
- All prior-cycle findings (A*/B*/C*/D*/E*) re-verified fixed or correctly deferred.
