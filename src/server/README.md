# `src/server/`

Control-plane domain code shared by the Route Handler API
(`src/app/api/**`) and the CLI (`src/index.ts`).

This is where config rendering, validation, NGINX orchestration, and the
typed records that model sites / upstreams / certs will live. Both
delivery surfaces (HTTP + CLI) call into this layer; neither owns
business logic directly.

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
