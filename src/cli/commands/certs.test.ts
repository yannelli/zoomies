import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { CliClient } from '../client.js';
import type { CommandContext } from '../dispatcher.js';
import { certsCommand } from './certs.js';

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

function fakeClient(certs: Partial<CliClient['certs']> = {}): CliClient {
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
    certs: { issueForSite: vi.fn(), list: vi.fn(), ...certs },
    reload: { apply: vi.fn() },
    status: { health: vi.fn() },
  };
}

describe('certs command', () => {
  it('issue --site-id <id> calls client.certs.issueForSite with that id', async () => {
    const issueForSite = vi.fn().mockResolvedValue({
      id: 'cert-id',
      domain: 'example.com',
      provider: 'acme',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-04-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const client = fakeClient({ issueForSite });
    const out = captureStream();
    const err = captureStream();
    const ctx: CommandContext = {
      mode: 'local',
      httpUrl: 'http://localhost:3000',
      stdout: out.stream,
      stderr: err.stream,
      client,
    };
    const code = await certsCommand.run(['issue', '--site-id', 'site-123'], ctx);
    expect(code).toBe(0);
    expect(issueForSite).toHaveBeenCalledWith('site-123');
    expect(out.chunks.join('')).toContain('example.com');
  });
});
