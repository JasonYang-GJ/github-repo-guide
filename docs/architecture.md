# Architecture

The local web server and CLI share the repository reading and report pipeline.

```text
Browser / CLI
  → validate public GitHub URL
  → resolve fixed commit and read bounded text
  → extract documentation, modules and source references
  → free report / explicitly selected model interpretation
  → validate report format and source relationships
  → display report and write downloadable artifacts
```

- `src/repo`: URL rules, GitHub transport, bounded reading and anonymous archive fallback.
- `src/analysis`, `src/facts`, `src/evidence`, `src/brief`: guides and source-linked facts.
- `src/model`: model contracts, free provider and external API transports.
- `src/quality`, `schemas`: structural and cross-object validation.
- `src/application`, `src/artifacts`: orchestration, fallback and output writing.
- `src/web`, `web`: loopback server, browser UI and supplier configuration.
- `src/content`, `src/exploration`: reading/content logic and retained research interfaces.
- `tests`: local fixtures and product regression tests.

Custom AI calls require a per-connection key and explicit destination/cost consent. Public HTTPS destinations are DNS-checked and pinned to a verified public address. TLS hostname validation remains enabled; redirects and private addresses are rejected. No automatic paid retry is added.

Repository text and model output cannot change allowed destinations or grant execution authority. Failed reading or required checks produce explicit errors. Failed model generation may produce a labelled free report from the same previously read snapshot.

The server binds to loopback, allows one active analysis and has bounded in-memory caches. It is not designed for unauthenticated public hosting. See [SECURITY.md](../SECURITY.md).
