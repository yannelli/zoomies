import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb, resetDbForTesting } from '../api/db-context.js';
import { openDatabase } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { main } from './main.js';

describe('worker main', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zoomies-worker-'));
    const stateDir = join(dir, 'state');
    const certDir = join(dir, 'certs');
    const directoryUrl = 'https://acme-staging-v02.api.letsencrypt.org/directory';

    // Direct every side effect at the temp dir so the test stays
    // hermetic — account key, cert files, challenge dir, SQLite DB.
    vi.stubEnv('ZOOMIES_ACME_EMAIL', 'admin@example.com');
    vi.stubEnv('ZOOMIES_ACME_DIRECTORY_URL', directoryUrl);
    vi.stubEnv('ZOOMIES_STATE_DIR', stateDir);
    vi.stubEnv('ZOOMIES_CERT_DIR', certDir);

    // Use a fresh in-memory DB so the worker's CertRepository sees the
    // schema we expect but no rows. Replace the db-context cache with it
    // so getDb() returns this handle.
    const db = openDatabase(':memory:');
    runMigrations(db);
    resetDbForTesting(db);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetDbForTesting(null);
    await rm(dir, { recursive: true, force: true });
  });

  it('runs one renewal pass and resolves cleanly on an empty cert table', async () => {
    // No certs seeded; runRenewalCheck() should report zero work and main()
    // should return on its own because `once: true` skips the wait loop.
    await expect(main({ once: true })).resolves.toBeUndefined();

    // The DB is the in-memory handle we set up. The worker's call to
    // getDb() returns it; if the schema or repo wiring were wrong the
    // call above would have thrown.
    expect(getDb()).toBeDefined();
  });
});
