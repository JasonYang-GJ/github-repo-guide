# Local workbench batch — 2026-09-19

Authorized: hidden desktop launcher, persistent analysis history, favorites,
project notes, two-report comparison, and repair of the apparent missing key.
Single writer. No publication, paid inference, unrelated cleanup or old-tree edits.

Baseline: main cc1f4d2cb9d1c3465744c820d0ed31b6be95332e, clean, one worktree.
The other checkout `github` is an older dirty development tree and is preserved.
Architecture SHA256: AB5C19609CD4A04A427E9FDDD989963DAD84435A62A487CABDB214FDB77E0324.
Security SHA256: D2C9FCCDEDCDD4638E9C7AD2BB68C47ED2A7AE552007676CF5547F19B84FA16B.

## Product and architecture

Keep the existing interface, add a local library below the analysis workbench.
Only successful server-generated reports enter history. Each immutable report
snapshot is saved alongside its mutable favorite/note metadata using atomic
replacement and serialized writes. Data lives under ignored output/web/history;
report files remain under output/web/runs. No request credentials are persisted.
Opening, filtering, annotating and comparing saved reports makes no model calls.
Comparison presents documented excerpts with source links, capture date, commit,
coverage and limitations; absence of evidence is not absence of functionality.
Notes belong to each saved report/version and stay on this computer.

Reuse the existing Windows DPAPI store; do not migrate or reveal real secrets.
The immediate root cause is launching the old checkout without credential support.
The launcher verifies app identity, starts Node hidden with the correct working
directory, and reports port conflicts rather than terminating unknown processes.

## Acceptance

- Reports, favorites and notes survive server restart; saved downloads work.
- Invalid IDs, oversized notes, foreign origins and traversal are rejected.
- Browser: real free analysis, history reopen, search, favorite, note, comparison;
  desktop/mobile layout and English labels; no silent fee-generating actions.
- Existing credential tests plus real DPAPI round trip with a synthetic key in an
  isolated temporary store; inspect only metadata of the existing user store.
- Launcher works twice, reusing the same app process; no visible terminal required.
- Focused tests, full regression, read-only final review; report remaining limits.
