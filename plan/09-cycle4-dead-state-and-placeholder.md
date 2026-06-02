# Plan 09 — Cycle 4: Dead state removal & placeholder escaping consistency

Source: `.context/reviews/_aggregate-cycle4.md` (findings D1, D2). The repository remains
materially stabilized; cycle-4 found only one LOW and one INFO finding. Both are
scheduled below — no finding is silently dropped and nothing new is deferred this cycle.

Repo rules binding this work (from user global CLAUDE.md; no project CLAUDE.md/AGENTS.md):
GPG-signed commits (`git commit -S`), Conventional Commits + gitmoji, fine-grained
commits (one per fix), `git pull --rebase` before push, no suppressions, gates green
(eslint, tsc, build), deploy auto on push (no separate deploy).

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred

## Tasks

### [x] T1 — Remove dead `saveInProgress` field (D1, LOW; code + verifier/critic/tracer)
Problem: `app.ts:50` declares `private saveInProgress: Set<string> = new Set();` which is
never read or written anywhere in the codebase (grep confirms no `saveInProgress.add/
delete/has`). It is distinct from the live `batchSaveInProgress` flag and from the
unrelated `status.saveInProgress` i18n key. It has been unused since the initial commit
and is a false-affordance smell (implies a per-video save guard that does not exist;
single-video re-entrancy is in fact bounded by `updateBtn.disabled`).
Fix: delete the field declaration. Pure non-behavioral cleanup.
Acceptance: field removed; no other reference exists; tsc + eslint + build green; i18n
parity preserved (117/117).

### [x] T2 — Escape tag-input placeholder for render-path consistency (D2, INFO; code + security + designer)
Problem: `renderTagsContainer` (`app.ts:1969`) interpolates `placeholder="${placeholder}"`
raw, where `placeholder` is `tagInput?.placeholder || rendererI18n.t('form.tagsPlaceholder')`.
This is NOT attacker-reachable (the only source is the static i18n key, which contains no
HTML-significant characters), so there is no practical XSS or markup-break — but it is the
one remaining raw attribute interpolation in the render path after C1 was fixed last
cycle. A single `escapeHtmlAttribute(...)` wrap makes the render path uniformly hygienic
at zero risk and zero behavior change for the real placeholder values.
Fix: wrap the interpolated placeholder with `this.escapeHtmlAttribute(...)`.
Acceptance: placeholder renders identically for the real i18n values; a hypothetical
placeholder containing `"`/`<`/`>`/`&` would render as literal text without breaking the
attribute; tsc + eslint + build green.

## Progress
- T1 implemented: see commit log. Verified `saveInProgress` no longer appears in src/.
  Gates green (eslint 0, tsc 0, build success); i18n parity 117/117.
- T2 implemented: see commit log. Placeholder now passes through `escapeHtmlAttribute`.
  Gates green; placeholder unchanged for the static i18n values.
