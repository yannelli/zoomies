import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CliClient } from '../client.js';
import type { CommandContext } from '../dispatcher.js';
import { reloadCommand } from './reload.js';

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

function fakeClient(reload: Partial<CliClient['reload']> = {}): CliClient {
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
    reload: { apply: vi.fn(), ...reload },
    status: { health: vi.fn() },
  };
}

describe('reload command', () => {
  it('happy path prints "ok" and returns 0', async () => {
    const apply = vi.fn().mockResolvedValue({ ok: true, step: 'success' });
    const client = fakeClient({ apply });
    const out = captureStream();
    const err = captureStream();
    const ctx: CommandContext = {
      mode: 'local',
      httpUrl: 'http://localhost:3000',
      stdout: out.stream,
      stderr: err.stream,
      client,
    };
    const code = await reloadCommand.run([], ctx);
    expect(code).toBe(0);
    const text = out.chunks.join('');
    expect(text).toMatch(/^ok/);
    expect(text).toContain('step=success');
  });
});
