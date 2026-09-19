# Local workbench validation — 2026-09-19

Baseline: cc1f4d2cb9d1c3465744c820d0ed31b6be95332e, clean main, one worktree.
Local batch only; no remote push, tag, release or paid inference.

## Verified

- Full `npm test`: 293 tests, 293 passed, 0 failed. Transcript is in ignored
  `output/workbench-test-results.log`.
- Real free browser analyses of `tinylibs/tinyspy` and `unjs/defu`, with report
  opening, favorite filtering, note saving/search, and two-report comparison.
- Actual app process restart: two real reports, one favorite and one note retained;
  report download returned HTTP 200. Integration test additionally covers
  concurrent metadata updates, foreign origins, invalid IDs, oversized notes,
  corrupt history preservation and artifact-path traversal rejection.
- Existing credential metadata: one saved record before and after restart. Only
  metadata was inspected. The isolated test browser used connection metadata to
  exercise the saved-key UI: saved state visible, password field empty, billing
  consent false. No existing key was decrypted or sent to a model for acceptance.
- Existing credential tests pass, including actual Windows DPAPI encryption and
  decryption of a synthetic test value. Existing user credential files unmodified.
- Desktop 1440px and mobile 390px comparison inspected. No page horizontal
  overflow; comparison table scrolls within its region. English library controls
  verified. Browser reported no runtime errors; library axe check: 0 violations.
- Design detector: only an advisory for pre-existing em-dash density in HTML.
- Windows launcher tested from stopped and running states. Second invocation
  reused the same process. Desktop shortcut points to this checkout and uses
  hidden PowerShell; no unrelated process termination.
- Read-only change review and `git diff --check` completed. Old dirty development
  checkout preserved; its old process was replaced only after identifying it.

## Evidence and limits

Local screenshots: `output/comparison-desktop-final.png` and
`output/comparison-mobile-final.png`. These are local QA artifacts, not committed.
Old download-only reports are not automatically imported. Favorites and notes
attach to a particular saved report. Browser connection metadata still belongs
to that browser profile; using another profile does not recover that metadata.
Comparison displays bounded source excerpts, not an exhaustive capability audit
or a generated recommendation. No new real-key validity, balance or live paid
provider acceptance is claimed. Owner hands-on acceptance remains with the user.
