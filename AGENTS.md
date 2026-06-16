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
| `yt_video_cache` | Last loaded video set (24h TTL) |
| `yt_temp_form_changes` | Unsaved edits stashed across the OAuth redirect |
| `theme` | Light/dark preference |

## YouTube Data API gotchas (the load-bearing knowledge)

These are non-obvious behaviors that have each caused a real bug. Preserve the
workarounds.

1. **`videos.update` replaces a whole `part` and deletes any omitted property.**
   When updating `status`, you must re-send every mutable status field you want
   to keep (`license`, `embeddable`, `publicStatsViewable`, …) or it gets wiped.
   For videos imported from a backup (which lacks these), the app backfills the
   live `status` via `getVideoStatus` before saving.

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
   self-declaration; writing it back could flip a video's COPPA designation. The
   UI shows made-for-kids read-only and never writes the field.

8. **Web OAuth clients still require `client_secret` even with PKCE.** Google's
   "Web application" client type rejects the token exchange without the secret,
   so it ships to the browser. PKCE (S256) is enforced and the GCP client's
   authorized origins/redirect URIs are locked to the deploy domain, which is
   what keeps the exposed secret from being independently usable. Scope is
   minimized to `youtube.force-ssl` only.

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
