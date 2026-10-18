# Changelog

Notable changes to YT Batch Manager Web. The app is continuously deployed to
<https://yt.atik.kr> on every push to `master`, so there are no version tags;
changes are grouped under **Unreleased** in reverse-chronological themes.

The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
- **Save All no longer repeats a failure every video shares.** When the first 3
  attempts fail for the same reason (e.g. a channel that may not set custom
  thumbnails), the rest are not sent — failed requests use quota too. A lasting
  notice itemizes what was fully saved, what saved only its details (thumbnail
  still pending), what failed and what was not attempted, with the reasons.
- **Recovery from a batch save cut short by the API quota.** Save All stops at
  the first `quotaExceeded` instead of failing every remaining video, keeps the
  unsaved changes (including pending thumbnails) in the browser, shows how many
  were saved and when the quota resets in local time, and offers to restore them
  on the next load. Hitting the thumbnail upload limit holds back only the
  thumbnails.
- ZIP thumbnails are compared **visually** with YouTube's current thumbnail
  when their bytes differ, so a re-encoded or re-saved copy of an unchanged
  image is not uploaded again, while small edits are still detected.
- **Batch-replace thumbnails via a ZIP backup.** *Save as ZIP* exports
  `videos.json` plus every video's current thumbnail; replace images, load the
  ZIP back, and the changed ones (detected by SHA-256) are uploaded on save,
  shown as pending until then. Thumbnail-only changes skip the metadata update.
- Edit **embedding**, **public stats** and **made for kids** per video and via
  JSON (made-for-kids is written as the self-declaration, only when changed).
- JSON imports may be **partial**: fields a record omits keep the current
  YouTube values. Tags may be a comma-separated string.
- Edit the **recording date** and **recording location** (latitude/longitude)
  per video, with a use-current-location button and a view-on-map link.
- Change the **license** (Standard YouTube License / Creative Commons) and the
  **title/description language**.
- Read-only **"Made for kids"** badge on video cards (the COPPA designation is
  shown but never written back).
- **Shorts** badge for likely Shorts (vertical/square and ≤3 minutes).
- One-click **copy tags** to the clipboard.
- Loads **every** video in the channel instead of capping at 200.
- JSON export now includes **every editable field** (unset values as `null`) so
  a backup doubles as a fill-in template.
- **End-to-end test suite** (`e2e/`): Playwright flows against a mocked
  Google/YouTube backend — OAuth+PKCE, token exchange, load chain, rendering,
  `videos.update` bodies, 401 refresh-retry, cache reload, quota-403, logout.
- **`AGENTS.md`** knowledge base documenting the architecture and the YouTube
  Data API gotchas the app works around.

### Fixed
- The offer to restore kept changes no longer reappears for changes that
  already reached YouTube some other way; quota messages now say the quota is
  shared by everyone using the app.
- **Titles containing `"` were cut off at the quote** in the card, so the card
  showed as changed without an edit and saving it sent the truncated title to
  YouTube. Descriptions with a leading newline or CRLF line breaks likewise
  showed as changed; they are now kept exactly.
- **Saved results now reach the local cache from imported sets too**, so a
  reload no longer shows pre-save values (which a refresh could not correct
  while the quota was exhausted). The cache is written from what YouTube has,
  never from unsaved edits.
- **Saving a scheduled video no longer cancels its schedule.** `status.publishAt`
  is now read, round-tripped while the video is private, exported as
  `publish_at`, and shown as a badge. Caches from older versions are discarded.
- **Save All reports failures.** Rejected saves were counted as successful; the
  summary now counts them and shows the first error.
- JSON edits to `embeddable`, `public_stats_viewable` and `made_for_kids` were
  silently ignored; a partial JSON record blanked the description and tags and
  reset privacy to private; a category/language id missing from the dropdown
  list was dropped on save.
- The per-card thumbnail upload accepts up to 50 MB (the API's current limit),
  and its local preview now renders (the CSP blocked `blob:` images).
- **Stay signed in across reloads.** The OAuth refresh token is now persisted
  (previously only the 1-hour access token was kept), with PKCE (S256) and
  silent token refresh, so sessions no longer drop every hour.
- **Saving a video no longer fails with `400 "Request metadata is invalid"`.**
  An unset title/description or audio language was sent as an empty string,
  which is not a valid BCP-47 code and rejected the whole request; empty
  language codes are now omitted. *(Verified against a live account.)*
- **Saving no longer silently wipes fields.** `videos.update` deletes any
  property omitted from a requested part, so the app round-trips existing status
  fields, only attaches `recordingDetails` when the date/location actually
  changed (preventing an empty body from deleting the recording date), and still
  propagates an intentional clear.
- **Imported-backup saves preserve unknown status fields** by backfilling the
  live `status` before the update.
- Fixed videos failing to load and blank thumbnails (stopped requesting the
  restricted `fileDetails` part inline; discard a thin/thumbnail-less cache).
- Quota exhaustion fixed by listing uploads via `playlistItems` (~9 units/load)
  instead of `search.list` (100 units/call); friendly localized quota message
  with HTML stripped from API errors.
- Unsaved edits (including the newer fields) now survive the OAuth login
  redirect.
- Project title corrected to **YT Batch Manager**.

### Changed
- Upgraded to **TypeScript 6** and refreshed all dependencies (ESLint 10, etc.);
  fixed the deprecated `moduleResolution` that had been breaking CI builds.
- Decomposed the ~2,600-line `YouTubeBatchManager` god class into **15
  single-purpose ES modules** orchestrated by a thin `app.ts` facade, with
  byte-identical rendering and an unchanged public method surface.
- Typed the consumed YouTube API response shapes (removed `any` from the API
  layer); replaced render-timing `setTimeout`s with `requestAnimationFrame` and
  throttled textarea auto-resize.

### Security
- Sanitize imported video ids and thumbnail URLs; escape category/language
  option markup and the tag-input placeholder in the render path.
- Add `rel="noopener noreferrer"` to external links; minimize the OAuth scope to
  `youtube.force-ssl`; document locking the GCP client's authorized
  origins/redirect URIs (which neutralizes the browser-exposed `client_secret`
  under PKCE).
- Removed the inert `frame-ancestors` directive from the `<meta>` CSP (ignored
  outside an HTTP header).
