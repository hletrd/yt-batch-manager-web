# AGENTS.md — yt-batch-manager-web

Knowledge base for working on this repository. Read this before changing the
save path, the OAuth flow, or the build. User-facing docs live in `README.md`;
this file is the "why it's built this way" companion.

## What this is

A **client-side-only** TypeScript SPA that batch-edits a YouTube channel's video
metadata (title, description, tags, privacy, category, languages, license,
recording date/location, AI-content disclosure) in one page. It talks directly
to the YouTube Data API v3 from the browser. There is no backend.

- Live: <https://yt.atik.kr> — auto-deploys from `master` via
  `.github/workflows/deploy.yml` (GitHub Pages). **Pushing to `master` deploys
  to production.**
- Build: `tsc` only, **no bundler**. Output in `dist/` is native browser ES
  modules loaded with `<script type="module">` and `.js`-extension imports.
- No test framework; end-to-end coverage is Playwright scripts in `e2e/`
  against a mocked Google/YouTube backend (see README → End-to-end tests).

## Architecture

`src/app.ts` is the `YouTubeBatchManager` facade, exposed as `window.app`. The
rendered card HTML uses inline `onclick="app.X()"` handlers, so **the public
method surface of `app` is an API contract** — renaming/removing a public method
or changing a DOM id/class breaks the live handlers. The rest of `src/` is small
single-purpose modules (see the table in `README.md` → Source layout). All
network and auth logic is isolated in `src/youtube-api.ts`.

State that persists in `localStorage`:

| Key | Contents |
| --- | --- |
| `youtube_access_token` / `youtube_token_expiry` / `youtube_refresh_token` | OAuth session |
| `oauth_code_verifier` / `oauth_state` | PKCE handshake (transient) |
| `yt_video_cache` | Last loaded video set (24h TTL; versioned — bump `CACHE_VERSION` in `video-cache.ts` when a missing field would be misread) |
| `yt_temp_form_changes` | Unsaved edits stashed across the OAuth redirect |
| `theme` | Light/dark preference |

Pending (unsaved) thumbnails from a ZIP import live only in memory
(`thumbnailPreviews` in `app.ts`); they do not survive a reload or the OAuth
redirect — except when a save is cut short by the quota (rule 11), which
persists all unsaved changes to IndexedDB (`yt-batch-manager` /
`unsaved-changes`, see `unsaved-changes.ts`) until they are saved, discarded, or
the user logs out.

The video cache mirrors YouTube: it is written from the baselines
(`originalVideosState`), never from live records with unsaved edits. For an
imported set it is patched by id (`patchCachedVideos`) instead of replaced.

**Backups (JSON / ZIP).** `backup.ts` shapes the JSON export and sanitizes
imports; `backup-zip.ts` adds thumbnails; `utils/zip.ts` is a dependency-free
ZIP reader/writer. Imports are merged with the loaded YouTube baseline: a field
a record omits, or sets to an invalid value, keeps the baseline value, and
read-only display fields (statistics, upload status, …) are taken only from the
baseline, never from the file. Change detection (`videoDiffersFromBaseline` for
records, `hasCurrentChanges` for rendered cards) must cover every field the
JSON can carry — a field missing there is silently not saved.

## YouTube Data API gotchas (the load-bearing knowledge)

These are non-obvious behaviors that have each caused a real bug. Preserve the
workarounds.

1. **`videos.update` replaces a whole `part` and deletes any omitted property.**
   When updating `status`, you must re-send every mutable status field you want
   to keep (`license`, `embeddable`, `publicStatsViewable`, `publishAt`, …) or it
   gets wiped. For videos imported from a file with no YouTube baseline
   (`unverifiedStatusIds`), the app backfills whatever the file left unset from
   the live `status` via `getVideoStatus` before the first save.

2. **Empty values are not "clear" — some are hard errors.** An empty language
   code (`snippet.defaultLanguage: ""` or `defaultAudioLanguage: ""`) is not a
   valid BCP-47 code and makes the **entire** request fail with
   `400 "Request metadata is invalid"` (a deceptive error — it blocks title,
   description, everything). The app only sends a language field when it carries
   a real code. There is no way to set these back to empty via the API.
   *(Confirmed against a live account: saving a language-unset video succeeds.)*

3. **`recordingDetails` empty-body wipes the date.** Because of rule 1, attaching
   a `recordingDetails` part with an empty body deletes an existing
   `recordingDate`. The app sends the `recordingDetails` part **only when the
   user actually changed the date/location vs. the saved baseline**
   (`recording_details_changed` flag from `video-form.ts`). A genuine clear
   sends an empty body on purpose; an incidental (title-only) save omits the
   part entirely.

4. **`recordingDetails.location` (lat/lng) is deprecated.** It's still accepted
   by `videos.update` without error but may not surface in Studio. Don't treat a
   missing location in Studio as a bug.

