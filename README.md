# Zoomies

> A control plane for NGINX. Zoomies renders, validates, and reloads NGINX
> configuration from a typed model so you can manage reverse-proxied sites
> without hand-editing config files.

[![CI](https://github.com/yannelli/zoomies/actions/workflows/ci.yml/badge.svg)](https://github.com/yannelli/zoomies/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: alpha](https://img.shields.io/badge/status-alpha-yellow)

**Status:** Alpha. The v1 surface is complete and runnable, but the API,
CLI, and config schema may still see breaking changes before 1.0.

## What it is (and isn't)

Zoomies is the **control plane**. NGINX is the **data plane**: it handles
every byte of proxied traffic, and that's where the performance comes from.
Zoomies' job is to:

- Model sites, upstreams, and certificates as typed records.
- Render NGINX config from those records.
- Validate the rendered config with `nginx -t` before swapping it in.
- Atomically swap files, trigger a reload, probe health, and roll back on
  any failure.
- Automate Let's Encrypt certificate issuance and renewal.

It is **not** a new proxy, a new HTTP server, or a replacement for NGINX.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the component sketch.

## What's in v1

- **Web UI** at `/login`, `/sites`, `/upstreams` — cookie-gated CRUD with
  shadcn-style primitives.
- **HTTP API** under `/api/v1/{sites,upstreams,sites/[id]/cert}` — bearer-
  token-guarded; `DomainError` and `ZodError` map to clean HTTP statuses.
- **CLI** — `zoomies sites|upstreams|certs|reload|status`. Runs in
  `--local` mode (direct SQLite access) or HTTP mode against a running
  control plane.
- **ACME worker** (`zoomies-worker`) — long-running process that polls
  for certs nearing expiry and renews them serially. HTTP-01 challenges
  served from a directory NGINX exposes.
- **Reload orchestrator** — validate → atomic write → SIGHUP → health
  probe → rollback on any failure step.
- **SQLite persistence** with idempotent migrations and Zod-on-read.

## Install

Two supported paths, both covered in [`docs/INSTALL.md`](docs/INSTALL.md):

- **Docker Compose** — the shipped `docker-compose.yml` runs the control
  plane (`app`), an NGINX edge sidecar (`nginx`), and optionally the ACME
  renewal worker (`worker`).
- **Ubuntu native** — `scripts/install-ubuntu.sh` installs Node 22 if
  needed, builds into `/opt/zoomies`, and registers `zoomies.service` and
  `zoomies-worker.service` systemd units.

For the ops side — NGINX permission strategies, the `include` contract,
ACME challenge directory layout — see
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Development

```bash
git clone https://github.com/yannelli/zoomies.git
cd zoomies
nvm use            # .nvmrc → Node 22 LTS
pnpm install
pnpm typecheck
pnpm test
pnpm dev           # next dev on http://localhost:3000
```

Other scripts:

| Command          | What it does                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `pnpm typecheck` | `tsc --noEmit` for both the Next app and the CLI tsconfig             |
| `pnpm lint`      | `eslint .`                                                            |
| `pnpm format`    | `prettier --write .`                                                  |
| `pnpm test`      | `vitest run` (NGINX-dependent e2e gated on `ZOOMIES_E2E=1`)           |
| `pnpm build`     | `next build` (web) + `tsc -p tsconfig.cli.json` + copy SQL migrations |
| `pnpm start`     | `next start` against the standalone bundle                            |
| `pnpm cli`       | Run the CLI through `tsx` for fast iteration                          |

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the conventions: ESM only,
strict TypeScript, validate-at-boundary with Zod, never write NGINX
config without validating first, no shell-string `execa`.

## Why "Zoomies"?

It's what cats do when they sprint in circles for no apparent reason.
NGINX already runs fast; Zoomies just points it where to go.

## License

[MIT](LICENSE) © Ryan Yannelli
