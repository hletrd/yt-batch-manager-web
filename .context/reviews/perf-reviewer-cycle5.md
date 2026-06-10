# Performance Review — cycle 5

Scope: new feature code since cycle 4. Baseline gates green.

## No new performance findings worth scheduling

- `getVideos` now pages the uploads playlist with `maxResults=Infinity` until
  `nextPageToken` is exhausted. Cost: 1 quota unit per `playlistItems` page + 1 per
  `videos.list` page + 1 per `fileDetails` page (`applyVideoDimensions`). For a large
  channel this is more requests than the old 200-cap, but each is cheap (1 unit) and the
  loop is sequential and awaited — no unbounded parallel fan-out. Acceptable and
  intentional (documented at `youtube-api.ts:558-560`). The extra `fileDetails` call per
  page (`applyVideoDimensions:687`) roughly doubles request count for the load; it is
  best-effort and swallowed on failure. Minor; not a regression worth a fix this cycle.
- Render path: batch textarea sizing + counters + i18n sweep are coalesced into a single
  `requestAnimationFrame` (`app.ts:597`). Good — this is the perf-correct pattern.
- `videoIndex` Map keeps per-keystroke `getVideo` lookups O(1). `cachedChannelId`
  in-memory avoids re-parsing the cache on every save. Both good.
- `updateVideoCache` re-serializes `allVideos` to localStorage on each single save; for a
  full-channel load this can be a large JSON write per save, but `skipCacheUpdates`
  suppresses it during batch saves and writes once at the end (`saveAllChanges:1487`).
  Acceptable.

## Residual (already deferred)
A30 textarea reflow per keystroke; P2 `updatePageTexts` whole-document sweep — unchanged,
DEFERRED. No new perf regression introduced by the cycle-5 feature code.
