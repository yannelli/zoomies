import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CliClient } from '../client.js';
import type { CommandContext } from '../dispatcher.js';
import { upstreamsCommand } from './upstreams.js';

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

function fakeClient(upstreams: Partial<CliClient['upstreams']> = {}): CliClient {
  return {
    sites: {
      list: vi.fn(),
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
      ...upstreams,
    },
    certs: { issueForSite: vi.fn(), list: vi.fn() },
    reload: { apply: vi.fn() },
    status: { health: vi.fn() },
  };
}

function makeCtx(client: CliClient): {
  ctx: CommandContext;
  out: string[];
  err: string[];
} {
  const out = captureStream();
  const err = captureStream();
  return {
    ctx: {
      mode: 'local',
      httpUrl: 'http://localhost:3000',
      stdout: out.stream,
      stderr: err.stream,
      client,
    },
    out: out.chunks,
    err: err.chunks,
  };
}

describe('upstreams command', () => {
  it('list formats a table', async () => {
    const client = fakeClient({
      list: vi.fn().mockResolvedValue([
        {
          id: '01234567-aaaa-bbbb-cccc-deadbeef0001',
          name: 'web-pool',
          targets: [{ host: '10.0.0.1', port: 8080, weight: 1 }],
          loadBalancer: 'round_robin',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    });
    const { ctx, out } = makeCtx(client);
    const code = await upstreamsCommand.run(['list'], ctx);
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toContain('web-pool');
    expect(text).toContain('round_robin');
    expect(text).toContain('01234567');
  });

  it('create parses multiple --target host:port:weight flags', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'new-upstream-id',
      name: 'pool',
      targets: [
        { host: '10.0.0.1', port: 8080, weight: 1 },
        { host: '10.0.0.2', port: 8081, weight: 5 },
      ],
      loadBalancer: 'round_robin',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const client = fakeClient({ create });
    const { ctx, out } = makeCtx(client);
    const code = await upstreamsCommand.run(
      [
        'create',
        '--name',
        'pool',
        '--load-balancer',
        'round_robin',
        '--target',
        '10.0.0.1:8080:1',
        '--target',
        '10.0.0.2:8081:5',
      ],
      ctx,
    );
    expect(code).toBe(0);
    expect(create).toHaveBeenCalledWith({
      name: 'pool',
      loadBalancer: 'round_robin',
      targets: [
        { host: '10.0.0.1', port: 8080, weight: 1 },
        { host: '10.0.0.2', port: 8081, weight: 5 },
      ],
    });
    expect(out.join('')).toContain('new-upstream-id');
  });
});
