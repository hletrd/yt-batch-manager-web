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
- `DEFERRED.md` — findings intentionally not scheduled this cycle (with reasons + exit criteria).

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred (see DEFERRED.md)
