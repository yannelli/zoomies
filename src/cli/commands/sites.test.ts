import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CliClient } from '../client.js';
import type { CommandContext } from '../dispatcher.js';
import { sitesCommand } from './sites.js';

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

function fakeClient(sites: Partial<CliClient['sites']> = {}): CliClient {
  return {
    sites: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      ...sites,
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

describe('sites command', () => {
  it('list formats a table with header + rows', async () => {
    const client = fakeClient({
      list: vi.fn().mockResolvedValue([
        {
          id: '01234567-aaaa-bbbb-cccc-deadbeef0001',
          hostname: 'example.com',
          upstreamId: 'fedcba98-7654-3210-aaaa-deadbeef0002',
          tlsMode: 'acme',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    });
    const { ctx, out } = makeCtx(client);
    const code = await sitesCommand.run(['list'], ctx);
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toContain('id');
    expect(text).toContain('hostname');
    expect(text).toContain('01234567');
    expect(text).toContain('example.com');
    expect(text).toContain('acme');
    // Short upstream id is the first 8 chars.
    expect(text).toContain('fedcba98');
  });

  it('create --hostname X --upstream-id Y --tls-mode off happy path', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'new-site-id-here',
      hostname: 'foo.test',
      upstreamId: 'up-id-here',
      tlsMode: 'off',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const client = fakeClient({ create });
    const { ctx, out } = makeCtx(client);
    const code = await sitesCommand.run(
      ['create', '--hostname', 'foo.test', '--upstream-id', 'up-id-here', '--tls-mode', 'off'],
      ctx,
    );
    expect(code).toBe(0);
    expect(create).toHaveBeenCalledWith({
      hostname: 'foo.test',
      upstreamId: 'up-id-here',
      tlsMode: 'off',
    });
    expect(out.join('')).toContain('new-site-id-here');
  });

  it('delete without --yes exits 2 and never calls the client', async () => {
    const del = vi.fn();
    const client = fakeClient({ delete: del });
    const { ctx, err } = makeCtx(client);
    const code = await sitesCommand.run(['delete', 'some-id'], ctx);
    expect(code).toBe(2);
    expect(del).not.toHaveBeenCalled();
    expect(err.join('')).toMatch(/--yes/);
  });
});
