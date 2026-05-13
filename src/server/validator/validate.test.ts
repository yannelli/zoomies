import { existsSync, readFileSync } from 'node:fs';
import type * as FsPromisesNS from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getNginxBinary } from './nginx-binary.js';
import { validateConfig } from './validate.js';

// `execa` is mocked at the module boundary so these tests run without a real
// NGINX binary on the box. The default mock returns a successful exit; each
// case overrides it with `mockResolvedValueOnce` to express its own scenario.
//
// We capture the execa argv via the mock so we can assert the validator
// builds the right command line, AND we use the mock as a synchronization
// point: the temp dir exists when execa is invoked but cleanup has not yet
// run, so the mock implementation can synchronously snapshot wrapper file
// contents for assertions that need to see disk state before cleanup wipes it.
const execaMock = vi.fn();
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

// `node:fs/promises` is mocked so a single test can force `rm` to throw and
// verify the validator's finally-block swallows that error rather than
// masking the underlying validation result. Every other entry point is a
// direct passthrough to the real implementation — we only need behavioral
// control over `rm`, not over `mkdtemp`/`writeFile`.
const rmFailureMessage = 'boom: rm failed';
const shouldRmFail = { value: false };
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromisesNS>('node:fs/promises');
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) => {
      if (shouldRmFail.value) {
        return Promise.reject(new Error(rmFailureMessage));
      }
      return actual.rm(...args);
    },
  };
});

interface ExecaCall {
  binary: string;
  argv: readonly string[];
  options: Record<string, unknown> | undefined;
}

function lastExecaCall(): ExecaCall {
  const call = execaMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('execa was not called');
  }
  const [binary, argv, options] = call as [string, readonly string[], Record<string, unknown>?];
  return { binary, argv, options };
}

beforeEach(() => {
  execaMock.mockReset();
  // Default: success. Individual tests override as needed.
  execaMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  shouldRmFail.value = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  shouldRmFail.value = false;
});

describe('validateConfig — command shape', () => {
  it('invokes the configured NGINX binary with argv ["-t", "-c", <wrapper>]', async () => {
    await validateConfig('upstream foo { server 127.0.0.1:80; } server { listen 80; }');

    expect(execaMock).toHaveBeenCalledTimes(1);
    const { binary, argv, options } = lastExecaCall();

    expect(binary).toBe(getNginxBinary());
    expect(argv).toHaveLength(3);
    expect(argv[0]).toBe('-t');
    expect(argv[1]).toBe('-c');
    expect(argv[2]).toMatch(/\/nginx\.conf$/);

    // Reject shell-string composition. The validator must always go through
    // execa's argv form so user-controlled config can never be interpreted
    // by a shell. Explicitly assert `shell` is not enabled.
    expect(options).toBeDefined();
    expect((options ?? {}).shell).toBeUndefined();
  });

  it('passes `reject: false` so a failed validation returns a result instead of throwing', async () => {
    await validateConfig('server { listen 80; }');
    const { options } = lastExecaCall();
    expect((options ?? {}).reject).toBe(false);
  });
});

describe('validateConfig — wrapper file contents', () => {
  it('writes a wrapper that contains events {}, http {, and an absolute include of site.conf', async () => {
    // Capture wrapper contents *inside* the execa mock. At that point the
    // validator has finished both writeFile calls but has not yet entered
    // the finally-block that removes the temp dir, so the disk state is
    // exactly what we want to assert against.
    let capturedWrapper: string | null = null;
    let capturedWrapperPath: string | null = null;

    execaMock.mockImplementationOnce((_binary: string, argv: readonly string[]) => {
      capturedWrapperPath = argv[2] ?? null;
      if (capturedWrapperPath) {
        capturedWrapper = readFileSync(capturedWrapperPath, 'utf8');
      }
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    });

    await validateConfig('upstream u { server 10.0.0.1:80; }');

    expect(capturedWrapperPath).toMatch(/\/nginx\.conf$/);
    expect(capturedWrapper).not.toBeNull();
    const wrapper = capturedWrapper as unknown as string;

    expect(wrapper).toContain('events');
    expect(wrapper).toContain('http {');

    // The include must point at an absolute path ending in site.conf —
    // NGINX resolves relative include paths against its own config prefix
    // (which we don't control), so a relative path would silently break.
    const includeMatch = wrapper.match(/include\s+(\S+);/);
    expect(includeMatch).not.toBeNull();
    const includePath = includeMatch![1]!;
    expect(includePath.startsWith('/')).toBe(true);
    expect(includePath.endsWith('/site.conf')).toBe(true);
  });
});

describe('validateConfig — result mapping', () => {
  it('returns ok=true on exit 0 and passes stdout/stderr through', async () => {
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: 'nginx: configuration file /tmp/nginx.conf test is successful\n',
    });

    const result = await validateConfig('server { listen 80; }');

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('nginx: configuration file /tmp/nginx.conf test is successful\n');
    expect(result.stdout).toBe('');
  });

  it('returns ok=false on non-zero exit and preserves the NGINX diagnostic in stderr', async () => {
    execaMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'nginx: [emerg] unexpected "}" in /tmp/zoomies-validate-X/site.conf:7\n',
    });

    const result = await validateConfig('server { listen 80; } }');

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('[emerg] unexpected "}"');
  });
});

describe('validateConfig — temp dir cleanup', () => {
  it('removes the temp dir after a successful validation', async () => {
    let capturedDir: string | null = null;
    execaMock.mockImplementationOnce((_binary: string, argv: readonly string[]) => {
      const wrapperPath = argv[2] ?? '';
      capturedDir = wrapperPath.replace(/\/nginx\.conf$/, '');
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    });

    await validateConfig('server { listen 80; }');

    expect(capturedDir).not.toBeNull();
    expect(existsSync(capturedDir as unknown as string)).toBe(false);
  });

  it('removes the temp dir even when validation reports failure', async () => {
    let capturedDir: string | null = null;
    execaMock.mockImplementationOnce((_binary: string, argv: readonly string[]) => {
      const wrapperPath = argv[2] ?? '';
      capturedDir = wrapperPath.replace(/\/nginx\.conf$/, '');
      return Promise.resolve({
        exitCode: 1,
        stdout: '',
        stderr: 'nginx: [emerg] something is wrong\n',
      });
    });

    const result = await validateConfig('definitely not valid nginx');

    expect(result.ok).toBe(false);
    expect(capturedDir).not.toBeNull();
    expect(existsSync(capturedDir as unknown as string)).toBe(false);
  });

  it('still returns a usable ValidationResult when temp-dir cleanup itself throws', async () => {
    // Force `rm` to blow up so we can prove the finally-block does not
    // swallow the successful validation result with a cleanup error.
    shouldRmFail.value = true;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: 'nginx: configuration file test is successful\n',
    });

    const result = await validateConfig('server { listen 80; }');

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('test is successful');

    // The validator should have emitted a warning rather than propagating
    // the rm failure up to the caller.
    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.flat().join(' ');
    expect(warned).toContain('zoomies');
  });
});

describe('validateConfig — binary resolution', () => {
  it('honors the ZOOMIES_NGINX_BIN env override', async () => {
    vi.stubEnv('ZOOMIES_NGINX_BIN', '/custom/path/nginx');

    await validateConfig('server { listen 80; }');

    const { binary } = lastExecaCall();
    expect(binary).toBe('/custom/path/nginx');
  });
});
