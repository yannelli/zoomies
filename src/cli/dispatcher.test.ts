import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CliClient } from './client.js';
import { dispatch, dispatchWithClient, type ClientFactory } from './dispatcher.js';
import { version } from '../version.js';

function captureStream(): { stream: NodeJS.WritableStream; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      cb();
    },
  });
  return { stream, chunks };
}

function fakeClient(): CliClient {
  return {
    sites: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    upstreams: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    certs: {
      issueForSite: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
    reload: {
      apply: vi.fn().mockResolvedValue({ ok: true, step: 'success' }),
    },
    status: {
      health: vi.fn().mockResolvedValue({ ok: true, status: 200, body: { status: 'ok' } }),
    },
  };
}

describe('dispatch', () => {
  it('--version writes the version line and returns 0', async () => {
    const { stream, chunks } = captureStream();
    const errCapture = captureStream();
    const code = await dispatchWithClient(
      ['node', 'zoomies', '--version'],
      () => fakeClient(),
      stream,
      errCapture.stream,
    );
    expect(code).toBe(0);
    expect(chunks.join('')).toContain(version);
  });

  it('no command prints the help banner and returns 0', async () => {
    const { stream, chunks } = captureStream();
    const errCapture = captureStream();
    const code = await dispatchWithClient(
      ['node', 'zoomies'],
      () => fakeClient(),
      stream,
      errCapture.stream,
    );
    expect(code).toBe(0);
    const out = chunks.join('');
    expect(out).toMatch(/control plane/i);
    expect(out).toContain('Commands:');
    expect(out).toContain('Global flags:');
  });

  it('unknown command writes a usage hint to stderr and returns 2', async () => {
    const out = captureStream();
    const err = captureStream();
    const code = await dispatchWithClient(
      ['node', 'zoomies', 'unknown-cmd'],
      () => fakeClient(),
      out.stream,
      err.stream,
    );
    expect(code).toBe(2);
    expect(err.chunks.join('')).toMatch(/unknown command/i);
  });

  it('sites list dispatches into the sites command', async () => {
    const out = captureStream();
    const err = captureStream();
    const client = fakeClient();
    const code = await dispatchWithClient(
      ['node', 'zoomies', 'sites', 'list'],
      () => client,
      out.stream,
      err.stream,
    );
    expect(code).toBe(0);
    expect(client.sites.list).toHaveBeenCalledOnce();
  });

  it('--local forces local client mode', async () => {
    const out = captureStream();
    const err = captureStream();
    const factory = vi.fn<ClientFactory>(() => fakeClient());
    await dispatchWithClient(
      ['node', 'zoomies', '--local', 'sites', 'list'],
      factory,
      out.stream,
      err.stream,
    );
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0]?.[0]).toBe('local');
  });

  it('absent --local defaults to http client mode', async () => {
    const out = captureStream();
    const err = captureStream();
    const factory = vi.fn<ClientFactory>(() => fakeClient());
    await dispatchWithClient(['node', 'zoomies', 'sites', 'list'], factory, out.stream, err.stream);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0]?.[0]).toBe('http');
  });

  it('dispatch() (default factory) handles --version without constructing a client', async () => {
    // This is the public API tip — make sure it returns the right code.
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const code = await dispatch(['node', 'zoomies', '--version']);

    expect(code).toBe(0);
    expect(writes.join('')).toContain(version);
    vi.restoreAllMocks();
  });
});
