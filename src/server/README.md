# Server Domain Layer

The server directory contains the core domain logic for Zoomies. Both the Next.js web application and the command-line interface call into this layer.

## Architectural Boundaries

Domain code must remain independent of the delivery mechanism. Do not import UI or application-level code into the server directory.

An ESLint rule prevents imports from these paths:

- `src/app/` (Next.js UI and Route Handlers)
- `src/components/` (React components)
- `src/lib/` (Client-side and shared UI utilities)

## Compiler Requirements

The command-line interface builds using `tsconfig.cli.json`, which enforces NodeNext module resolution. Relative imports must include the `.js` extension, even when importing a `.ts` file:

```typescript
import { db } from './db.js';
import { validateSite } from './site.js';
```

Use named exports for all domain and server code. Next.js pages and layouts are exempt from this requirement.
