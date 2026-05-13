/**
 * Reload orchestrator — the single chokepoint that turns a freshly rendered
 * bundle into a live NGINX configuration.
 *
 * The orchestrator is the only place in the codebase allowed to mutate the
 * managed sites directory or send a signal to NGINX. It is deliberately
 * dependency-injected: every external side effect (validate, write, delete,
 * reload, probe, listdir) is exposed via {@link ReloadDeps} so tests can drive
 * each failure path without touching the real filesystem or nginx binary.
 *
 * Flow (each step short-circuits on failure with a labeled {@link ApplyResult}):
 *
 *   1. Validate the candidate via `nginx -t` — pure check, no disk writes.
 *   2. Diff disk against `rendered` to compute the writes + orphan deletes.
 *   3. Apply writes/deletes, accumulating rollback handles in order.
 *   4. SIGHUP NGINX. If it refuses, roll back everything and reload again.
 *   5. Probe the configured health URL. If it fails, roll back + reload again.
 *   6. Success: discard rollback handles.
 *
 * On any step that triggers a rollback we re-run the reload so NGINX matches
 * the disk we just restored. If that second reload also fails, we log both
 * stderrs and still return the original failure — operator intervention is
 * needed anyway, and recursing would hide the real cause.
 */

import { execa } from 'execa';
import { readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { getNginxBinary } from '../validator/nginx-binary.js';
import { validateConfig, type ValidationResult } from '../validator/validate.js';

import {
  type AtomicRollback,
  deleteAtomic as deleteAtomicImpl,
  writeAtomic as writeAtomicImpl,
} from './atomic-write.js';
import { type HealthProbeOptions, type HealthProbeResult, probeHealth } from './health-probe.js';

/**
 * Minimal subset of `execa`'s result we care about. We only need to know
 * whether the call succeeded and what NGINX wrote to stderr so we can surface
 * it on failure. Keeping the shape narrow lets tests construct fakes without
 * pretending to be the full execa contract.
 */
export interface NginxReloadResult {
  exitCode: number | null;
  stderr: string;
}

/**
 * Dependency-injection seam. Production code constructs the defaults inside
 * {@link applyDesiredState} when `opts.deps` is omitted; tests pass an
 * exhaustive object so the orchestrator's behaviour is fully observable.
 *
 * `listManagedFiles` returns absolute paths of the `*.conf` files currently
 * sitting in `sitesDir`. The default implementation handles ENOENT (treating
 * it as an empty directory) so the first run before the operator has created
 * the directory does not fail.
 */
export interface ReloadDeps {
  validate: (text: string) => Promise<ValidationResult>;
  reload: (bin: string, args: readonly string[]) => Promise<NginxReloadResult>;
  probe: (opts: HealthProbeOptions) => Promise<HealthProbeResult>;
  listManagedFiles: (sitesDir: string) => Promise<string[]>;
  writeAtomic: typeof writeAtomicImpl;
  deleteAtomic: typeof deleteAtomicImpl;
}

/**
 * Caller-supplied configuration for {@link applyDesiredState}. The required
 * fields are the two paths/URLs the orchestrator cannot know on its own;
 * everything else is either a defaulted knob or a test seam.
 */
export interface ApplyDesiredStateOptions {
  sitesDir: string;
  healthCheckUrl: string;
  healthCheckOptions?: Partial<Omit<HealthProbeOptions, 'url'>>;
  /** Default: `['-s', 'reload']`. */
  nginxReloadArgs?: readonly string[];
  /** Test seam — production code never passes this. */
  deps?: Partial<ReloadDeps>;
}

/**
 * Discriminator for {@link ApplyResult}. Names match the flow steps above so
 * an operator reading a log line can see exactly where the apply stopped.
 * `success` is the only positive value.
 */
export type ApplyStep = 'validate' | 'write' | 'reload' | 'probe' | 'success';

/**
 * Outcome of a single `applyDesiredState` call.
 *
 * - On success: `{ ok: true, step: 'success' }`.
 * - On failure: `{ ok: false, step: <where it stopped>, ... }` with whichever
 *   contextual fields the failing step produced (e.g. the failed
 *   {@link ValidationResult} or {@link HealthProbeResult}).
 *
 * The orchestrator never throws on operational failures — Route Handlers and
 * the CLI both need a predictable result object to map onto HTTP statuses /
 * exit codes. Programmer errors (e.g. a bad rollback) are still propagated.
 */
export interface ApplyResult {
  ok: boolean;
  step: ApplyStep;
  message?: string;
  validation?: ValidationResult;
  probe?: HealthProbeResult;
}

/** Default argv for `nginx -s reload`. Kept as a constant so tests can compare by reference. */
const DEFAULT_RELOAD_ARGS: readonly string[] = ['-s', 'reload'];

/**
 * Concatenate the rendered per-site fragments into a single candidate the
 * validator can `nginx -t`. Blank-line separated so NGINX parses cleanly even
 * when individual fragments end without trailing newlines.
 */
function joinRendered(rendered: ReadonlyMap<string, string>): string {
  return Array.from(rendered.values()).join('\n\n');
}

/**
 * Default `listManagedFiles` — read every `*.conf` directly inside `sitesDir`
 * and return absolute paths. ENOENT (the dir hasn't been created yet) is
 * treated as "empty" so first-run installs work without a pre-step.
 *
 * We do not recurse: Zoomies owns this directory flatly. If an operator drops
 * a subdirectory in here, we ignore it.
 */
async function defaultListManagedFiles(sitesDir: string): Promise<string[]> {
  try {
    const entries = await readdir(sitesDir);
    return entries.filter((name) => name.endsWith('.conf')).map((name) => resolve(sitesDir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Default `reload` — thin wrapper around `execa` that follows the project's
 * no-shell rule (argv array, never a string). `reject: false` lets us surface
 * a non-zero exit as a normal return value instead of an exception, which is
 * what the orchestrator needs to decide on rollback.
 */
async function defaultReload(bin: string, args: readonly string[]): Promise<NginxReloadResult> {
  const result = await execa(bin, [...args], { reject: false });
  return {
    exitCode: result.exitCode ?? null,
    stderr: result.stderr ?? '',
  };
}

/**
 * Build the full {@link ReloadDeps} record, layering caller overrides onto
 * the defaults. The defaults are constructed lazily here (rather than at
 * module load) so tests that stub the validator or atomic-write modules can
 * still benefit from those stubs without monkey-patching this file.
 */
function resolveDeps(overrides: Partial<ReloadDeps> | undefined): ReloadDeps {
  return {
    validate: overrides?.validate ?? validateConfig,
    reload: overrides?.reload ?? defaultReload,
    probe: overrides?.probe ?? probeHealth,
    listManagedFiles: overrides?.listManagedFiles ?? defaultListManagedFiles,
    writeAtomic: overrides?.writeAtomic ?? writeAtomicImpl,
    deleteAtomic: overrides?.deleteAtomic ?? deleteAtomicImpl,
  };
}

/**
 * Determine which files on disk are no longer wanted (orphans to delete) and
 * which sites need their config written (the full `rendered` set — we always
 * overwrite, even if the contents happen to match what is on disk, because
 * `writeAtomic`'s rollback semantics rely on snapshotting the prior bytes).
 *
 * Orphans are matched by basename: a file `foo.conf` whose `foo` is not a key
 * in `rendered` gets deleted. Subtle edge case: a file ending in `.conf.new`
 * would not be filtered here because we accept only basename-ends-with-conf
 * via `defaultListManagedFiles`. That filter lives in the listing layer so
 * the orchestrator can stay agnostic about disk layout.
 */
function planDiff(
  rendered: ReadonlyMap<string, string>,
  sitesDir: string,
  existing: readonly string[],
): { toWrite: Array<{ path: string; contents: string }>; toDelete: string[] } {
  const desiredIds = new Set(rendered.keys());

  const toDelete: string[] = [];
  for (const filePath of existing) {
    const id = basename(filePath, '.conf');
    if (!desiredIds.has(id)) {
      toDelete.push(filePath);
    }
  }

  const toWrite: Array<{ path: string; contents: string }> = [];
  for (const [siteId, contents] of rendered) {
    toWrite.push({ path: resolve(sitesDir, `${siteId}.conf`), contents });
  }

  return { toWrite, toDelete };
}

/**
 * Restore every rollback handle in reverse order, swallowing individual
 * failures so a broken restore in the middle of the chain doesn't strand the
 * earlier handles. We log each failure so the operator can investigate.
 *
 * Reverse order matters because the handles model a sequence of changes:
 * the last write may have replaced a file that the previous delete had just
 * removed. Unwinding LIFO mirrors the apply order and keeps the intermediate
 * states consistent.
 */
async function rollbackAll(handles: readonly AtomicRollback[]): Promise<void> {
  for (let i = handles.length - 1; i >= 0; i -= 1) {
    const handle = handles[i];
    if (handle === undefined) {
      // Guard for noUncheckedIndexedAccess; cannot actually happen because i
      // is always within bounds, but the type-system needs the check.
      continue;
    }
    try {
      await handle.restore();
    } catch (err) {
      console.error('zoomies: rollback handle failed to restore:', err);
    }
  }
}

/**
 * Apply a freshly rendered bundle to the managed sites directory.
 *
 * Contract:
 *   - `rendered` is the output of `renderBundle`: a map from site id to the
 *     NGINX `server { ... }` snippet for that site. Site ids are presumed
 *     safe (UUIDs per Phase 1); we do not sanitize them against `..`.
 *   - `opts.sitesDir` is the absolute path of the directory Zoomies owns.
 *     Anything `*.conf` in there that is not a current site id is an orphan
 *     and will be deleted.
 *   - `opts.healthCheckUrl` is the post-reload smoke test target.
 *
 * Behaviour:
 *   - Pure validation failure -> no disk side effects.
 *   - Disk-apply failure -> rolled back to the pre-call state, no reload.
 *   - Reload or probe failure -> rolled back AND a second reload kicks NGINX
 *     back to the pre-call state. If that second reload also fails the
 *     result still reports the original step (reload/probe) — operator
 *     intervention is required either way.
 *
 * Returns an {@link ApplyResult}. Never throws on operational failures.
 */
export async function applyDesiredState(
  rendered: ReadonlyMap<string, string>,
  opts: ApplyDesiredStateOptions,
): Promise<ApplyResult> {
  const deps = resolveDeps(opts.deps);
  const reloadArgs = opts.nginxReloadArgs ?? DEFAULT_RELOAD_ARGS;

  // Step 1: validate. Pure check — no disk writes, no NGINX signals.
  const candidate = joinRendered(rendered);
  const validation = await deps.validate(candidate);
  if (!validation.ok) {
    return { ok: false, step: 'validate', validation };
  }

  // Step 2: diff disk against desired state.
  const existing = await deps.listManagedFiles(opts.sitesDir);
  const { toWrite, toDelete } = planDiff(rendered, opts.sitesDir, existing);

  // Step 3: apply writes/deletes, accumulating rollback handles in order.
  // Any single failure rolls back everything accumulated so far and aborts
  // BEFORE we touch NGINX — disk is back where it started, no reload needed.
  const rollbacks: AtomicRollback[] = [];
  try {
    for (const { path, contents } of toWrite) {
      const handle = await deps.writeAtomic(path, contents);
      rollbacks.push(handle);
    }
    for (const path of toDelete) {
      const handle = await deps.deleteAtomic(path);
      rollbacks.push(handle);
    }
  } catch (err) {
    await rollbackAll(rollbacks);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, step: 'write', message };
  }

  // Step 4: reload NGINX. If it refuses the new bundle, we need to roll the
  // disk back AND tell NGINX to re-read the (now restored) config so its
  // in-memory state matches what we just wrote.
  const reloadResult = await deps.reload(getNginxBinary(), reloadArgs);
  if (reloadResult.exitCode !== 0) {
    await rollbackAll(rollbacks);
    const secondReload = await deps.reload(getNginxBinary(), reloadArgs);
    if (secondReload.exitCode !== 0) {
      // Both reloads failed — log the post-rollback stderr so the operator
      // has both ends of the story, but preserve the original failure as
      // the reported step. The system is in a hand-fix state either way.
      console.error(
        'zoomies: post-rollback reload also failed (exitCode=%s): %s',
        secondReload.exitCode,
        secondReload.stderr,
      );
    }
    return { ok: false, step: 'reload', message: reloadResult.stderr };
  }

  // Step 5: probe. The new config parsed and reloaded, but the upstream may
  // still be unreachable from the freshly reloaded NGINX. A failed probe
  // means the new bundle is bad in a way `nginx -t` cannot detect — roll
  // back and re-reload to restore the prior working configuration.
  const probeResult = await deps.probe({
    url: opts.healthCheckUrl,
    ...opts.healthCheckOptions,
  });
  if (!probeResult.ok) {
    await rollbackAll(rollbacks);
    const secondReload = await deps.reload(getNginxBinary(), reloadArgs);
    if (secondReload.exitCode !== 0) {
      console.error(
        'zoomies: post-rollback reload also failed (exitCode=%s): %s',
        secondReload.exitCode,
        secondReload.stderr,
      );
    }
    return { ok: false, step: 'probe', probe: probeResult };
  }

  // Step 6: success. Rollback handles are deliberately not invoked — the
  // change is now the committed state.
  return { ok: true, step: 'success' };
}
