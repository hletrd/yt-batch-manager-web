# Documentation Review — yt-batch-manager-web

Docs: `README.md`, `PRIVACY.md`, `TERMS.md`, generated `dist/*.html` (via `build-docs.js`).

## Findings

### DOC-1 — README "Features" omits recently shipped features — LOW (confirmed)
Recent commits added: AI/synthetic-content disclosure toggle (`bd479b0`), copy-tags button (`214bce0`), Shorts badge (`667aa68`). README Features (lines 30-36, and Korean section) list edit/bulk-edit/save-load/persistent-login but NOT: the "Altered or synthetic content" disclosure control, the copy-tags-to-clipboard button, or the Shorts badge. Docs lag the code.
- Fix: add bullets for these features (en + ko).
- Confidence: High (features present in code at `app.ts:432-437,510-516,412`; absent from README).

### DOC-2 — `made_for_kids` write semantics undocumented — MEDIUM (correctness-adjacent)
See VER-7. The app silently re-sends `selfDeclaredMadeForKids` derived from the read-back `madeForKids` on every update. This COPPA-relevant behavior is not documented anywhere and could surprise creators. Either document it explicitly or change the behavior (preferred). Flagging here because the docs make no mention of made-for-kids handling at all while the code mutates it.
- Confidence: Medium.

### DOC-3 — PRIVACY.md contact placeholder address — LOW (confirmed)
`PRIVACY.md:123` lists contact `01@0101010101.com`, which looks like a placeholder, while the repo author email elsewhere is real. For a published Terms/Privacy used in a Google OAuth verification flow, a placeholder contact is a compliance risk.
- Fix: use a real monitored contact address consistently across PRIVACY.md/TERMS.md.
- Confidence: Medium (cannot confirm intent, but the address pattern is clearly a placeholder).

### DOC-4 — README quota figure vs code — INFO (consistent)
README says "about 9 units per full load" and explains the uploads-playlist approach; this matches `youtube-api.ts:getVideos` (1 unit/page playlistItems + videos.list). Consistent. No action.

### DOC-5 — `build-docs.js` hardcodes `lang="en"` for all generated doc pages — LOW
`build-docs.js:6` emits `<html lang="en">` for about/privacy/terms even though source docs are bilingual (README has Korean sections). Minor; the main app page (UX-1) is the bigger lang issue.
- Confidence: Medium.

## Sweep
- `TERMS.md`/`PRIVACY.md` reference `./privacy.html` and `../` back-links — generated correctly by `build-docs.js`. OK.
- No CHANGELOG; version is bumped in package.json (1.0.8) but no release notes. INFO only.
