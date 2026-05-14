import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AtomicRollback } from './atomic-write.js';
import type { HealthProbeOptions, HealthProbeResult } from './health-probe.js';
import {
  applyDesiredState,
  signalReload,
  type ApplyDesiredStateOptions,
  type NginxReloadResult,
  type ReloadDeps,
} from './reload.js';
import type { ValidationResult } from '../validator/validate.js';

// Shared sites dir for all cases. Tests stub the listManagedFiles dep so no
// real fs access happens — this string just appears in the paths the
// orchestrator computes via path.resolve.
const SITES_DIR = '/etc/zoomies/nginx/sites';

/**
 * Build a `validate` mock that always returns ok=true. Tests that need a
 * validation failure override this explicitly.
 */
function okValidation(): ValidationResult {
  return { ok: true, stdout: '', stderr: '', exitCode: 0 };
}

function failValidation(stderr = 'nginx: [emerg] bad config'): ValidationResult {
  return { ok: false, stdout: '', stderr, exitCode: 1 };
}

/**
 * Helper to construct a rollback handle whose `restore()` is a tracked spy.
 * The orchestrator only ever calls `.restore()` so this shape is sufficient.
 */
function makeRollback(): AtomicRollback & { restore: ReturnType<typeof vi.fn> } {
  const handle = {
    restore: vi.fn(async () => {}),
  };
  return handle;
}

/**
 * Convenience: build a full `ReloadDeps` populated with no-op defaults. Each
 * test overrides whichever fields it needs to assert against.
 */
function makeDeps(overrides: Partial<ReloadDeps> = {}): {
  deps: ReloadDeps;
  spies: {
    validate: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    probe: ReturnType<typeof vi.fn>;
    listManagedFiles: ReturnType<typeof vi.fn>;
    writeAtomic: ReturnType<typeof vi.fn>;
    deleteAtomic: ReturnType<typeof vi.fn>;
  };
} {
  const validate = vi.fn(async (_text: string): Promise<ValidationResult> => okValidation());
  const reload = vi.fn(
    async (_bin: string, _args: readonly string[]): Promise<NginxReloadResult> => ({
      exitCode: 0,
      stderr: '',
    }),
  );
  const probe = vi.fn(
    async (_opts: HealthProbeOptions): Promise<HealthProbeResult> => ({
      ok: true,
      attempts: 1,
      lastStatus: 200,
    }),
  );
  const listManagedFiles = vi.fn(async (_dir: string): Promise<string[]> => []);
  const writeAtomic = vi.fn(async (_path: string, _contents: string) => makeRollback());
  const deleteAtomic = vi.fn(async (_path: string) => makeRollback());

  const deps: ReloadDeps = {
    validate,
    reload,
    probe,
    listManagedFiles,
    writeAtomic,
    deleteAtomic,
    ...overrides,
  };
  return {
    deps,
    spies: { validate, reload, probe, listManagedFiles, writeAtomic, deleteAtomic },
  };
}

function makeOpts(
  deps: ReloadDeps,
  extras: Partial<ApplyDesiredStateOptions> = {},
): ApplyDesiredStateOptions {
  return {
    sitesDir: SITES_DIR,
    healthCheckUrl: 'http://127.0.0.1/healthz',
    deps,
    ...extras,
  };
}

