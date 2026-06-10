# Verifier / critic / tracer / debugger / architect / test-engineer — cycle 5

Single-agent environment (no reviewer subagents registered, no Task/Agent dispatcher;
re-verified: no `.claude/agents/`, no `~/.claude/agents/`, ToolSearch exposes no
Task/Agent tool). These specialist angles are folded here.

## Evidence-based verification of E1 (the one NEW high-signal finding)

Claim: `recordingDetails` part is sent on every save and can delete a video's
recording date.

Evidence chain (traced):
1. `app.ts:2226` builds `updates.recording_date` via `(el?.value) ?? (video.recording_date || '')`.
   When the date element exists (always, in the rendered card), `el.value` is `''` for an
   empty/cleared date → `updates.recording_date === ''` (a string, not undefined).
2. `youtube-api.ts:874` guard: `recording_date !== undefined || latitude !== undefined ||
   longitude !== undefined`. With `recording_date === ''`, `'' !== undefined` → true →
   the `recordingDetails` part is **always** pushed.
3. `youtube-api.ts:881` `if (updates.recording_date)` is falsy for `''`, so
   `recordingDetails.recordingDate` is NOT set → body is `{}` when no location either.
4. Request goes out as `part=snippet,status,recordingDetails` with `recordingDetails: {}`.

Independent reproduction (node simulation): `updates.recording_date=''` → part included
= true → body `{}` sent. Confirmed.

Authoritative API semantics (Context7 → developers.google.com/youtube/v3/docs/videos/update):
"If a property that already has a value is not included in the request, its existing
value will be deleted." + part override semantics. => sending `recordingDetails` part
with no `recordingDate` deletes any existing recordingDate.

Verdict: CONFIRMED correctness/data-loss bug. Severity HIGH (silent loss of a metadata
field the user never edited), Confidence High (mechanism + docs + repro all agree).
This is genuinely NEW — it lives entirely in the recording-date feature added since
cycle 4; cycles 1–4 reviews never covered this code.

## Competing hypotheses considered (tracer)
- H1: "Location is also wiped." Partially mitigated — lat/lng inputs are pre-filled and
  round-tripped (`hasCurrentChanges`/`updateVideo` read element values), so a loaded
  location is re-sent. Residual risk only if a partial coordinate (lat without lng) is
  present, which the `typeof === 'number'` pair-guard drops. Lower severity than the date
  path. Captured as E2.
- H2: "Empty date clearing is intentional." The code comment at `youtube-api.ts:879`
  says "An empty date / missing coordinates clears that field" — so the author intended
  clearing to be possible. The defect is that clearing happens **unconditionally on every
  save** (even title-only edits), not just when the user deliberately blanks a populated
  date. So the fix must preserve intentional clearing while not wiping on incidental
  saves. Confirmed via the change-detection asymmetry: `hasCurrentChanges` only marks a
  video changed when the date input differs from saved, but `updateVideo` sends
  recordingDetails regardless once ANY field changed.

## Regression / failure-mode notes (debugger)
- Batch save (`saveAllChanges` → `updateVideo(videoId, true)`) hits the same path, so a
  bulk title rename across a channel would strip recording dates from every video that
  has one set but no date in the input. Amplifies E1's blast radius.

## Architecture (architect)
- The split of `recording_date` (string, '' for empty) in app.ts vs the `!== undefined`
  guard in youtube-api.ts is the root coupling defect: two layers disagree on what
  "absent" means ('' vs undefined). Aligning the contract (app passes `undefined` for an
  empty date) is the minimal, clean fix and keeps the API layer's guard honest.
- No new god-class growth beyond the already-DEFERRED A11; the new handlers are small and
  consistent with existing patterns.

## Test-engineer
- No test framework exists (client-side TS, tsc-only). The E1 mechanism is exactly the
  kind of thing a unit test on `youtube-api.updateVideo`'s request-body builder would
  catch. Recording a test-gap note (consistent with prior cycles' DEFERRED test posture);
  not introducing a framework this cycle.

## Re-confirmed residuals (still true, already deferred — no downgrade)
A11, A15, A20, A18, A34, A26, A27, A30, A32, B12, B14, B15, B17, C2 — all unchanged.
CSP `script-src 'unsafe-inline'` still required by inline-handler architecture.
