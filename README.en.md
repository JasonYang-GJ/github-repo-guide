# GitHub Repo Guide

**Paste a public GitHub repository URL to get a source-linked report of its purpose, setup and code structure.**

For developers exploring unfamiliar projects, people learning from open source, and teams doing an initial technical review. Use free rule-based analysis or bring your own model API for additional interpretation.

[简体中文](README.md) · [Model setup](docs/model-providers.md) · [Security](SECURITY.md)

![Local repository analysis interface](docs/images/workbench.png)

## Start locally

Requires Node.js 20+, npm, Git and network access to GitHub.

```sh
git clone https://github.com/JasonYang-GJ/github-repo-guide.git
cd github-repo-guide
npm ci --ignore-scripts
npm run web
```

Open **http://127.0.0.1:4173**, switch to EN if needed, and paste `https://github.com/tinylibs/tinyspy`. Anonymous access and free analysis work without a model key.

This is a **V0.2 local preview**, not a hosted multi-user service. No shared API credits are included.

## What it provides

- Project purpose, documented features, audience, setup and caveats.
- Selected modules and conservative JavaScript/TypeScript import and call relationships.
- Source references pinned to one complete commit, with documentation and AI interpretation labelled separately.
- Downloadable Markdown reports, JSON data and Mermaid diagrams.
- Chinese/English interface, with free analysis or user-managed model connections.

Free mode organizes source text using fixed rules and does not translate it. AI mode adds interpretation using your API account. Supported formats are **OpenAI-compatible Chat Completions** and **Anthropic Messages**; vendors are not restricted to a predefined list. Not every protocol/model is compatible.

In AI mode, open **Manage providers**, enter a name, public HTTPS Base URL, API key, format and model IDs. Choose the connection/model and accept its destination and charges. Configuration checks do not contact the vendor or validate authentication/balance. See the [provider guide](docs/model-providers.md).

## Privacy and limitations

- Nonsecret settings persist in this browser. Entered keys remain only in page/request memory and must be re-entered after reload, not written to persistent storage, reports or logs.
- AI requests send repository text to your selected provider and may incur charges, including failed requests. Failed generation can fall back to a free report without paid retries.
- GitHub credentials are separate from model keys. Custom connections do not borrow environment keys.
- Only public GitHub repositories are supported. Reading is bounded; large repositories may be partially analyzed. Other languages use generic text analysis, not full language-specific call graphs.
- Target code is never cloned, installed or executed. The report is not a runtime test, security audit or guarantee of correctness.
- Custom endpoints require public HTTPS. Local/private endpoints, native Responses/Gemini APIs, OAuth-only clients and automatic proxy-environment routing are not supported.
- **Do not expose the local port publicly.** Authentication, multi-user isolation and public-service rate limiting are not implemented.
- Both model protocols have mocked transport coverage, not live paid acceptance for every vendor.

Reports are stored in `output/web/runs/` and excluded from Git. If port 4173 is occupied, set the `PORT` environment variable to `4174` before starting.

## Development

```sh
npm run typecheck
npm test
```

Tests use local fixtures and simulated APIs; no real credentials or paid calls are required. The web suite is available via `npm run test:web`.

The CLI remains available via `npm run cli -- analyze https://github.com/owner/repo --output output --provider deterministic`. Its legacy content-research interfaces are separate from the web experience. Historical private experiment outputs and their replay tests are not distributed in this public snapshot.

[Public scope](docs/public-scope.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE). Dependencies retain their licenses. Analyzed repository code and excerpts remain subject to their original licenses; publishing a generated report does not relicense them.
