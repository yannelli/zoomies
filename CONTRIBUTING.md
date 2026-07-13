# Contributing to Zoomies

Zoomies welcomes your contributions. Read this guide to set up your local development environment and learn the conventions of the project.

## Local Setup

Run these commands to clone the repository and run the test suite:

```bash
git clone https://github.com/yannelli/zoomies.git
cd zoomies
nvm use
pnpm install
pnpm test
```

You need Node.js 22 LTS and pnpm 10 or newer. Installing NGINX on your local system is optional; the unit tests mock NGINX by default.

## Development Commands

Execute these commands to build, check, and format your code:

```bash
pnpm dev              # Start the Next.js development server
pnpm typecheck        # Check TypeScript types for both web and CLI
pnpm lint             # Run ESLint over the repository
pnpm format           # Run Prettier to format your code
pnpm build            # Build the application
```

## House Rules

- **Boring Code Wins.** Keep code simple and straightforward. Write small units with a single responsibility. Inject dependencies and extend behavior through composition. Do not create abstractions for hypothetical future needs. Write code that a new contributor can understand in a single pass.
- **Self-Explaining Names.** Let names carry the meaning so the call site reads like prose. Reserve comments for constraints, trade-offs, and decisions that the code cannot express. Never narrate what the code plainly does.
- **Focused Pull Requests.** A pull request must address a single concern. Small diffs are easier to review. Break complex or blocked work into a sequence of smaller, ordered pull requests.
- **Trust Docs Over Memory.** Read official documentation before writing code or writing documentation. Never rely on potentially stale memory. When searching for external APIs or patterns, include the year 2026 to target current versions.

## Branching and Pull Requests

Create feature branches off `main` and name them by their category:

```bash
git checkout -b feat/your-feature-name
```

Keep your commits focused. Before submitting a pull request, verify that type checks, linter, and tests pass. Describe the motivation for your changes and include a test plan.

## Code Conventions

- **ES Modules Only.** Write all code using ES modules. The CLI environment uses NodeNext module resolution. You must include the `.js` extension on relative imports.
- **Zod Boundaries.** Parse all incoming data using Zod at the application boundaries before passing objects to your domain logic.
- **Process Spawning.** Execute shell commands using `execa` with argument arrays. Do not pass raw shell strings.
- **Atomic Writes.** Write configuration files to a temporary file in the target directory first, then rename the file to make the write atomic.
- **Validation First.** Always validate NGINX configuration using `nginx -t -c <temp-file>` before writing files to the active configuration directory. Roll back all files immediately if validation fails.
