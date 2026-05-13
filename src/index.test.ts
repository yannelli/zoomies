import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './index.js';
import { version } from './version.js';

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints version with --version and returns 0', () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const code = main(['node', 'zoomies', '--version']);

    expect(code).toBe(0);
    expect(writes.join('')).toContain(version);
  });

  it('prints a help banner by default', () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const code = main(['node', 'zoomies']);

    expect(code).toBe(0);
    expect(writes.join('')).toMatch(/control plane/i);
  });
});
