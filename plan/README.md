# Plan Directory — yt-batch-manager-web

Plans derived from `.context/reviews/_aggregate.md` (cycle 1). Each finding from the reviews is either scheduled in a plan below or recorded in `DEFERRED.md` with severity preserved and an exit criterion.

## Repo rules that bind all plan work
(From the user's global CLAUDE.md — no project-level CLAUDE.md/AGENTS.md/CONTRIBUTING.md/.cursorrules exist.)
- GPG-sign every commit (`git commit -S`). No `Co-Authored-By`.
- Conventional Commits + gitmoji: `<type>(<scope>): <gitmoji> <description>`.
- Fine-grained commits (one per fix/feature). `git pull --rebase` before push.
- No suppressions (`@ts-ignore`, `eslint-disable`, etc.) unless a repo rule authorizes it.
- Gates that must stay green: `eslint`, `tsc -p tsconfig.json`, `npm run build`.
- Deploy is automatic on push to master (GitHub Pages); do not run a separate deploy.

## Plans
- `01-security-correctness.md` — HIGH/MEDIUM security + data-correctness (A1, A2, A3, A4, A5, A9, A19). NOT deferrable.
- `02-accessibility-i18n.md` — A7, A8, A16, A33, A34, A26(partial i18n).
- `03-performance.md` — A10, A23, A24, A25, A30.
- `04-maintainability-refactor.md` — A11, A26, A27, A28, A12.
- `05-correctness-edge-cases.md` — A21, A22, A32, A13.
- `06-docs.md` — A17, A18, A20(verify+document), A29(tooling warning), A14.
- `07-cycle2-security-correctness-i18n.md` — Cycle 2: B1–B11, B13 (scheduled); B12/B14–B17 deferred.
- `08-cycle3-option-escaping.md` — Cycle 3: C1 (scheduled, option-markup escaping); C2 deferred.
- `09-cycle4-dead-state-and-placeholder.md` — Cycle 4: D1 (dead `saveInProgress` field removal) + D2 (tag-input placeholder escaping consistency); both scheduled, none deferred.
- `10-cycle5-recordingdetails-dataloss.md` — Cycle 5: E1 (HIGH data-loss: empty `recordingDetails` part deletes a video's recordingDate on incidental saves) + E2 (coupled, subsumed by the E1 fix); E3 docs gap deferred.
- `DEFERRED.md` — findings intentionally not scheduled (with reasons + exit criteria); cycle-1 (A*), cycle-2 (B*), cycle-3 (C*), cycle-5 (E3).

## Cycle 2 note
Cycle-1 plans 01–06 are fully implemented (T-items marked `[x]`/`[D]`); they remain for
provenance and are effectively archived. Cycle-2 work lives in Plan 07, derived from
`.context/reviews/_aggregate-cycle2.md`, and is fully implemented (archived).

## Cycle 3 note
The repo has materially stabilized: all A* and B* findings re-verified as fixed/deferred.
Cycle-3 found only two LOW findings. Work lives in Plan 08, derived from
`.context/reviews/_aggregate-cycle3.md`: C1 scheduled (option-markup escaping), C2
deferred (DEFERRED.md).

## Cycle 4 note
Convergence continuing: all A*/B*/C* findings re-verified as fixed/deferred. Cycle-4
found only one LOW (D1, dead `saveInProgress` field) and one INFO (D2, tag-input
placeholder escaping consistency — not attacker-reachable). Both scheduled in Plan 09;
nothing newly deferred. Derived from `.context/reviews/_aggregate-cycle4.md`.

## Cycle 5 note
Reviewed the features added since cycle 4. One genuinely NEW HIGH data-loss bug found
in the recording-date feature: `youtube-api.ts` sent the `recordingDetails` part with an
empty body on every save (because `app.ts` passes an empty date as `''`, not `undefined`),
which — per the authoritative `videos.update` part-replace semantics — silently deletes a
video's recordingDate when the user edits an unrelated field. Scheduled and fixed in
Plan 10 (E1; E2 coupled and subsumed). E3 (README feature-list completeness) deferred.
All prior A*/B*/C*/D* findings re-verified fixed/deferred. Derived from
`.context/reviews/_aggregate-cycle5.md`.

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred (see DEFERRED.md)
