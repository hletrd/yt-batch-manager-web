# Designer / UI-UX Review — yt-batch-manager-web (cycle 6)

Static markup + render-code evidence (no live agent-browser: the authenticated app needs
real Google OAuth `credentials.json` not available here; the run rules permit text-based
review when a live login is not feasible). Focus: the recording-date/location, license, and
language controls and their state feedback.

## Re-verified
- Recording-date input (`app.ts:460`) is `type=date` with an escaped value and a labelled
  `for`/`id` pair (`:459`). Location inputs (`:464-465`) are `type=number step=any` with
  min/max bounds and `data-i18n-placeholder`. Use-current-location and view-on-map buttons
  have `aria-label` + `data-i18n-title` and SVG icons (`:466-469`). License/default-language
  selects (`:447-453`) are labelled. Accessible and localized.
- en/ko i18n parity holds for the new keys (verified in PROMPT-3 gate check).

## UX observation tied to F1 (NEW finding, owned by code-reviewer)
The per-video "changed" indicator and the Update button appear correctly when a recording
date/license/location/language is edited (change detection covers these fields,
`hasCurrentChanges:321-325`). But on the OAuth-redirect round-trip those specific edits are
silently discarded while the indicator-clearing makes it look intentional. From a UX
standpoint this is the worst kind of loss — no error, the control simply snaps back. The
F1 fix (persist these fields in the temp-changes snapshot) restores the expectation that
"unsaved edits survive the login redirect" advertised by the temp-changes feature. No
separate designer action; covered by the F1 code fix.

No new standalone UI/UX defects this cycle.