beforeEach(() => {
  // The orchestrator reads ZOOMIES_NGINX_BIN via getNginxBinary() when it
  // builds the argv for `reload`. Pin a deterministic value so assertions on
  // the binary argument are stable across environments.
  vi.stubEnv('ZOOMIES_NGINX_BIN', '/usr/sbin/nginx');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('applyDesiredState — happy path', () => {
  it('writes both sites, reloads, probes, and reports success', async () => {
    const { deps, spies } = makeDeps();
    const rendered = new Map<string, string>([
      ['site-a', 'server { listen 80; }'],
      ['site-b', 'server { listen 443; }'],
    ]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result).toEqual({ ok: true, step: 'success' });

    // Both sites written exactly once, to fully-qualified paths.
    expect(spies.writeAtomic).toHaveBeenCalledTimes(2);
    expect(spies.writeAtomic).toHaveBeenNthCalledWith(
      1,
      `${SITES_DIR}/site-a.conf`,
      'server { listen 80; }',
    );
    expect(spies.writeAtomic).toHaveBeenNthCalledWith(
      2,
      `${SITES_DIR}/site-b.conf`,
      'server { listen 443; }',
    );

    // No deletes (disk was empty), one reload, one probe.
    expect(spies.deleteAtomic).not.toHaveBeenCalled();
    expect(spies.reload).toHaveBeenCalledTimes(1);
    expect(spies.reload).toHaveBeenCalledWith('/usr/sbin/nginx', ['-s', 'reload']);
    expect(spies.probe).toHaveBeenCalledTimes(1);
    expect(spies.probe).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://127.0.0.1/healthz' }),
    );
  });
});

describe('applyDesiredState — validation failure', () => {
  it('returns step=validate and performs no disk or NGINX side effects', async () => {
    const badValidation = failValidation();
    const { deps, spies } = makeDeps({
      validate: vi.fn(async () => badValidation),
    });
    const rendered = new Map<string, string>([['s', 'server {}']]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result).toEqual({ ok: false, step: 'validate', validation: badValidation });
    expect(spies.writeAtomic).not.toHaveBeenCalled();
    expect(spies.deleteAtomic).not.toHaveBeenCalled();
    expect(spies.reload).not.toHaveBeenCalled();
    expect(spies.probe).not.toHaveBeenCalled();
    // listManagedFiles is also irrelevant if validation fails — we never
    // reach the diff step.
    expect(spies.listManagedFiles).not.toHaveBeenCalled();
  });
});

describe('applyDesiredState — orphan deletion', () => {
  it('deletes a leftover file when rendered is empty', async () => {
    const orphanPath = `${SITES_DIR}/old-site.conf`;
    const { deps, spies } = makeDeps({
      listManagedFiles: vi.fn(async () => [orphanPath]),
    });

    const result = await applyDesiredState(new Map(), makeOpts(deps));

    expect(result).toEqual({ ok: true, step: 'success' });
    expect(spies.writeAtomic).not.toHaveBeenCalled();
    expect(spies.deleteAtomic).toHaveBeenCalledTimes(1);
    expect(spies.deleteAtomic).toHaveBeenCalledWith(orphanPath);
    expect(spies.reload).toHaveBeenCalledTimes(1);
    expect(spies.probe).toHaveBeenCalledTimes(1);
  });
});

describe('applyDesiredState — update existing site', () => {
  it('overwrites the existing config when the site id is still present', async () => {
    const sitePath = `${SITES_DIR}/site-x.conf`;
    const { deps, spies } = makeDeps({
      listManagedFiles: vi.fn(async () => [sitePath]),
    });
    const rendered = new Map<string, string>([['site-x', 'server { listen 8080; }']]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result).toEqual({ ok: true, step: 'success' });
    expect(spies.writeAtomic).toHaveBeenCalledTimes(1);
    expect(spies.writeAtomic).toHaveBeenCalledWith(sitePath, 'server { listen 8080; }');
    expect(spies.deleteAtomic).not.toHaveBeenCalled();
  });
});

describe('applyDesiredState — mixed diff', () => {
  it('adds, deletes, and updates exactly once each', async () => {
    // Disk has `keep` (will update) and `gone` (will delete). Rendered has
    // `keep` (with new contents) and `new` (will create). Net: 2 writes, 1
    // delete.
    const keepPath = `${SITES_DIR}/keep.conf`;
    const gonePath = `${SITES_DIR}/gone.conf`;
    const newPath = `${SITES_DIR}/new.conf`;

    const { deps, spies } = makeDeps({
      listManagedFiles: vi.fn(async () => [keepPath, gonePath]),
    });
    const rendered = new Map<string, string>([
      ['keep', 'server { keep_new; }'],
      ['new', 'server { brand_new; }'],
    ]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result).toEqual({ ok: true, step: 'success' });
    expect(spies.writeAtomic).toHaveBeenCalledTimes(2);
    const writePaths = spies.writeAtomic.mock.calls.map((call) => call[0]);
    expect(writePaths).toEqual(expect.arrayContaining([keepPath, newPath]));
    expect(spies.deleteAtomic).toHaveBeenCalledTimes(1);
    expect(spies.deleteAtomic).toHaveBeenCalledWith(gonePath);
  });
});

describe('applyDesiredState — write failure', () => {
  it('rolls back prior writes when a subsequent write rejects, and skips reload/probe', async () => {
    const firstRollback = makeRollback();
    const writeAtomic = vi
      .fn()
      .mockResolvedValueOnce(firstRollback)
      .mockRejectedValueOnce(new Error('EACCES: permission denied'));

    const { deps, spies } = makeDeps({ writeAtomic });
    const rendered = new Map<string, string>([
      ['a', 'A'],
      ['b', 'B'],
    ]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result.ok).toBe(false);
    expect(result.step).toBe('write');
    expect(result.message).toContain('EACCES');

    // The first write's rollback handle must have been restored before we
    // bail. No reload, no probe — the second reload path is only triggered
    // when NGINX has been signalled.
    expect(firstRollback.restore).toHaveBeenCalledTimes(1);
    expect(spies.reload).not.toHaveBeenCalled();
    expect(spies.probe).not.toHaveBeenCalled();
  });
});

describe('applyDesiredState — reload failure', () => {
  it('rolls back in reverse order, re-reloads, and reports step=reload', async () => {
    const r1 = makeRollback();
    const r2 = makeRollback();
    const callOrder: string[] = [];
    r1.restore.mockImplementation(async () => {
      callOrder.push('r1');
    });
    r2.restore.mockImplementation(async () => {
      callOrder.push('r2');
    });

    const writeAtomic = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const reload = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'reload-fail' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '' });

    const { deps, spies } = makeDeps({ writeAtomic, reload });
    const rendered = new Map<string, string>([
      ['a', 'A'],
      ['b', 'B'],
    ]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result.ok).toBe(false);
    expect(result.step).toBe('reload');
    expect(result.message).toBe('reload-fail');

    // Reverse order: r2 (most recent change) first, then r1.
    expect(callOrder).toEqual(['r2', 'r1']);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(spies.probe).not.toHaveBeenCalled();
  });
});

