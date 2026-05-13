import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Cert } from '../domain/cert.js';
import type { Site } from '../domain/site.js';
import type { Upstream } from '../domain/upstream.js';
import { renderSite } from './render-site.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

// All timestamps are fixed across fixtures so the inputs and golden outputs
// are reproducible. The renderer never emits timestamps, but Zod-typed
// entities require them for type-shape conformance.
const ANY_TS = '2026-05-13T12:00:00.000Z';

describe('renderSite (golden fixtures)', () => {
  it('renders an HTTP-only site (round-robin, single target)', () => {
    const site: Site = {
      id: '11111111-1111-4111-8111-111111111111',
      hostname: 'example.com',
      upstreamId: '22222222-2222-4222-8222-222222222222',
      tlsMode: 'off',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const upstream: Upstream = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'example-pool',
      targets: [{ host: '10.0.0.1', port: 8080, weight: 1 }],
      loadBalancer: 'round_robin',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };

    expect(renderSite(site, upstream, null)).toBe(readFixture('http-only.conf'));
  });

  it('renders an HTTP-only site with least_conn load balancing across three weighted targets', () => {
    const site: Site = {
      id: '33333333-3333-4333-8333-333333333333',
      hostname: 'lb.example.com',
      upstreamId: '44444444-4444-4444-8444-444444444444',
      tlsMode: 'off',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const upstream: Upstream = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'lb-pool',
      targets: [
        { host: '10.0.0.1', port: 8080, weight: 5 },
        { host: '10.0.0.2', port: 8080, weight: 3 },
        { host: '10.0.0.3', port: 8080, weight: 1 },
      ],
      loadBalancer: 'least_conn',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };

    expect(renderSite(site, upstream, null)).toBe(readFixture('lb-least-conn.conf'));
  });

  it('renders an ACME site awaiting issuance (no cert yet) with /.well-known passthrough', () => {
    const site: Site = {
      id: '55555555-5555-4555-8555-555555555555',
      hostname: 'acme.example.com',
      upstreamId: '66666666-6666-4666-8666-666666666666',
      tlsMode: 'acme',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const upstream: Upstream = {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'acme-pool',
      targets: [{ host: '10.0.1.1', port: 3000, weight: 1 }],
      loadBalancer: 'round_robin',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };

    expect(renderSite(site, upstream, null)).toBe(readFixture('acme-pending.conf'));
  });

  it('renders an ACME site with an issued cert (HTTP→HTTPS redirect + TLS server block)', () => {
    const site: Site = {
      id: '77777777-7777-4777-8777-777777777777',
      hostname: 'secure.example.com',
      upstreamId: '88888888-8888-4888-8888-888888888888',
      tlsMode: 'acme',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const upstream: Upstream = {
      id: '88888888-8888-4888-8888-888888888888',
      name: 'secure-pool',
      targets: [
        { host: '10.0.2.1', port: 8080, weight: 1 },
        { host: '10.0.2.2', port: 8080, weight: 1 },
      ],
      loadBalancer: 'ip_hash',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const cert: Cert = {
      id: '99999999-9999-4999-8999-999999999999',
      domain: 'secure.example.com',
      provider: 'acme',
      pemPath: '/var/lib/zoomies/certs/secure.example.com.pem',
      keyPath: '/var/lib/zoomies/certs/secure.example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(renderSite(site, upstream, cert)).toBe(readFixture('acme-issued.conf'));
  });

  it('renders a manual-TLS site with an operator-supplied cert', () => {
    const site: Site = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      hostname: 'manual.example.com',
      upstreamId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tlsMode: 'manual',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const upstream: Upstream = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'manual-pool',
      targets: [{ host: '10.0.3.1', port: 8080, weight: 1 }],
      loadBalancer: 'round_robin',
      createdAt: ANY_TS,
      updatedAt: ANY_TS,
    };
    const cert: Cert = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      domain: 'manual.example.com',
      provider: 'manual',
      pemPath: '/var/lib/zoomies/certs/manual.example.com.pem',
      keyPath: '/var/lib/zoomies/certs/manual.example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-07-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(renderSite(site, upstream, cert)).toBe(readFixture('manual-tls.conf'));
  });
});

describe('renderSite (invariants)', () => {
  const baseSite: Site = {
    id: '11111111-1111-4111-8111-111111111111',
    hostname: 'example.com',
    upstreamId: '22222222-2222-4222-8222-222222222222',
    tlsMode: 'off',
    createdAt: ANY_TS,
    updatedAt: ANY_TS,
  };
  const baseUpstream: Upstream = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'example-pool',
    targets: [{ host: '10.0.0.1', port: 8080, weight: 1 }],
    loadBalancer: 'round_robin',
    createdAt: ANY_TS,
    updatedAt: ANY_TS,
  };

  it('produces byte-identical output on repeated calls with identical inputs', () => {
    const a = renderSite(baseSite, baseUpstream, null);
    const b = renderSite(baseSite, baseUpstream, null);
    expect(a).toBe(b);
  });

  it('changes the rendered output when the load balancer changes (sanity check vs. self-comparison)', () => {
    const roundRobin = renderSite(baseSite, baseUpstream, null);
    const leastConn = renderSite(baseSite, { ...baseUpstream, loadBalancer: 'least_conn' }, null);
    expect(roundRobin).not.toBe(leastConn);
    expect(leastConn).toContain('least_conn;');
    expect(roundRobin).not.toContain('least_conn;');
  });
});
