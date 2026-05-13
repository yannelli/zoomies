import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CliClient } from '../client.js';
import type { CommandContext } from '../dispatcher.js';
import { statusCommand } from './status.js';

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

function fakeClient(overrides: Partial<CliClient['status']> = {}): CliClient {
  return {
    sites: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    upstreams: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    certs: { issueForSite: vi.fn(), list: vi.fn() },
    reload: { apply: vi.fn() },
    status: {
      health: vi.fn().mockResolvedValue({ ok: true, status: 200, body: { status: 'ok' } }),
      ...overrides,
    },
  };
}

function makeCtx(
  mode: 'local' | 'http',
  client: CliClient,
): {
  ctx: CommandContext;
  out: string[];
  err: string[];
} {
  const out = captureStream();
  const err = captureStream();
  return {
    ctx: {
      mode,
      httpUrl: 'http://localhost:3000',
      stdout: out.stream,
      stderr: err.stream,
      client,
    },
    out: out.chunks,
    err: err.chunks,
  };
}

describe('status command', () => {
  it('local mode healthy prints ok and returns 0', async () => {
    const client = fakeClient({
      health: vi
        .fn()
        .mockResolvedValue({ ok: true, status: null, body: { status: 'ok', db: 'reachable' } }),
    });
    const { ctx, out } = makeCtx('local', client);
    const code = await statusCommand.run([], ctx);
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toContain('mode:    local');
    expect(text).toContain('ok:      yes');
  });

  it('http mode failing prints status:no and returns 1', async () => {
    const client = fakeClient({
      health: vi.fn().mockResolvedValue({ ok: false, status: 503, body: { error: 'down' } }),
    });
    const { ctx, out } = makeCtx('http', client);
    const code = await statusCommand.run([], ctx);
    expect(code).toBe(1);
    const text = out.join('');
    expect(text).toContain('mode:    http');
    expect(text).toContain('ok:      no');
    expect(text).toContain('status:  503');
  });
});
