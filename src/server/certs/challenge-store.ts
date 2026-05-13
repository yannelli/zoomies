/**
 * HTTP-01 challenge token persistence.
 *
 * ACME's HTTP-01 challenge demands that for each `token` issued by the CA we
 * serve the matching `keyAuthorization` at
 * `http://<domain>/.well-known/acme-challenge/<token>` over plaintext HTTP.
 *
 * The control plane writes those files into a state directory; NGINX is
 * configured (separately, by the bootstrap config) to serve that directory
 * for the `.well-known/acme-challenge/` path on port 80 for every site.
 *
 * This module is intentionally tiny: a token-to-file mapping with strict
 * input validation. Anything fancier (e.g. an in-memory store, an
 * orchestrator across nodes) is out of scope for the single-host control
 * plane.
 */

import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { ValidationError } from '../domain/errors.js';
import { writeAtomic } from '../reload/atomic-write.js';

/**
 * ACME token grammar — base64url alphabet, no padding, no slashes or dots.
 * This is what `acme-client` (and the spec) hand us, but we re-validate at
 * the boundary because the token becomes part of a filesystem path and a
 * traversal would let a hostile CA escape the challenge directory.
 */
const TOKEN_REGEX = /^[A-Za-z0-9_-]+$/;

export interface ChallengeStore {
  /**
   * Persist the `keyAuthorization` for `token` so NGINX can serve it.
   * Creates {@link basePath} on first call if missing.
   * Throws {@link ValidationError} if `token` contains characters outside
   * the base64url alphabet — refuse the write rather than risk a path
   * traversal.
   */
  write(token: string, keyAuthorization: string): Promise<void>;

  /**
   * Remove the challenge file for `token`. ENOENT is swallowed so callers
   * can use this as cleanup in both success and failure paths without
   * tracking which tokens they actually wrote.
   */
  remove(token: string): Promise<void>;

  /**
   * Absolute path to the `.well-known/acme-challenge/` directory the store
   * writes into. Surfaced so the NGINX site renderer and the cleanup worker
   * can read it without re-deriving the convention.
   */
  basePath: string;
}

export interface CreateChallengeStoreOptions {
  /**
   * Override the state directory. Defaults to `$ZOOMIES_STATE_DIR`, or
   * `<cwd>/.zoomies` if that env var is unset (matches `db-context.ts`).
   */
  stateDir?: string;
}

function resolveBasePath(opts?: CreateChallengeStoreOptions): string {
  const stateDir =
    opts?.stateDir ?? process.env.ZOOMIES_STATE_DIR ?? join(process.cwd(), '.zoomies');
  return join(stateDir, 'acme', '.well-known', 'acme-challenge');
}

function assertValidToken(token: string): void {
  if (!TOKEN_REGEX.test(token)) {
    throw new ValidationError(`invalid ACME challenge token: ${JSON.stringify(token)}`);
  }
}

/**
 * Build a ChallengeStore bound to the resolved base directory.
 *
 * Pure factory: no I/O happens until the first call to {@link
 * ChallengeStore.write}.
 */
export function createChallengeStore(opts?: CreateChallengeStoreOptions): ChallengeStore {
  const basePath = resolveBasePath(opts);

  return {
    basePath,

    async write(token: string, keyAuthorization: string): Promise<void> {
      assertValidToken(token);
      await mkdir(basePath, { recursive: true });
      await writeAtomic(join(basePath, token), keyAuthorization);
    },

    async remove(token: string): Promise<void> {
      assertValidToken(token);
      try {
        await unlink(join(basePath, token));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return;
        }
        throw err;
      }
    },
  };
}
