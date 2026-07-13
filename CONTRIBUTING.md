# Contributing to Zoomies

Thanks for your interest in Zoomies. This document covers the basics of
getting a development environment set up and the conventions we follow.

## Prerequisites

- Node.js 22 LTS (see `.nvmrc`).
- [pnpm](https://pnpm.io/) 10 or newer.
- An NGINX binary on your `PATH` is required to exercise config validation /
  reload paths locally. The unit tests do not require NGINX.

## Setup

```bash
nvm use            # picks up .nvmrc
pnpm install
pnpm typecheck
pnpm test
```

## Common scripts

| Command          | What it does                                                          |
| ---------------- | --------------------------------------------------------------------- |
| `pnpm dev`       | Next.js dev server (`next dev` on http://localhost:3000).             |
| `pnpm build`     | Build web (`next build`) + CLI (`tsc -p tsconfig.cli.json`).          |
| `pnpm cli`       | Run the CLI through `tsx` for fast iteration (`pnpm cli sites list`). |
| `pnpm typecheck` | `tsc --noEmit` for both the Next app and the CLI tsconfig.            |
| `pnpm lint`      | Run ESLint over the repository.                                       |
| `pnpm format`    | Run Prettier (write).                                                 |
| `pnpm test`      | Run the Vitest suite.                                                 |
| `pnpm start`     | `next start` against a production build.                              |

## Branching and commits

- Cut feature branches off `main`. Names like `feat/site-crud`,
  `fix/reload-rollback`, `docs/architecture` are encouraged.
- Keep commits focused. Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
  are appreciated but not enforced.
- Pull requests should describe the _why_ and include a short test plan. The
  PR template will prompt for both.

## Code conventions

- ESM only (`"type": "module"`); no CommonJS in source.
- Prefer named exports — avoid default exports.
- Validate all external input (HTTP bodies, file contents, env) at the
  boundary with [Zod](https://zod.dev/) before letting it into the domain.
- Never shell out with string concatenation. Use `execa` with argument arrays.
- Never write an NGINX config to disk without first validating it via
  `nginx -t -c <new>`. Rollback to the previous config on failure.

## Reporting bugs / requesting features

Open an issue using the appropriate template. For security issues, follow
`SECURITY.md` instead — do not file a public issue.
