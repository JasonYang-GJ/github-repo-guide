# Public source scope

This repository starts with a clean V0.2 product snapshot, including all current runtime source, schemas, browser assets, local product fixtures and independently runnable product tests.

It excludes the original development Git history, local filesystem paths, runtime reports, model request/response archives, private authorization records and historical evaluation experiments. Tests requiring those experimental artifacts and their paid-run scripts are not part of this public suite. They remain in the original development workspace; nothing was deleted there.

This is a packaging/privacy boundary, not a waiver of failing product tests. Public tests cover repository access, large-repository reading, static extraction, schema/claim checks, free and model-backed reports, API safety, key isolation, fallback, CLI artifacts, web routes and UI copy. A clean installation is tested separately from the original development workspace.

Automated model calls use fake keys and mocked transport. No live paid compatibility matrix is claimed. Selected bounded regression fixtures are retained with attribution in [Third-party notices](../THIRD_PARTY_NOTICES.md); they are not operational credentials or real deployments. Source availability does not mean a hosted service, production security audit, npm package or binary release has been provided.
