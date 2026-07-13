# Zoomies Developer Reference

Zoomies manages an NGINX reverse proxy by treating configurations as typed state records. It validates the configuration using NGINX and reloads the server safely. NGINX handles the network traffic; Node.js never sits in the request path.

The application compiles into two separate parts: a Next.js web application for the dashboard and HTTP API, and a command-line interface.

## House Rules

- **Boring Code Wins.** Keep code simple and straightforward. Write small units with a single responsibility. Inject dependencies and extend behavior through composition. Do not create abstractions for hypothetical future needs. Write code that a new contributor can understand in a single pass.
- **Self-Explaining Names.** Let names carry the meaning so the call site reads like prose. Reserve comments for constraints, trade-offs, and decisions that the code cannot express. Never narrate what the code plainly does.
- **Focused Pull Requests.** A pull request must address a single concern. Small diffs are easier to review. Break complex or blocked work into a sequence of smaller, ordered pull requests.
- **Trust Docs Over Memory.** Read official documentation before writing code or writing documentation. Never rely on potentially stale memory. When searching for external APIs or patterns, include the year 2026 to target current versions.

## Commands

Execute these commands from the repository root:

```bash
pnpm install          # Install dependencies
pnpm dev              # Start the Next.js development server
pnpm cli status       # Run the CLI status command in development
pnpm typecheck        # Check TypeScript types for both web and CLI
pnpm lint             # Lint the codebase
pnpm format           # Format code with Prettier
pnpm test             # Run the test suite
pnpm build            # Build both Next.js and CLI targets
```

## Structure

```
src/app/           # Next.js App Router UI and API route handlers
src/components/ui/ # Shadcn UI primitive components
src/lib/           # Shared utilities
src/server/        # Control plane domain code
src/index.ts       # CLI entry point
src/version.ts     # CLI version constant
deploy/            # Systemd and NGINX configs
scripts/           # Installer and helper scripts
```

## Compilation and Dependencies

The web application and the CLI compile independently. Web code lives in `src/app/` and CLI code is built from `src/index.ts`.

- **Strict Boundaries.** CLI code must never import from `src/app/` or `src/components/`. The compiler enforces this separation via `tsconfig.cli.json`.
- **ES Modules Only.** The project uses ES modules. Relative imports in the CLI code must include the `.js` extension (for example, `import { db } from './db.js'`).
- **Named Exports.** Use named exports for all domain and server code. Next.js pages and layouts are exempt.
- **Zod Boundaries.** Parse all incoming data using Zod at the boundary. Hand already-validated objects to your domain logic.
- **Process Spawning.** Execute shell commands using `execa` with argument arrays. Do not pass raw shell strings.
- **Atomic Writes.** Write configuration files to a temporary file in the target directory first, then rename the file to make the write atomic.
- **Validation First.** Always validate NGINX configuration using `nginx -t -c <temp-file>` before writing the files to the active directory. Roll back all files immediately if validation fails.
- **TypeScript Settings.** Do not loosen TypeScript rules in `tsconfig.cli.json`. Keep `exactOptionalPropertyTypes` and `verbatimModuleSyntax` active for the CLI.
