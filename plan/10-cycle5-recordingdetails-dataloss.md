# Plan 10 — Cycle 5: recordingDetails data-loss fix

Derived from `.context/reviews/_aggregate-cycle5.md`. Repo rules bind this work
(GPG-signed commits, Conventional Commits + gitmoji, no `--no-verify`, no force-push,
gates green: eslint / tsc / build). Per the run's CRITICAL rule this cycle COMMITS
LOCALLY ONLY (no push — push auto-deploys GitHub Pages).

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred (see DEFERRED.md)

## Findings addressed
- E1 (HIGH/High) — `recordingDetails` part sent (often as empty `{}`) on every save →
  silently deletes a video's `recordingDate` on YouTube. DATA LOSS, NOT deferrable.
- E2 (MEDIUM/Medium) — `recordingDetails.location` write + non-fatal handling; subsumed
  by the E1 fix (don't send the part without real content).
- E3 (LOW/INFO) — README feature-list completeness → DEFERRED (DEFERRED.md).

## Tasks

### [x] T1 — Stop sending an empty `recordingDetails` part (E1 root-cause fix)
Root cause: two layers disagree on what "absent" means. `app.ts` passes
`recording_date` as `''` for an empty date input; `youtube-api.ts:874` then treats
`'' !== undefined` as "manage recordingDetails" and pushes the part with an empty body,
which deletes the existing `recordingDate` on YouTube (authoritative `videos.update`
part-replace semantics).

Fix (in `src/youtube-api.ts updateVideo`): only add the `recordingDetails` part when the
request would actually carry content — i.e. a non-empty `recordingDate` and/or a complete
numeric coordinate pair. Build the `recordingDetails` body first, then push the part and
attach the body ONLY if it is non-empty. This preserves an existing recordingDate when the
user did not supply one, and still writes a date/location the user did set.

Acceptance:
- A save of a video with an empty date input and no coordinates does NOT include
  `recordingDetails` in `part` and does NOT send a `recordingDetails` body.
- A save with a real date still writes `recordingDate`.
- A save with a full lat/lng pair still writes `location`.
- eslint / tsc / build green.

Done: `src/youtube-api.ts` now constructs `recordingDetails` first and pushes the part /
attaches the body only when `Object.keys(recordingDetails).length > 0`. An empty date and
missing coordinates leave `recordingDetails` out of the request entirely, so an existing
recordingDate is preserved on incidental (e.g. title-only) saves. Verified by node
simulation (empty date → part omitted; real date → recordingDate sent; full pair →
location sent) and by gates (eslint 0, tsc 0, build OK).

### [x] T2 — Make the location write non-fatal is NOT needed separately (E2)
Re-evaluated: with T1, `recordingDetails` (including `location`) is only sent when the
user actually provided values, so the previous always-on exposure is gone. A genuine
`location` write rejection would still surface as a normal update error to the user, which
is acceptable and informative (the user did supply a location). No separate code change;
the E2 residual is reduced to "future API tightening could reject a user-supplied location
write," which is correct behavior to surface. No further action.

## Notes
- This is the only NEW scheduled work this cycle. E3 deferred. All prior-cycle findings
  re-verified fixed/deferred.
