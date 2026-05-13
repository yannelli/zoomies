import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { NotFoundError } from '../domain/errors.js';

/**
 * Rollback handle returned from {@link writeAtomic} and {@link deleteAtomic}.
 *
 * The orchestrator (Phase 5 Stage 2) collects these handles in order so it
 * can unwind a multi-file change when `nginx -t` rejects the new bundle.
 * `restore()` must be idempotent: calling it twice is a no-op the second
 * time (and any time after).
 */
export interface AtomicRollback {
  restore(): Promise<void>;
}

/**
 * Snapshot of the prior state of a path, captured before mutation so we can
 * restore it byte-exact on rollback.
 *
 * `existed: false` is distinct from `existed: true` with empty contents —
 * the former rolls back to "no file", the latter to "empty file".
 */
type PriorState = { existed: false } | { existed: true; contents: Buffer; mode: number };

/**
 * Suffix appended to the target path for the temp file inside the atomic
 * write/rename dance. Kept predictable (not random) — if two writers race
 * on the same path that is the orchestrator's problem to serialize.
 */
const NEW_SUFFIX = '.new';

/**
 * Read the current contents and mode of `path`, returning a snapshot we can
 * later restore. Distinguishes "file did not exist" from "file existed and
 * was empty" — both are valid prior states with very different rollbacks.
 */
async function snapshot(path: string): Promise<PriorState> {
  try {
    const [contents, info] = await Promise.all([readFile(path), stat(path)]);
    return { existed: true, contents, mode: info.mode };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { existed: false };
    }
    throw err;
  }
}

/**
 * `fsync` the directory that contains `path` so the rename we just did is
 * durable across power loss. POSIX semantics: a successful `rename` is only
 * guaranteed to survive a crash once the parent directory has been synced.
 *
 * On Windows opening a directory for fsync fails — Linux/macOS are the real
 * targets for this control plane, so we catch and ignore the error rather
 * than make the utility unusable for local dev on Windows.
 */
async function fsyncDir(path: string): Promise<void> {
  const dir = dirname(path);
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Best-effort durability. Don't mask the caller's success on Windows.
  }
}

/**
 * Write `contents` to `${path}.new`, fsync it, then rename it over `path`,
 * then fsync the parent directory. This is the core atomic-write dance used
 * for both the initial write and the rollback restore.
 *
 * The `.new` file is always in the same directory as the target so that
 * `rename` is an in-filesystem operation (atomic on POSIX). If a previous
 * crashed run left a stale `${path}.new`, `writeFile` overwrites it.
 *
 * `mode` is forwarded to `writeFile` so we can preserve the prior file's
 * permissions when restoring on rollback.
 */
async function atomicReplace(
  path: string,
  contents: Buffer | string,
  mode?: number,
): Promise<void> {
  const tmp = `${path}${NEW_SUFFIX}`;

  await writeFile(tmp, contents, mode === undefined ? undefined : { mode });

  const handle = await open(tmp, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(tmp, path);
  await fsyncDir(path);
}

/**
 * Atomically write `contents` to `path`, returning a rollback handle that
 * can restore the prior state.
 *
 * Algorithm:
 *   1. Snapshot the prior state of `path` (contents + mode, or "didn't
 *      exist") into memory.
 *   2. Write `contents` to `${path}.new` in the same directory.
 *   3. fsync the `.new` file so its data is durable before rename.
 *   4. `rename(${path}.new, path)` — atomic on POSIX same-filesystem.
 *   5. fsync the parent directory so the rename itself is durable.
 *
 * Rollback (`restore()`):
 *   - If the prior state was "didn't exist", `unlink(path)`.
 *   - Otherwise run the same atomic-replace dance with the stashed bytes
 *     and mode.
 *   - Idempotent: a second `restore()` call is a no-op.
 */
export async function writeAtomic(path: string, contents: string): Promise<AtomicRollback> {
  const prior = await snapshot(path);

  await atomicReplace(path, contents);

  let restored = false;
  return {
    async restore(): Promise<void> {
      if (restored) {
        return;
      }
      restored = true;

      if (!prior.existed) {
        try {
          await unlink(path);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
          }
          throw err;
        }
        await fsyncDir(path);
        return;
      }

      await atomicReplace(path, prior.contents, prior.mode);
    },
  };
}

/**
 * Atomically delete `path`, returning a rollback handle that restores the
 * file byte-exact (including its mode).
 *
 * Throws {@link NotFoundError} if the target path does not exist — unlike
 * `writeAtomic`, delete is meaningless against an absent file and the
 * orchestrator should treat that as a precondition failure.
 *
 * Rollback (`restore()`):
 *   - Atomically re-creates the file with the stashed contents and mode.
 *   - Idempotent: a second `restore()` is a no-op.
 */
export async function deleteAtomic(path: string): Promise<AtomicRollback> {
  const prior = await snapshot(path);
  if (!prior.existed) {
    throw new NotFoundError(`cannot delete: file does not exist at ${path}`);
  }

  await unlink(path);
  await fsyncDir(path);

  let restored = false;
  return {
    async restore(): Promise<void> {
      if (restored) {
        return;
      }
      restored = true;

      await atomicReplace(path, prior.contents, prior.mode);
    },
  };
}
