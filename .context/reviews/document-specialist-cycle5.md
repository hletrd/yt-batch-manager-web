# Document-Specialist Review — cycle 5

Scope: doc/code consistency for the new features, against authoritative sources.

## Findings

### E1 corroboration (doc-vs-behavior) — see code-reviewer-cycle5 E1
The in-code comment at `youtube-api.ts:876-879` ("recordingDetails.location is deprecated
but still accepted. Round-trip BOTH so videos.update does not wipe the untouched one ...
An empty date / missing coordinates clears that field") is accurate about the part-replace
semantics but the implementation does NOT match the safe intent: it sends an empty
`recordingDetails: {}` on every save, which clears the date even when the user did not
touch it. The authoritative `videos.update` reference
(developers.google.com/youtube/v3/docs/videos/update) confirms the deletion semantics and
lists only `recordingDetails.recordingDate` as a settable mutable property (location is
not listed there, though the implementation guide example still includes it). Net: the
comment over-promises safety relative to the code. Fixing E1 resolves the mismatch.

### README / docs
- README advertises persistent login ("stays signed in across reloads") — still matches
  the refresh-token behavior (A15 residual). No new mismatch.
- No README mention of the recording-date/location, license, or title/description-language
  editing features yet. This is a documentation completeness gap, not a mismatch. LOW /
  INFO — the README's feature list omits the newest editable fields. Not data/security/
  correctness; recorded as a deferred docs item (exit: next docs pass adds the new
  editable-field list). Consistent with B17's docs-pass deferral pattern.
- PRIVACY.md placeholder contact (A18) unchanged — DEFERRED.

## No other doc/code mismatches found in the new code.
