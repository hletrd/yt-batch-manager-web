# Code Review — cycle 5 (code-reviewer angle)

Scope: genuinely NEW / residual findings in code added since cycle 4 — recording
date/location editing (`recordingDetails`), license & title/description language
editing, Shorts vertical detection (`fileDetails`), processing-video thumbnail
placeholder, video-cache thin-data validation, load-ALL-videos
(`maxResults=Infinity`), full JSON backup (unset fields as null), and API
error-message HTML stripping. Baseline gates green: eslint 0, tsc 0, build OK,
i18n parity 131/131.

## E1 — `recordingDetails` part is sent (as `{}`) on EVERY save, which can delete a video's recording date on YouTube — HIGH / High

Citation:
- `src/app.ts:2226` — `recording_date: ((...recording-date-... ) as HTMLInputElement | null)?.value) ?? (video.recording_date || '')` always yields a **string** (`''` for an empty date input) when the element exists.
- `src/youtube-api.ts:874` — `if (updates.recording_date !== undefined || updates.latitude !== undefined || updates.longitude !== undefined) { ... parts.push('recordingDetails'); }`. Because `app.ts` always passes `recording_date` as a string, `'' !== undefined` is **always true**, so the `recordingDetails` part is added on every single-video and batch save.
- `src/youtube-api.ts:880-887` — when the video has no date/location, `recordingDetails` is built as `{}` and still sent with `part=...,recordingDetails`.

Why it is a problem (authoritative): the YouTube Data API `videos.update` reference
states *"If a property that already has a value is not included in the request, its
existing value will be deleted"*, and *"Modifying a part will override existing values
for its mutable properties."* (https://developers.google.com/youtube/v3/docs/videos/update).
So sending the `recordingDetails` part with an **empty** body (no `recordingDate`)
instructs YouTube to **clear the existing `recordingDate`**.

Concrete failure scenario (data loss):
1. A video has a recording date set on YouTube but the local copy does not carry it in
   the date input — e.g. a backup-imported record where `recording_date` was `null`
   (normalized to `undefined` at `app.ts:1623`), or any video where the date input is
   empty.
2. The user edits only the **title** (or privacy, tags, etc.) and clicks Update.
3. `updates.recording_date === ''` → `recordingDetails` part is sent as `{}` →
   YouTube **deletes the video's recording date** even though the user never touched it.

Verified by simulation: `updates.recording_date = ''` → part included = true → body
`{}` sent. (Location is generally safe because the lat/lng inputs are pre-filled and
round-tripped, but the date is the documented data-loss path.)

Suggested fix (one concrete option): only manage `recordingDetails` when the user
actually has a non-empty date or a complete coordinate pair, i.e. gate on the
*effective* values rather than `!== undefined`. Either:
- In `app.ts`, pass `recording_date: undefined` when the input is empty (so the part is
  not added), OR
- In `youtube-api.ts:874`, change the guard to send the part only when there is real
  content: `if (recordingDetails-would-be-non-empty)` — i.e. push the part only when
  `updates.recording_date` is a non-empty string and/or a full coordinate pair is
  present. The safest behavior preserves existing YouTube recordingDetails unless the
  user supplied a value to write.
- Caveat: this means an empty date input no longer *clears* a previously-set date. If
  intentional clearing must remain possible, distinguish "field absent" from "field
  explicitly cleared" (e.g. only send an empty `recordingDetails` when the date input
  was non-empty at load and the user blanked it). The simplest correct fix that avoids
  silent data loss is to NOT send the part when the date is empty.

## E2 — `recordingDetails.location` write is documented only for `recordingDate` in the update reference — MEDIUM / Medium

Citation: `src/youtube-api.ts:884-886` sends `recordingDetails.location`. The
`videos.update` **reference** lists only `recordingDetails.recordingDate` under
"mutable properties you can set"; `recordingDetails.location` is absent there, though
the implementation guide example still shows `location` in the body. This is a
documented inconsistency on Google's side. Practical risk: a future API tightening
could 400 on the `location` write, or silently ignore it. The code's own comment notes
location is deprecated. Recommend: keep round-tripping but treat a `location` write
failure as non-fatal (it currently throws the whole `updateVideo` on any non-ok), and
re-verify against live behavior. LOW practical impact today; flagged for awareness.
Pairs with E1 — fixing E1 (not sending an empty `recordingDetails`) also reduces
exposure here.

## E3 — `made_for_kids` is round-tripped into local state but never sent; selfDeclared semantics — LOW / Medium (re-confirm, not new)

`src/youtube-api.ts:867-871` intentionally does NOT write `selfDeclaredMadeForKids`
(documented reasoning: read-back is the effective value, not the self-declaration).
This is a deliberate, correct decision and matches B15 (DEFERRED). No action; noted so
it is not re-reported as a gap.

## Non-issues verified (so they are not re-reported)
- `getVideos` `maxResults=Infinity`: `Math.min(50, Infinity - n)` = 50 and the loop guard
  `videos.length < maxResults` is correct. OK.
- Tag char counter (`app.ts:559` initial render vs `:1846` update) are consistent
  (sum of tag-text lengths /500). OK.
- `parseIsoDuration` handles the `D` (days) component; `isLikelyShort` falls back to
  duration when dimensions absent. OK.
- Thin-cache discard (`loadVideosFromCache:743-751`) correctly drops thumbnail-less
  caches. OK.
- CSP (`index.html:6`) correctly scopes `connect-src`/`form-action` for the OAuth +
  googleapis flow. OK.
