# Zoomies — context for Claude Code

## What this project is

Zoomies is the **control plane** for an NGINX reverse proxy. It models sites,
upstreams, and certs as typed records, renders NGINX config from them,
validates with `nginx -t`, and reloads NGINX. NGINX itself is the data plane
— Node/TS code is never in the request path.

Status: pre-alpha. The architecture is sketched in `docs/ARCHITECTURE.md`.
Read it before proposing structural changes.

## Stack

- Node 22 LTS (`.nvmrc`).
- TypeScript, strict mode, `"type": "module"` (ESM only).
- pnpm for dependency management.
- Vitest for tests.
- ESLint (flat config) + Prettier.

## Layout

```
src/                # source
src/*.test.ts       # colocated unit tests
docs/               # design docs (ARCHITECTURE.md, ADRs)
.github/workflows/  # CI
```

## Commands

| Task         | Command             |
| ------------ | ------------------- |
| Install      | `pnpm install`      |
| Dev (watch)  | `pnpm dev`          |
| Typecheck    | `pnpm typecheck`    |
| Lint         | `pnpm lint`         |
| Format       | `pnpm format`       |
| Format check | `pnpm format:check` |
| Test         | `pnpm test`         |
| Build        | `pnpm build`        |

Always run typecheck, lint, and test before declaring a task done.

## Conventions

- **ESM only.** No CommonJS, no `require`, use `.js` extensions in relative
  imports (TS NodeNext resolution).
- **Named exports only.** Avoid `export default`.
- **Validate at the boundary** with Zod. Domain code should receive
  already-parsed types.
- **No shell-string execution.** Use `execa` with an argv array.
- **Never write an NGINX config without validating it first** via
  `nginx -t -c <new-file>`. Roll back on failure.
- **Atomic file writes** — write to a temp file in the same directory, then
  `rename()`.

## What NOT to do

- Don't put logic on the request hot path; that's NGINX's job.
- Don't add a UI to this package — UI will live in its own future package.
- Don't introduce a new runtime dependency without considering whether NGINX
  or the standard library can do it.
- Don't loosen TypeScript strictness flags in `tsconfig.json` to make errors
  go away.

## Branching / PRs

- Feature branches off `main`. CI must pass before merge.
- PR descriptions follow `.github/pull_request_template.md` (summary + test
  plan).

## When in doubt

Re-read `docs/ARCHITECTURE.md` and `CONTRIBUTING.md`. If still unclear, ask.
