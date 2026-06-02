# Plan 08 — Cycle 3: Option-markup escaping & cache hygiene

Source: `.context/reviews/_aggregate-cycle3.md` (findings C1, C2). The repository has
materially stabilized; cycle-3 found only two LOW findings. C1 is scheduled below; C2 is
deferred (latent, no data loss — see DEFERRED.md). No finding is silently dropped.

Repo rules binding this work (from user global CLAUDE.md; no project CLAUDE.md/AGENTS.md):
GPG-signed commits (`git commit -S`), Conventional Commits + gitmoji, fine-grained
commits, `git pull --rebase` before push, no suppressions, gates green (eslint, tsc,
build), deploy auto on push (no separate deploy).

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[D]` deferred

## Tasks

### [x] T1 — Escape category/language option markup (C1, LOW; security S-C3-1 + code C-C3-1 + designer)
Problem: `generateCategoryOptions` (`app.ts:1099-1104`) and `generateLanguageOptions`
(`app.ts:1127-1132`) interpolate API-sourced `category.id`/`category.title` and
`language.id`/`language.name` raw into `<option value="...">text</option>`. The data comes
from YouTube's `videoCategories.list`/`i18nLanguages.list` (or the hardcoded fallback), so
practical XSS is LOW — but this is the only remaining raw interpolation of API string data
in the render path lacking the `escapeHtml`/`escapeHtmlAttribute` hygiene used everywhere
else, and it is a real correctness bug for titles/names containing `&`, `<`, `>`, or `"`.
Fix: wrap the option `value` (`category.id`/`language.id`) with `escapeHtmlAttribute(...)`
and the option text (`category.title`/`language.name`) with `escapeHtml(...)`, matching the
hygiene already applied to the placeholder option on the same lines.
Acceptance: a category/language title containing `&"<>` renders as the literal text and
does not break the `<option>` value or list; normal options unchanged; the `selected`
state still works; tsc + eslint + build green; i18n parity preserved.

### [D] T2 — Imported records pollute the YouTube video cache on save (C2, LOW) — DEFERRED
See DEFERRED.md (C2). Latent, no data loss, self-healing on a forced "Load from YouTube"
refresh and on 24h cache expiry; the UI already degrades gracefully (default thumbnail,
0 stats). Not a security/correctness/data-loss finding, so deferral is permitted by the
deferred-fix rules. Exit criterion recorded in DEFERRED.md.

## Progress
- T1 implemented: see commit log. Verified by node check that `escapeHtml('&<>"\'')`
  entity-encodes and `escapeHtmlAttribute('"')` → `&quot;`; gates green (eslint 0, tsc 0,
  build success); i18n parity 117/117.
- T2 deferred — recorded in DEFERRED.md with reason + exit criterion.