describe('applyDesiredState — probe failure', () => {
  it('rolls back, re-reloads, and reports step=probe with the probe result', async () => {
    const r1 = makeRollback();
    const r2 = makeRollback();
    const writeAtomic = vi.fn().mockResolvedValueOnce(r1).mockResolvedValueOnce(r2);
    const reload = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stderr: '' });
    const badProbe: HealthProbeResult = {
      ok: false,
      attempts: 5,
      lastStatus: 502,
      lastError: 'bad gateway',
    };
    const probe = vi.fn(async () => badProbe);

    const { deps } = makeDeps({ writeAtomic, reload, probe });
    const rendered = new Map<string, string>([
      ['a', 'A'],
      ['b', 'B'],
    ]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result).toEqual({ ok: false, step: 'probe', probe: badProbe });
    expect(r1.restore).toHaveBeenCalledTimes(1);
    expect(r2.restore).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe('applyDesiredState — probe failure with rollback-reload also failing', () => {
  it('still reports step=probe and does not throw', async () => {
    // Silence the expected console.error so test output stays tidy.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r1 = makeRollback();
    const writeAtomic = vi.fn().mockResolvedValueOnce(r1);
    const reload = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'second reload also failed' });
    const badProbe: HealthProbeResult = { ok: false, attempts: 5, lastError: 'unreachable' };
    const probe = vi.fn(async () => badProbe);

    const { deps } = makeDeps({ writeAtomic, reload, probe });
    const rendered = new Map<string, string>([['a', 'A']]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    // The probe failure is the canonical reason — don't override even when
    // the recovery reload also fails. Operator gets the original cause.
    expect(result).toEqual({ ok: false, step: 'probe', probe: badProbe });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('signalReload', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zoomies-pidfile-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('sends SIGHUP to the pid in the file and reports exitCode=0', async () => {
    const pidfile = join(tempDir, 'nginx.pid');
    await writeFile(pidfile, '4242\n');

    // Stub process.kill so the test doesn't actually try to signal pid 4242
    // (which is overwhelmingly likely to belong to something we shouldn't
    // disturb, if it exists at all).
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const result = await signalReload(pidfile);

    expect(result).toEqual({ exitCode: 0, stderr: '' });
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGHUP');
  });

  it('returns exitCode=1 with a descriptive stderr when the pidfile is missing', async () => {
    const pidfile = join(tempDir, 'absent.pid');

    const result = await signalReload(pidfile);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('read pidfile');
    expect(result.stderr).toContain(pidfile);
  });

  it('returns exitCode=1 when the pidfile does not contain a positive integer', async () => {
    const pidfile = join(tempDir, 'garbage.pid');
    await writeFile(pidfile, 'not-a-pid\n');

    const result = await signalReload(pidfile);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('did not contain a positive integer');
  });

  it('returns exitCode=1 when process.kill throws (e.g. ESRCH)', async () => {
    const pidfile = join(tempDir, 'stale.pid');
    await writeFile(pidfile, '99999\n');

    vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('kill ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    const result = await signalReload(pidfile);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SIGHUP pid 99999');
    expect(result.stderr).toContain('ESRCH');
  });
});

describe('applyDesiredState — pidfile-driven reload backend', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zoomies-pidfile-applyds-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('routes reloads through SIGHUP when ZOOMIES_NGINX_PIDFILE is set', async () => {
    const pidfile = join(tempDir, 'nginx.pid');
    await writeFile(pidfile, '1234\n');
    vi.stubEnv('ZOOMIES_NGINX_PIDFILE', pidfile);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    // Build a partial deps WITHOUT a reload override so the env-driven
    // default kicks in. Every other dep is stubbed so the orchestrator's
    // other steps stay pure.
    const partialDeps: Partial<ReloadDeps> = {
      validate: vi.fn(async () => okValidation()),
      probe: vi.fn(
        async (): Promise<HealthProbeResult> => ({ ok: true, attempts: 1, lastStatus: 200 }),
      ),
      listManagedFiles: vi.fn(async () => []),
      writeAtomic: vi.fn(async () => makeRollback()),
      deleteAtomic: vi.fn(async () => makeRollback()),
    };
    const opts: ApplyDesiredStateOptions = {
      sitesDir: SITES_DIR,
      healthCheckUrl: 'http://127.0.0.1/healthz',
      deps: partialDeps,
    };
    const rendered = new Map<string, string>([['a', 'A']]);

    const result = await applyDesiredState(rendered, opts);

    expect(result).toEqual({ ok: true, step: 'success' });
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(1234, 'SIGHUP');
  });
});

describe('applyDesiredState — listManagedFiles edge cases', () => {
  it('treats an empty listing as a no-orphan disk and proceeds', async () => {
    const { deps, spies } = makeDeps({
      // Inject a listing that returns [] — same shape the default produces
      // when the sites dir does not exist yet (ENOENT handled in the
      // default impl).
      listManagedFiles: vi.fn(async () => []),
    });
    const rendered = new Map<string, string>([['a', 'A']]);

    const result = await applyDesiredState(rendered, makeOpts(deps));

    expect(result).toEqual({ ok: true, step: 'success' });
    expect(spies.deleteAtomic).not.toHaveBeenCalled();
    expect(spies.writeAtomic).toHaveBeenCalledTimes(1);
  });
});
