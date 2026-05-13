#!/usr/bin/env node
/**
 * Stamp the release version into the three places it's baked in:
 *
 *   - package.json's `version` field (what `npm publish` ships)
 *   - src/version.ts (string compiled into the CLI binary)
 *   - src/lib/version.ts (string compiled into the Next.js UI / healthz API)
 *
 * Invoked from the release workflow with the git tag's version, leading
 * `v` already stripped. Main is intentionally kept at 0.0.0 — the version
 * is derived from the tag at publish time, not committed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error(`set-version: invalid version "${version ?? ''}". Expected X.Y.Z or X.Y.Z-pre.`);
  process.exit(1);
}

const pkgPath = resolve(repoRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const versionLiteral = /(['"])\d+\.\d+\.\d+(?:-[\w.]+)?\1/;
for (const rel of ['src/version.ts', 'src/lib/version.ts']) {
  const p = resolve(repoRoot, rel);
  const original = readFileSync(p, 'utf8');
  const updated = original.replace(versionLiteral, `$1${version}$1`);
  if (updated === original) {
    console.error(`set-version: no version literal found in ${rel}`);
    process.exit(1);
  }
  writeFileSync(p, updated);
}

console.log(
  `set-version: stamped ${version} into package.json, src/version.ts, src/lib/version.ts`,
);
