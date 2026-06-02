# Documentation Review — yt-batch-manager-web (cycle 2)

NEW / residual only. Cycle-1 doc fixes (README features A17, redirect-URI note A20,
rel A14) re-verified.

## Findings

### DOC-1 — PRIVACY.md placeholder contact (MEDIUM, Medium) — STILL TRUE, deferred
Citation: `PRIVACY.md` contact address. Unchanged from cycle-1 A18; needs maintainer
input (DEFERRED.md A18). No agent action.

### DOC-2 — `build-docs.js` generated pages hardcode `lang="en"` (LOW, Medium) — STILL TRUE, deferred
Citation: `build-docs.js:6`. Unchanged (A34, DEFERRED.md). No action.

### DOC-3 — README does not document the "Load from File" trust model (LOW, Medium) — NEW
Citation: README Features / file-operations. The app imports arbitrary user JSON and
renders it (the S1/S2 attack surface). Once S1/S2 are fixed, a one-line note that imported
backups are sanitized (ids/urls validated) would be accurate; today there is no statement
about import trust. Low priority; tie to S1/S2 implementation. Confidence: Medium.

### DOC-4 — Code comment vs behavior mismatch on status round-trip (LOW, Medium) — NEW
Citation: `youtube-api.ts:740-743` comment says omitting status fields wipes them, and
the app re-sends `license/embeddable/public_stats_viewable` to avoid that — but for
imported videos those fields are undefined (see verifier V1), so the comment's promise
("so leaving these out would silently wipe them") is exactly the V1 risk. The comment is
correct about the API; the code does not fully honor it for the import path. Documentation
follow-up should accompany the V1 fix. Confidence: Medium.

## Sweep
- README, PRIVACY, TERMS render via marked in build-docs; no broken internal links found.
- i18n en/ko parity = 115/115 (verified) — no doc/i18n drift.
