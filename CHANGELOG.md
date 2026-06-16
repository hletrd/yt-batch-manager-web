# Changelog

Notable changes to YT Batch Manager Web. The app is continuously deployed to
<https://yt.atik.kr> on every push to `master`, so there are no version tags;
changes are grouped under **Unreleased** in reverse-chronological themes.

The format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
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
