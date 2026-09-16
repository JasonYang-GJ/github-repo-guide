# Security Policy

## Supported version

The current `0.2.x` local line is the only supported line. It is not a
hosted service and does not accept private repositories.

## Security boundary

- The Web server binds to `127.0.0.1` by default.
- Only canonical public `https://github.com/{owner}/{repository}` URLs are
  accepted.
- Target repository content is untrusted data. The analyzer does not clone,
  install, import, build, test or execute target repository code.
- The Web flow defaults to `deterministic-v1`. Every paid provider is explicit opt-in and
  requires paid-use consent.
- GitHub tokens and model API keys are accepted only in bounded same-origin
  POST bodies. They are request-scoped and are never echoed, logged, persisted,
  cached, downloaded or written to analysis artifacts.
- For GitHub and legacy fixed-preset API routes only, the loopback executable may use `GITHUB_TOKEN`, `DEEPSEEK_API_KEY`,
  `OPENAI_API_KEY`, `ZHIPU_API_KEY`, `DASHSCOPE_API_KEY` or `DASHSCOPE_INTL_API_KEY` from its
  process environment. Reusable server embeddings disable that fallback unless
  they explicitly enable it.
- Custom Web connections accept only credential-free public HTTPS base URLs.
  All DNS answers are checked; private/reserved addresses are rejected and a
  verified IP is pinned to the actual TLS request with hostname validation.
  Redirects are not followed; bodies are capped at 2 MiB and requests time out.
  Proxy environment variables are not used by this pinned transport.
- Custom keys are isolated by connection and NEVER inherit environment keys.
  Endpoint/protocol edits clear old keys; changes revoke paid-use consent.
  Only non-secret name/URL/protocol/model metadata persists in browser localStorage;
  keys remain in page memory and are lost on reload. Free analysis never creates
  a paid model client or uses a model key.
- Legacy preset API routes retain their fixed HTTPS origins/environment behavior
  for backwards compatibility; the new Web manager does not use those routes.
- User-approved model hosts are supplied separately to the quality gate. Repository
  text and model output cannot add allowed destinations or change the transport.
- Do not publish keys or environment files. `.env` patterns are ignored as a
  guardrail, not a secret scan; previously tracked files/history still need review.
- GitHub response caching is bounded, memory-only and expiring; credentials are
  excluded from cache keys and values.
- Analysis artifacts may contain public repository paths, excerpts and
  metadata. Review them before sharing.

Do not expose the local server directly to a public network. It has no
accounts, authentication, multi-user isolation or production rate limiter.
Public hosting requires a separate GitHub App/OAuth design, HTTPS, durable
secret management, abuse controls and user isolation.

## Reporting a vulnerability

Do not publish a suspected vulnerability with exploit details in a public
Issue. Use [private vulnerability reporting](https://github.com/JasonYang-GJ/github-repo-guide/security/advisories/new).

Include the affected commit, a minimal reproduction and the security boundary
that was crossed. Never include real API keys or private repository contents.
