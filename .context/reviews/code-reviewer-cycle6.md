# Code Review — yt-batch-manager-web (cycle 6, code-reviewer angle)

Scope: full repo re-review, with emphasis on the recording-date/location, license,
and title/description-language editing features (cycles 4–5) and how they interact with
the cross-cutting persistence paths (cache, JSON backup, temporary-changes save/restore).
Baseline gates green at cycle start: eslint 0/0, tsc 0, build OK.

## NEW finding

### F1 (LOW/MEDIUM, conf Medium) — Temporary-changes save/restore drops the newer editable fields
- Citation:
  - `src/app.ts:21-29` (`TemporaryFormData` shape) — only `title, description,
    privacy_status, category_id, defaultAudioLanguage, tags`.
  - `src/app.ts:2300-2326` (`saveTemporaryChanges`) — writes only those fields.
  - `src/app.ts:2335-2403` (`restoreTemporaryChanges`) — restores only those fields.
- Problem: the editable fields added in cycles 4–5 — `recording_date`, `latitude`,
  `longitude`, `license`, and `default_language` (and the pre-existing
  `contains_synthetic_media`) — are NOT included in the temporary-changes snapshot.
  `saveTemporaryChanges` runs right before the OAuth redirect (`authenticate()` at
  `app.ts:682`, and the auth-watcher at `:681`) to preserve in-progress unsaved edits
  across the login round-trip; `restoreTemporaryChanges` re-applies them after reload.
  Because the snapshot omits the newer fields, any unsaved edit to those fields is lost
  on the redirect.
- Failure scenario: a user whose access token has expired (or who is mid-login) edits a
  video's recording date / license / recording location / title-or-description language,
  then triggers the OAuth redirect (clicks Authenticate, or an auto refresh redirects).
  On return, the title/description/privacy/category/tags edits are restored, but the
  recording-date/license/location/language edits silently revert to the original values
  and the per-video "changed" indicator clears. Silent loss of in-progress user input.
- Note on the guard: `saveTemporaryChanges` line 2316 gates on the existence of the
  title/description/privacy/category/language elements (always present for a rendered
  video) OR non-empty tags. So a video changed ONLY via a recording-date/license/coords
  edit still produces a `changed[videoId]` entry — but that entry carries none of the
  actually-changed field, so the restore is a no-op for it. This confirms the loss is
  silent (no error, entry present but empty of the relevant field).
- Scope: this is loss of LOCAL, UNSAVED edits (never written to YouTube), confined to the
  OAuth-redirect path and the 5 newer fields (plus the pre-existing synthetic checkbox).
  It is NOT YouTube-side data loss; the live video is untouched. Self-limited.
- Suggested fix: extend `TemporaryFormData` with the missing optional fields
  (`recording_date?`, `latitude?`, `longitude?`, `license?`, `default_language?`, and
  `contains_synthetic_media?`); read them in `saveTemporaryChanges` from the rendered
  inputs (the same element ids used by `hasCurrentChanges` at `:305-309`); and re-apply
  them in `restoreTemporaryChanges`, calling the matching `handle*Change` to re-run
  change detection. Keep the restore tolerant of missing fields (older snapshots).
- Confidence: Medium — the code paths are unambiguous; the residual uncertainty is only
  how often a user edits exactly these fields immediately before an OAuth redirect.

## Re-verified (still correct, NOT re-reported)
- E1 (cycle 5 HIGH data-loss) fix in `src/youtube-api.ts:886-896` is present and correct:
  `recordingDetails` is built first and the part is pushed only when the body is non-empty,
  so an empty date input no longer wipes an existing `recordingDate`. A real date / full
  coord pair is still written.
- Import sanitization (`app.ts:1594-1636`): 11-char id allowlist, privacy allowlist,
  null→undefined normalization for optional fields, thumbnail URL scheme filtering — all
  sound.
- `updateVideo` status round-trip comments (`youtube-api.ts:851-871`) correctly justify
  re-sending license/embeddable/public_stats_viewable and NOT writing
  selfDeclaredMadeForKids.
- `parseCoordInput` (`app.ts:1932-1938`) and the both-coords-required guard in
  `updateVideo` (`:890`) are internally consistent.

No other new code-quality defects found this cycle.
