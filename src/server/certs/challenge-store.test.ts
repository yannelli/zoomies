import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ValidationError } from '../domain/errors.js';
import { createChallengeStore } from './challenge-store.js';

describe('createChallengeStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zoomies-challenge-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the key authorization under acme/.well-known/acme-challenge and creates the directory tree on demand', async () => {
    const store = createChallengeStore({ stateDir: dir });

    await store.write('valid-token', 'key-auth-string');

    // basePath is the documented location and the file lives directly under it.
    expect(store.basePath).toBe(join(dir, 'acme', '.well-known', 'acme-challenge'));
    expect(await readFile(join(store.basePath, 'valid-token'), 'utf8')).toBe('key-auth-string');
  });

  it('rejects tokens containing path-traversal characters with ValidationError', async () => {
    const store = createChallengeStore({ stateDir: dir });

    await expect(store.write('../../../etc/passwd', 'pwn')).rejects.toBeInstanceOf(ValidationError);

    // Nothing escaped onto disk: the acme tree was never even created
    // because the validation happens before the mkdir.
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it('rejects tokens with dots or slashes too', async () => {
    const store = createChallengeStore({ stateDir: dir });

    await expect(store.write('has.dot', 'x')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.write('has/slash', 'x')).rejects.toBeInstanceOf(ValidationError);
  });

  it('removes a previously-written challenge file', async () => {
    const store = createChallengeStore({ stateDir: dir });
    await store.write('token-to-remove', 'kx');

    await store.remove('token-to-remove');

    await expect(readdir(store.basePath)).resolves.toEqual([]);
  });

  it('remove is a no-op when the token file does not exist (ENOENT swallowed)', async () => {
    const store = createChallengeStore({ stateDir: dir });
    await store.write('present', 'kx');

    // First remove deletes the file; second is the no-op we care about.
    await store.remove('present');
    await expect(store.remove('present')).resolves.toBeUndefined();
  });

  it('handles concurrent writes for distinct tokens without corrupting each other', async () => {
    const store = createChallengeStore({ stateDir: dir });

    const tokens = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    await Promise.all(tokens.map((t) => store.write(t, `ka-${t}`)));

    for (const t of tokens) {
      expect(await readFile(join(store.basePath, t), 'utf8')).toBe(`ka-${t}`);
    }
  });
});
