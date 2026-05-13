# Zoomies — context for Claude Code

## What this project is

Zoomies is the **control plane** for an NGINX reverse proxy. It models sites,
upstreams, and certs as typed records, renders NGINX config from them,
validates with `nginx -t`, and reloads NGINX. NGINX itself is the data plane
— Node/TS code is never in the request path.

The control plane ships as a single package with two artifacts:

1. A **Next.js (App Router) web app** that serves the dashboard UI and the
   initial HTTP API (Route Handlers under `src/app/api/**`).
2. A **CLI binary** (`zoomies`) emitted to `dist/` from `src/index.ts` for
   admin/automation use.

Status: pre-alpha. The architecture is sketched in `docs/ARCHITECTURE.md`.
Read it before proposing structural changes.

## Stack

- Node 22 LTS (`.nvmrc`).
- Next.js 15 (App Router) with React 19 for the UI and Route Handler API.
- Tailwind v4 (`@tailwindcss/postcss`, OKLCh design tokens) + shadcn/ui
  primitives (author-owned, under `src/components/ui/`).
- TypeScript, strict mode, `"type": "module"` (ESM only).
- pnpm for dependency management.
- Vitest for tests.
- ESLint (flat config, `eslint-config-next`) + Prettier.

## Layout

```
src/app/           # Next.js App Router (UI + Route Handlers)
src/components/ui/ # shadcn/ui primitives (author-owned)
src/lib/           # shared client/server utilities (cn, bootstrap-config)
src/server/        # (future) control-plane domain code, called from Route Handlers
src/index.ts       # CLI entry — emitted to dist/ via tsconfig.cli.json
src/version.ts     # version constant shared by CLI
src/*.test.ts      # colocated unit tests (CLI / server domain code only)
docs/              # design docs (ARCHITECTURE.md, ADRs)
deploy/            # systemd unit + NGINX configs for native installs
scripts/           # install / runtime helpers
.github/workflows/ # CI
```

## Package shape

This package emits two artifacts:

- The Next.js standalone server bundle (`.next/standalone/`) — what `pnpm
start` and the Dockerfile run.
- The `zoomies` CLI binary (`dist/index.js`, exposed via `bin`) — what
  `pnpm publish` would ship.

Keep them isolable: **CLI code must never import from `src/app/` or
`src/components/`**. The CLI is built by a separate, stricter
`tsconfig.cli.json`.

## Commands

| Task         | Command                     |
| ------------ | --------------------------- |
| Install      | `pnpm install`              |
| Dev (web)    | `pnpm dev` (`next dev`)     |
| Dev (CLI)    | `pnpm cli -- --version`     |
| Typecheck    | `pnpm typecheck`            |
| Lint         | `pnpm lint`                 |
| Format       | `pnpm format`               |
| Format check | `pnpm format:check`         |
| Test         | `pnpm test`                 |
| Build (all)  | `pnpm build`                |
| Build (web)  | `pnpm build:web`            |
| Build (CLI)  | `pnpm build:cli`            |
| Start (prod) | `pnpm start` (`next start`) |

`pnpm typecheck` and `pnpm build` each run both targets. Always run
typecheck, lint, and test before declaring a task done.

## Conventions

- **ESM only.** No CommonJS, no `require`.
  - **CLI code** (`src/index.ts`, `src/version.ts`, `src/server/**`) uses
    NodeNext resolution — relative imports must include `.js` extensions.
  - **UI code** (`src/app/**`, `src/components/**`, `src/lib/**`) uses
    bundler resolution and the `@/*` path alias — extensions are optional.
- **Named exports only** for non-UI code. React components and Next.js
  conventions (default-exported pages/layouts/route handlers) are exempt.
- **Validate at the boundary** with Zod. Domain code should receive
  already-parsed types.
- **No shell-string execution.** Use `execa` with an argv array.
- **Never write an NGINX config without validating it first** via
  `nginx -t -c <new-file>`. Roll back on failure.
- **Atomic file writes** — write to a temp file in the same directory, then
  `rename()`.
- **Tailwind v4**: when adding shadcn components, use the v4-aware flow.

## What NOT to do

- Don't put logic on the request hot path; that's NGINX's job.
- Don't introduce a new runtime dependency without considering whether NGINX
  or the standard library can do it.
- Don't loosen TypeScript strictness in `tsconfig.cli.json` to make CLI
  errors go away. The root `tsconfig.json` (Next.js) intentionally relaxes
  `exactOptionalPropertyTypes` and `verbatimModuleSyntax` because generated
  types from React 19 and Next 15 conflict with them — leave those flags
  off in the root config, but keep them on in the CLI config.
- Don't import UI code from CLI code or vice versa.

## Branching / PRs

- Feature branches off `main`. CI must pass before merge.
- PR descriptions follow `.github/pull_request_template.md` (summary + test
  plan).

## When in doubt

Re-read `docs/ARCHITECTURE.md` and `CONTRIBUTING.md`. If still unclear, ask.