5. **`fileDetails` and `processingDetails` are owner-only/restricted.**
   Requesting `fileDetails` inline with the main `videos.list` makes the whole
   batch `403` if any video can't expose it. The app fetches `fileDetails`
   separately and best-effort (`applyVideoDimensions`), only to tell vertical
   Shorts apart; failure is swallowed and the Shorts heuristic falls back to
   duration.

6. **Don't `search.list` to enumerate uploads — it costs 100 units/call.** The
   app reads the channel's uploads playlist via
   `channels.list(contentDetails)` → `playlistItems.list` (1 unit/page), keeping
   a full load to ~9 units against the 10,000/day quota.

7. **`selfDeclaredMadeForKids` must never be round-tripped.** The readable
   `status.madeForKids` is the *effective* value, not the creator's
   self-declaration; writing it back on every save could flip a video's COPPA
   designation. The made-for-kids control (card select / JSON `made_for_kids`)
   writes `selfDeclaredMadeForKids` **only when the user changed it vs. a known
   baseline** (`madeForKidsChanged` in `video-form.ts`); otherwise the field is
   omitted, which leaves the self-declaration untouched. YouTube may still
   override the effective value.

8. **Web OAuth clients still require `client_secret` even with PKCE.** Google's
   "Web application" client type rejects the token exchange without the secret,
   so it ships to the browser. PKCE (S256) is enforced and the GCP client's
   authorized origins/redirect URIs are locked to the deploy domain, which is
   what keeps the exposed secret from being independently usable. Scope is
   minimized to `youtube.force-ssl` only.

9. **`status.publishAt` (scheduled publishing) must be round-tripped — but only
   while the video stays private.** Omitting it cancels the schedule (rule 1);
   sending it on a non-private video is rejected. `collectVideoUpdates` drops it
   once the video is made public/unlisted (and the record forgets it, so going
   back to private does not resurrect a stale schedule). Values are normalized
   with `normalizeTimestamp` so API and file values compare equal.

10. **`thumbnails.set`: JPEG/PNG up to 50 MB (was 2 MB), ~50 quota units, verified
    channels only** (`403` otherwise; `uploadRateLimitExceeded` after many uploads
    in a day). A ZIP import therefore uploads only images whose SHA-256 differs
    from the `thumbnail_sha256` recorded at export, and a thumbnail-only change
    skips `videos.update`. Exports read thumbnails cross-origin from
    `i.ytimg.com` (it sends `Access-Control-Allow-Origin: *`; CSP `connect-src`
    allows `https://*.ytimg.com`), and local previews are `blob:` URLs (CSP
    `img-src` must keep `blob:`). YouTube's CDN serves the old image for a while
    after an upload, so the uploaded image keeps being shown/exported locally.
    YouTube also **re-encodes** every thumbnail, so a byte hash alone flags the
    user's own copy of an unchanged image as changed: an image whose hash differs
    is compared *visually* (`image-compare.ts`, 160x90 cells cover-fitted to 16:9)
    with YouTube's current maxres/standard thumbnail (or the one uploaded this
    session). The thresholds are calibrated so a small edit (one changed digit)
    still counts as changed — missing an edit is worse than a spare upload — and
    smaller sizes (medium/high) are too blurry to serve as the reference.

11. **Quota is per Google Cloud project (default 10,000 units/day, reset at
    midnight Pacific Time) and a batch can exhaust it partway.** A
    `videos.update` is 50 units, `thumbnails.set` ~50. Errors therefore carry
    YouTube's reason (`YouTubeApiError.reason`): on `quotaExceeded` /
    `dailyLimitExceeded` Save All stops (every further call would fail); on
    `uploadRateLimitExceeded` (per-channel thumbnail limit, rolling 24 h) it holds
    back the remaining thumbnails but keeps saving metadata. Either way the
    leftovers are persisted (`keepUnsavedChanges`) as backup-format records and
    offered back after the next load, re-applied through the same
    baseline-merging sanitizer as an import.

## Build / test / deploy

```bash
npm run build              # tsc + copy assets + generate docs (about/privacy/terms html)
npm run lint               # eslint src/**/*.ts
npx tsc -p tsconfig.json   # type-check only
# E2E: see README → End-to-end tests (mocked backend, no credentials needed)
```

Quality gates that must stay green before any commit: `tsc` (0 errors),
`eslint` (0 errors), `npm run build`, and the `e2e/` suites.

## Conventions

- **Commits:** GPG-sign (`-S`), Conventional Commits + gitmoji
  (`type(scope): :emoji: description`), fine-grained (one concern per commit),
  no `Co-Authored-By`. `git pull --rebase` before `git push`.
- **Pushing `master` deploys to production** — only push when intending to ship.
- **i18n:** every user-facing string has a key in *both* `src/i18n/en.json` and
  `src/i18n/ko.json` (kept at parity).
- **No new dependencies / bundler** without good reason — the no-build-step,
  direct-ES-module model is intentional.
- Generated docs (`about.html`, `privacy.html`, `terms.html`) come from
  `README.md` / `PRIVACY.md` / `TERMS.md` via `build-docs.js`; edit the markdown,
  not the HTML.
