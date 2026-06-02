# Plan 06 — Docs, Tooling, and Small Hardening

Sources: A14, A17, A18, A20, A29.

## Tasks

### [x] T1 — Add `rel="noopener noreferrer"` to external links (A14)
`app.ts:405` video link `target="_blank"`. Add `rel="noopener noreferrer"`.
Acceptance: external new-tab link carries rel.

### [x] T2 — Update README feature list (A17)
Add bullets (en + ko) for: AI/synthetic-content disclosure toggle, copy-tags-to-clipboard button, Shorts badge.
Acceptance: README Features reflects shipped functionality.

### [x] T3 — Fix eslint `MODULE_TYPELESS_PACKAGE_JSON` warning (A29)
Cleanest low-risk fix without breaking the CommonJS `build-docs.js`: rename `eslint.config.js` → `eslint.config.mjs` (explicit ESM) so Node doesn't reparse, OR add `"type": "module"` and rename `build-docs.js` → `build-docs.cjs` (update package.json `build`/`build:docs` scripts and the GH workflow). Choose the `.mjs` rename (smallest blast radius; leaves build-docs untouched).
Acceptance: `npm run lint` emits no MODULE_TYPELESS warning; eslint still runs; build unaffected.

### [D] T4 — PRIVACY.md contact address (A18) — DEFERRED, needs maintainer input
`PRIVACY.md:123` `01@0101010101.com`. Note: the repo's own git author email is the
same address, so it may be the maintainer's real contact rather than a placeholder.
Either way, changing a published privacy contact is a content/compliance decision
requiring maintainer confirmation. Deferred (see DEFERRED.md, A18) — exit criterion:
maintainer confirms the correct contact email.

### [x] T5 — Document made-for-kids handling (A20/A5) 
After Plan 01 T5 removes the round-trip, no doc change is needed for behavior; ensure README/PRIVACY don't claim to manage made-for-kids. Also A20 (client_secret + redirect URI locking) is a GCP-config note — add a short README note in the credentials setup section recommending restricting authorized redirect URIs/JS origins to the deployed domain.
Acceptance: README credentials section mentions locking redirect URIs/origins.

## Progress
T1 (A14), T2 (A17), T3 (A29), T5 (A20 doc note) implemented and committed (signed):
78f0432 (lint config + rel), 1a611e8 (README). T4 deferred (A18). All gates green.
