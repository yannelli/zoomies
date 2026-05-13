import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NotFoundError } from '../domain/errors.js';
import { deleteAtomic, writeAtomic } from './atomic-write.js';

describe('atomic-write', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zoomies-atomic-write-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('writeAtomic', () => {
    it('creates a fresh file with the given contents and leaves no .new sidecar', async () => {
      const target = join(dir, 'fresh.conf');

      await writeAtomic(target, 'hello\n');

      const contents = await readFile(target, 'utf8');
      expect(contents).toBe('hello\n');

      const entries = await readdir(dir);
      expect(entries).toEqual(['fresh.conf']);
    });

    it('replaces the contents of an existing file', async () => {
      const target = join(dir, 'existing.conf');
      await writeFile(target, 'old', 'utf8');

      await writeAtomic(target, 'new contents');

      expect(await readFile(target, 'utf8')).toBe('new contents');
    });

    it('round-trips a string containing binary NUL bytes byte-exact', async () => {
      const target = join(dir, 'binary.bin');
      const payload = '\x00abc\x00';

      await writeAtomic(target, payload);

      const raw = await readFile(target);
      expect(raw.equals(Buffer.from(payload, 'binary'))).toBe(true);
      // Sanity: the expected buffer is exactly the NUL-framed bytes.
      expect(raw.equals(Buffer.from([0x00, 0x61, 0x62, 0x63, 0x00]))).toBe(true);
    });

    it('overwrites a stale ${path}.new sidecar left from a crashed prior run', async () => {
      const target = join(dir, 'recover.conf');
      await writeFile(`${target}.new`, 'leftover garbage', 'utf8');

      await writeAtomic(target, 'fresh');

      expect(await readFile(target, 'utf8')).toBe('fresh');
      const entries = await readdir(dir);
      expect(entries.sort()).toEqual(['recover.conf']);
    });
  });

  describe('writeAtomic rollback', () => {
    it('removes the file when the prior state was "did not exist"', async () => {
      const target = join(dir, 'rollback-fresh.conf');

      const handle = await writeAtomic(target, 'will be rolled back');
      await handle.restore();

      const entries = await readdir(dir);
      expect(entries).toEqual([]);
    });

    it('restores the previous contents byte-exact, including trailing newline', async () => {
      const target = join(dir, 'rollback-existing.conf');
      const original = 'server {\n  listen 80;\n}\n';
      await writeFile(target, original, 'utf8');

      const handle = await writeAtomic(target, 'replacement that loses the newline');
      await handle.restore();

      expect(await readFile(target, 'utf8')).toBe(original);
    });

    it('restores file mode on rollback when restoring a chmodded file', async () => {
      const target = join(dir, 'rollback-mode.conf');
      await writeFile(target, 'mode-preserving', 'utf8');
      await chmod(target, 0o600);
      const originalMode = (await stat(target)).mode;

      const handle = await writeAtomic(target, 'overwrite');
      await handle.restore();

      const restoredMode = (await stat(target)).mode;
      expect(restoredMode).toBe(originalMode);
    });

    it('is idempotent — calling restore twice does not throw or double-write', async () => {
      const target = join(dir, 'idempotent.conf');
      await writeFile(target, 'first', 'utf8');

      const handle = await writeAtomic(target, 'second');
      await handle.restore();
      // If restore weren't idempotent, calling it again on an already-restored
      // "fresh path" would either error or clobber the restored bytes.
      await expect(handle.restore()).resolves.toBeUndefined();

      expect(await readFile(target, 'utf8')).toBe('first');
    });

    it('idempotent restore on a fresh-path rollback does not throw on the second call', async () => {
      const target = join(dir, 'idempotent-fresh.conf');

      const handle = await writeAtomic(target, 'created');
      await handle.restore();
      await expect(handle.restore()).resolves.toBeUndefined();

      const entries = await readdir(dir);
      expect(entries).toEqual([]);
    });
  });

  describe('deleteAtomic', () => {
    it('removes the file and rollback restores it byte-exact', async () => {
      const target = join(dir, 'gone.conf');
      const original = 'upstream u { server 127.0.0.1:8080; }\n';
      await writeFile(target, original, 'utf8');

      const handle = await deleteAtomic(target);
      expect(await readdir(dir)).toEqual([]);

      await handle.restore();
      expect(await readFile(target, 'utf8')).toBe(original);
    });

    it('throws NotFoundError when the target path does not exist', async () => {
      const target = join(dir, 'never-existed.conf');

      await expect(deleteAtomic(target)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rollback is idempotent — a second restore call is a no-op', async () => {
      const target = join(dir, 'delete-idempotent.conf');
      await writeFile(target, 'persistent', 'utf8');

      const handle = await deleteAtomic(target);
      await handle.restore();
      await expect(handle.restore()).resolves.toBeUndefined();

      expect(await readFile(target, 'utf8')).toBe('persistent');
    });

    it('preserves file mode across delete + rollback', async () => {
      const target = join(dir, 'delete-mode.conf');
      await writeFile(target, 'permissions matter', 'utf8');
      await chmod(target, 0o600);
      const originalMode = (await stat(target)).mode;

      const handle = await deleteAtomic(target);
      await handle.restore();

      expect((await stat(target)).mode).toBe(originalMode);
    });
  });
});
