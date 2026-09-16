# Contributing

Install Node.js 20+ and run `npm ci --ignore-scripts`, `npm run typecheck` and `npm test`. Start the browser interface with `npm run web`.

- Keep free analysis as the default and paid model use behind explicit consent.
- Treat repository content as untrusted text. Never execute target code or weaken source validation to make a report pass.
- Add fixture-backed tests for behavior and security boundaries. Tests must not require real credentials or paid API calls.
- Preserve Chinese and English labels, mobile layout, keyboard focus and reduced-motion support.
- Never commit keys, environment files, generated reports, personal paths, local logs or dependency/build directories.

For a pull request, describe the user-visible change, verification, security impact and remaining limits. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

See [public scope](docs/public-scope.md) for the boundary between product tests and private historical research replays.
