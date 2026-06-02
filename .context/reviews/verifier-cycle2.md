# Verifier / Critic / Tracer / Debugger Review — yt-batch-manager-web (cycle 2)

Evidence-based correctness pass. Critic/tracer/debugger perspectives folded in.
NEW / residual only.

## Findings

### V1 — `updateVideo` re-sends `license`/`embeddable`/`public_stats_viewable` that may be `undefined` on imported videos, but reads them from the live (possibly imported) record (MEDIUM, Medium)
Citation: `src/app.ts:1974-1976` reads `video.license/embeddable/public_stats_viewable`;
`youtube-api.ts:747-755` writes them only `if (updates.x !== undefined)`. On a
YouTube-loaded video these are populated (`youtube-api.ts:645-647`). On a
**file-imported** video they are absent (import coercion at `app.ts:1460-1469` drops
them and the backup filter at `app.ts:1394-1408` strips them before export). So saving
an imported-then-edited video omits these status fields — and per the code's own comment
(`youtube-api.ts:740-743`) "videos.update deletes any status property omitted from the
request." That means saving an imported video could wipe its `license`/`embeddable`/
`publicStatsViewable` on YouTube even though the user only changed the title.

Trace: import → fields undefined → updateVideo builds `updates` with those = undefined →
api skips them → PUT body status omits them → YouTube resets to defaults. Competing
hypothesis: YouTube may treat omitted `status.embeddable` as "no change" rather than
"reset" — the API docs say update is a full replacement of the resource part, so the
omit-means-reset reading is the documented behavior the code itself relies on for
`containsSyntheticMedia`. This is a genuine data-correctness risk for the import-edit-save
path. Fix: when a field is genuinely unknown (imported), re-fetch the live video's
status before save, OR omit `part=status` subfields the user did not touch, OR (simplest)
fetch current status for changed videos. At minimum, document the limitation.
Confidence: Medium (depends on exact API replace semantics; the code already assumes the
risky semantics for synthetic media, so it is self-consistently a risk).

### V2 — `restoreTemporaryChanges` re-applies tags via `handleTagChange` (LOW, Medium)
Citation: `src/app.ts:2126-2133`. After setting `video.tags` and re-rendering, it calls
`this.handleTagChange(videoId)` — but `handleTagChange` reads the tag **input** field and
splits on commas; it does nothing useful here (the input is empty post-render) and does
NOT call `checkForChanges`, so a restored tags-only change may not mark the video changed.
The title/description/etc. branches call their `handleXChange` which do call
`checkForChanges`, so in practice a tags+other change still gets marked; a tags-ONLY
restore might not. Fix: call `checkForChanges(videoId)` after restoring tags. Confidence:
Medium.

### V3 — `A32` residual (restore drops select value when option absent) — STILL TRUE, deferred
Citation: `src/app.ts:2111-2124`. Unchanged; DEFERRED.md (A32).

### V4 — `made_for_kids` is read (`youtube-api.ts:644`) and carried in `VideoData` but never written and never displayed (LOW, Low)
Citation: `types.ts:23`, `youtube-api.ts:644`. After cycle-1 A5 fix it is intentionally
not round-tripped. It is now dead data on the read side (kept only so backups can
preserve it). Harmless; noting for provenance that the field is read-but-unused in UI.

## Sweep
- `parseIsoDuration` regex correct for `P#DT#H#M#S`; `formatDuration` rolls days into
  hours (cycle-1 A21) — verified `P1DT2H3M4S` → 93784s.
- `publishedTime` NaN-guard (A22) correct.
- `isLikelyShort` `<=180s` heuristic documented.
- `videoDiffersFromBaseline` and `hasCurrentChanges` use `|| ''` / `|| false` symmetric
  normalization — consistent.
