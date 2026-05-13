#!/usr/bin/env node
/**
 * Copy SQL migration files into the compiled `dist/` tree.
 *
 * `tsc` only emits the files it actually compiles, so `.sql` files under
 * `src/server/db/migrations/` are not present in `dist/` after `pnpm
 * build:cli`. The migration runner reads them by relative path at runtime,
 * so without this step the published CLI + worker binaries crash on first
 * use with `ENOENT: dist/server/db/migrations/`.
 *
 * Kept as a standalone Node script (rather than a `cp -r` shell-out) so the
 * build is cross-platform and matches the project's "no shell-string
 * execution" convention.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const src = resolve(repoRoot, 'src/server/db/migrations');
const dst = resolve(repoRoot, 'dist/server/db/migrations');

if (!existsSync(src)) {
  console.error(`copy-migrations: source directory missing: ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });

console.log(`copy-migrations: copied ${src} -> ${dst}`);
