import { execa } from 'execa';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getNginxBinary } from './nginx-binary.js';

/**
 * Result of running `nginx -t` against a candidate config fragment.
 *
 * `ok` is the only field a caller usually needs — the others are kept so the
 * reload orchestrator (Phase 5) can surface the underlying NGINX message to
 * the operator on failure.
 */
export interface ValidationResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Minimal `http {}` wrapper that lets NGINX type-check a renderer fragment.
 *
 * The renderer emits the *contents* of an `http {}` block (an `upstream`
 * plus one or two `server` blocks). NGINX cannot validate that on its own —
 * it needs `events {}` and an enclosing `http {}` to even parse. We wrap
 * here rather than in the renderer so the renderer stays pure and we keep
 * the validator's wrapping policy in one place.
 */
function buildWrapper(siteConfPath: string): string {
  return `events {
    worker_connections 1024;
}

http {
    include ${siteConfPath};
}
`;
}

/**
 * Validates an NGINX config fragment with `nginx -t`.
 *
 * Strategy: write the fragment to a private temp dir, wrap it in a minimal
 * `events {} http {}` shell, then invoke the NGINX binary on the wrapper.
 * The wrapper uses an **absolute** include path — NGINX's `include`
 * resolves relative paths against its own config-prefix, which we don't
 * control.
 *
 * This function is side-effect-free from the caller's POV: it never mutates
 * application state, never reloads NGINX, and always cleans its temp dir
 * (cleanup errors are swallowed so they cannot mask the validation result).
 * Phase 5 owns deciding what to do with a failed result.
 */
export async function validateConfig(candidate: string): Promise<ValidationResult> {
  const dir = await mkdtemp(join(tmpdir(), 'zoomies-validate-'));
  try {
    const sitePath = join(dir, 'site.conf');
    const wrapperPath = join(dir, 'nginx.conf');

    await writeFile(sitePath, candidate, 'utf8');
    await writeFile(wrapperPath, buildWrapper(sitePath), 'utf8');

    // `reject: false` so a non-zero exit code returns a result rather than
    // throwing — failure is a normal, expected outcome of validation.
    // Argv array (never a shell string) per the project's no-shell rule.
    const result = await execa(getNginxBinary(), ['-t', '-c', wrapperPath], {
      reject: false,
    });

    return {
      ok: result.exitCode === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? null,
    };
  } finally {
    // Cleanup must never mask the validation outcome — log and move on.
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`zoomies: failed to remove validator temp dir ${dir}:`, err);
    }
  }
}
