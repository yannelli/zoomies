# Zoomies

> A control plane for NGINX. Zoomies renders, validates, and reloads NGINX
> configuration from a typed model so you can manage reverse-proxied sites
> without hand-editing config files.

[![CI](https://github.com/yannelli/zoomies/actions/workflows/ci.yml/badge.svg)](https://github.com/yannelli/zoomies/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)

**Status:** Pre-alpha. The API, CLI, and config schema are all subject to
breaking changes until 1.0.

## What it is (and isn't)

Zoomies is the **control plane**. NGINX is the **data plane** — it handles
every byte of proxied traffic, and that's where the performance comes from.
Zoomies' job is to:

- Model sites, upstreams, and certificates as typed records.
- Render NGINX config from those records.
- Validate the rendered config with `nginx -t` before swapping it in.
- Trigger a reload (or roll back) and confirm the proxy is healthy.

It is **not** a new proxy, a new HTTP server, or a replacement for NGINX.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the component sketch.

## Quickstart

> Zoomies is pre-alpha and currently exposes only a version stub. The full
> CLI/API is in progress.

```bash
git clone https://github.com/yannelli/zoomies.git
cd zoomies
nvm use            # picks up .nvmrc (Node 22 LTS)
pnpm install
pnpm build
node dist/index.js --version
```

## Development

```bash
pnpm dev           # run the entry stub with tsx watch
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm format        # prettier --write
pnpm test          # vitest run
pnpm build         # tsc -> dist/
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup details and code
conventions.

## Why "Zoomies"?

It's what cats do when they sprint in circles for no apparent reason. NGINX
already runs fast; Zoomies just points it where to go.

## License

[MIT](LICENSE) © Ryan Yannelli
