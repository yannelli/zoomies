import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateConfig } from './validate.js';

// Integration tests that invoke the real `nginx -t` binary. Gated on
// `ZOOMIES_E2E === '1'` so CI (and contributors without NGINX installed)
// stay green. To run locally:
//
//   ZOOMIES_E2E=1 pnpm test
//
// If the box's nginx lives somewhere other than `/usr/sbin/nginx`, point
// `ZOOMIES_NGINX_BIN` at it as well.
const RUN_E2E = process.env.ZOOMIES_E2E === '1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '..', 'renderer', '__fixtures__', 'http-only.conf');

describe.skipIf(!RUN_E2E)('validateConfig (e2e: real nginx -t)', () => {
  it('accepts the http-only.conf renderer fixture', async () => {
    const fixture = readFileSync(FIXTURE_PATH, 'utf8');
    const result = await validateConfig(fixture);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('rejects a hand-crafted broken fragment', async () => {
    // `listen` requires a numeric port (or an address with a port). Quoting
    // a non-numeric value triggers a parse error from NGINX.
    const broken = 'server { listen "not a port"; }';
    const result = await validateConfig(broken);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});
