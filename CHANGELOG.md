# Changelog

## Unreleased

- Grouped saved reports by repository with independent version selection, favorites and notes.
- Added reload-safe browser note drafts, storage-failure feedback and saved-note conflict checks.
- Added source-excerpt comparison dimensions for operating systems, models/services, installation and storage.
- Added optional on-device Chinese/English comparison reading with originals, cancellation, retry and bounded caching.
- Added durable local report history, favorites, per-report notes, search and source-linked two-report comparison without model calls.
- Restored saved-report downloads across server restarts and isolated integration-test output from the user's library.
- Added a Windows background launcher that identifies this app and refuses to terminate conflicting services.

- Reworked the local workbench so the analysis path, free/AI boundary and report scope are easier to scan on desktop and mobile.
- Made the top Chinese/English switch the single reading-language control, with automatic on-device detection and translation when the browser supports it.
- Added brand-independent model-provider management for OpenAI-compatible Chat Completions and Anthropic Messages.
- Added Windows DPAPI protection for saved model API keys, including reload reuse, endpoint binding, last-four display, replacement and deletion controls.
- Simplified report presentation and removed translation-status labels that did not help readers understand the project.

## 0.2.0 — Initial public source snapshot

- Local Chinese/English browser interface and responsive layout.
- Free reports with purpose, setup, source references and downloads.
- Bounded large-repository reading, generic-language text mode and anonymous quota fallback.
- User-managed model APIs supporting Chat Completions and Anthropic Messages.
- Page-memory-only keys, explicit paid consent and free fallback without paid retries.
- Product and security tests that do not require paid API access.

Local preview only. Multi-user hosting, private repositories and a per-provider live acceptance matrix are not included.
