# `src/server/`

Control-plane domain code shared by the Route Handler API
(`src/app/api/**`) and the CLI (`src/index.ts` / `src/cli/**`).

Both delivery surfaces call into this layer; neither owns business logic
directly. Import modules by path (e.g. `../server/reload/reload.js`) —
there is no barrel `index.ts`.

## Layout

| Path            | Responsibility                                                            |
| --------------- | ------------------------------------------------------------------------- |
| `domain/`       | Zod schemas and typed records (site, upstream, cert, errors).             |
| `repositories/` | SQLite persistence over the domain types.                                 |
| `db/`           | Connection helpers and SQL migrations.                                    |
| `api/`          | Shared handlers, DB context, and error → HTTP mapping for Route Handlers. |
| `auth/`         | Bearer-token gate (`requireToken`).                                       |
| `renderer/`     | Pure state → NGINX config rendering.                                      |
| `validator/`    | `nginx -t` against a candidate bundle.                                    |
| `reload/`       | Atomic write, SIGHUP / `nginx -s reload`, health probe, rollback.         |
| `certs/`        | ACME account, HTTP-01 challenge store, issue / renew / scheduler.         |
| `worker/`       | Long-running `zoomies-worker` entrypoint (renewal loop + demo bootstrap). |
| `bootstrap/`    | Optional first-boot demo site seeding.                                    |

## Boundaries

Code in `src/server/**` MUST NOT import from:

- `src/app/**` (Next.js UI / Route Handlers)
- `src/components/**` (React components)
- `src/lib/**` (UI-side utilities)

This is enforced by ESLint (`no-restricted-imports` rule scoped to
`src/server/**`).

## Compiler

`src/server/**` is built by `tsconfig.cli.json`:

- `module` / `moduleResolution`: `NodeNext`
- `exactOptionalPropertyTypes`: on
- `verbatimModuleSyntax`: on

Because resolution is NodeNext, relative imports MUST include the `.js`
extension (e.g. `import { foo } from './foo.js'`), even when the source
file is `.ts`. Use named exports only.
