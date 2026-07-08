# AGENTS.md

Project-level guidance lives in `CLAUDE.md` (architecture, stack, conventions,
command table) and the `docs/` directory (`ARCHITECTURE.md`, `INSTALL.md`,
`OPERATIONS.md`). Read those first. This file only adds notes specific to the
Cursor Cloud environment.

## Cursor Cloud specific instructions

The update script runs `pnpm install` on startup. Node 22 and pnpm 10.33.0 are
already provisioned. Standard commands (`pnpm dev`, `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`) are documented in
`README.md` / `package.json` — use those.

Non-obvious caveats:

- **Running the app:** `pnpm dev` serves the Next.js control plane (UI + API)
  on `http://localhost:3000`. The UI/API reject every request unless
  `ZOOMIES_API_TOKEN` is set — export it before starting the server and use the
  same value as the login token on `/login` and as the API bearer token. In dev
  the SQLite DB is auto-created under `ZOOMIES_STATE_DIR` (default `./.zoomies`,
  gitignored); no separate DB service to start.
- **CRUD needs no NGINX:** creating/editing sites and upstreams via the UI/API
  or CLI writes only to SQLite. v1 does **not** auto-reload NGINX on mutation,
  so the full product loop is exercisable without a running NGINX. NGINX is only
  invoked for the validate/reload cycle (`POST /api/v1/reload`) and ACME cert
  issuance.
- **NGINX is a system dependency, not installed by the update script.** The
  gated e2e validator tests (`ZOOMIES_E2E=1`, skipped by default) shell out to
  the real `nginx` binary. Two gotchas when running them: point
  `ZOOMIES_NGINX_BIN` at the binary (e.g. `/usr/sbin/nginx`), and run as **root**
  — `nginx -t` opens `/run/nginx.pid`, which fails with a permission error for
  non-root users even though the config syntax is valid. The default
  `pnpm test` suite mocks NGINX and needs neither.
- **CLI arg forwarding gotcha:** with pnpm 10.33.0, `pnpm cli -- <subcommand>`
  forwards a literal `--` and fails (`unknown command '--'`). Invoke the CLI as
  `pnpm cli <args>` (no `--` separator) or `npx tsx src/index.ts <args>`, e.g.
  `pnpm cli --local sites list`. (`--version` still works with `--` because
  Commander intercepts the global flag.) Use `ZOOMIES_STATE_DIR` to point
  `--local` mode at the same DB the dev server uses.
