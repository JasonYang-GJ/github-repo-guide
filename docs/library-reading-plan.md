# Library reading batch — 2026-09-19

Baseline: clean main at 7c884e4cbaa826ffac30bd4078e4d88c0a9372ff, one worktree.
Architecture SHA256: 162E326E1EE34744844B6A1CA9D24D4C00C30278CF3CCFC3A1BF7D4A7A0EC54C.
Security SHA256: 2404D33814129C5BDC7E77E927098A6DE287A65C223082F8AC81A2254089D3FD.

Authorized: comparison Chinese/English reading, explicit comparison dimensions,
reload-safe note drafts and repository-grouped history. Preserve the existing UI,
saved report files, credentials and the older development checkout. Single writer.
No paid model requests, unrelated feature batches or automatic publication.

## Design

- Group report summaries by case-insensitive canonical owner/repository, keeping
  each snapshot selectable and its own favorite and note intact. Filter before
  grouping, display matching/total version counts and retain expanded groups.
- Drafts use bounded, per-report browser storage records with the original saved
  note. Writes happen on input. Quota/corruption errors must not say saved; retain
  a memory fallback, and only remove a draft after confirmed server save. Confirm
  before overwriting a saved note that changed since the draft began.
- Comparison dimensions collect existing source excerpts about system support,
  model dependencies, installation and data storage. Topic matches are labelled
  related documentation, never treated as proof of runtime capabilities. Unknown
  and incomplete coverage remain visible. Do not infer support from an OS name.
- A local reading button reuses the browser translator and technical-literal
  protection. Cache by immutable report ID and target language. Keep original
  excerpts and source links accessible, skip code blocks, never translate notes,
  never mutate reports, and cancel stale work on selection/language changes.
- Use original text on unsupported/unavailable translation, with progress,
  cancellation and retry. Never silently call a paid provider.

## Acceptance

Tests: grouping/filtering, draft reload/failure/conflict preservation, bounded
dimension extraction, translation source/code preservation, cancellation and
unavailable states. Browser: multiple versions, two-version comparison, saved and
unsaved note reload, Chinese reading with real browser API when available,
desktop/mobile layouts. Run affected tests then full regression and a final
read-only review. Restart only the verified local app after stating the impact.

## Verified result

- `npm test`: 299 passed, 0 failed. Focused history/draft/translation checks:
  18 passed, including stale-note rejection, damaged/blocked storage, original
  excerpts and code preservation.
- Real browser at `127.0.0.1:4173`: three projects/four reports, including two
  actual free analyses of `unjs/defu`. Per-version favorite and original note
  remained intact. Draft recovered after reload; saved note survived reload and
  its draft was cleared. Temporary test note and browser drafts were restored or
  discarded after the checks.
- Real Chrome on-device translation produced Chinese comparison excerpts with
  expandable originals and unchanged source links. English controls/readiness,
  same-project report comparison and return to originals were checked.
- Fault injection: missing translator retained originals; delayed translation
  could be cancelled and retried without displaying the late result. Instrumented
  comparison-reading actions made zero application API requests. A delayed report
  load after clearing selection did not reopen the comparison.
- Desktop 1440 x 1000 and mobile 390 x 844 reviewed. Mobile page width stayed 390;
  only the 680 px comparison table scrolled inside its 356 px container. Browser
  reported no uncaught page errors. Design detector: zero anti-pattern failures,
  one advisory concerning existing page copy punctuation.
- README screenshots updated with public reports and collapsed note bodies.
  Launcher returned READY with the expected application identity. This batch is
  local only; no paid model check, GitHub push, tag or release was performed.

Limitations: on-device translation depends on browser/language-pack support and
can mistranslate prose. Topic dimensions reflect only excerpts already captured
in the bounded report. Browser drafts are not encrypted, backed up or synced.
