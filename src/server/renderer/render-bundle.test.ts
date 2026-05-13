import { describe, expect, it } from 'vitest';

import type { Cert } from '../domain/cert.js';
import { NotFoundError } from '../domain/errors.js';
import type { Site } from '../domain/site.js';
import type { Upstream } from '../domain/upstream.js';
import { renderBundle } from './render-bundle.js';
import { renderSite } from './render-site.js';

const ANY_TS = '2026-05-13T12:00:00.000Z';

function makeSite(
  id: string,
  hostname: string,
  upstreamId: string,
  tlsMode: Site['tlsMode'] = 'off',
): Site {
  return {
    id,
    hostname,
    upstreamId,
    tlsMode,
    createdAt: ANY_TS,
    updatedAt: ANY_TS,
  };
}

function makeUpstream(id: string, name: string): Upstream {
  return {
    id,
    name,
    targets: [{ host: '10.0.0.1', port: 8080, weight: 1 }],
    loadBalancer: 'round_robin',
    createdAt: ANY_TS,
    updatedAt: ANY_TS,
  };
}

function makeCert(id: string, domain: string): Cert {
  return {
    id,
    domain,
    provider: 'acme',
    pemPath: `/var/lib/zoomies/certs/${domain}.pem`,
    keyPath: `/var/lib/zoomies/certs/${domain}.key`,
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('renderBundle', () => {
  it('renders one config per site keyed by site.id, joining upstreams by id and certs by hostname', () => {
    const upstreamA = makeUpstream('22222222-2222-4222-8222-222222222222', 'pool-a');
    const upstreamB = makeUpstream('44444444-4444-4444-8444-444444444444', 'pool-b');
    const siteA = makeSite(
      '11111111-1111-4111-8111-111111111111',
      'a.example.com',
      upstreamA.id,
      'acme',
    );
    const siteB = makeSite(
      '33333333-3333-4333-8333-333333333333',
      'b.example.com',
      upstreamB.id,
      'off',
    );
    const certA = makeCert('99999999-9999-4999-8999-999999999999', 'a.example.com');

    const result = renderBundle([siteA, siteB], [upstreamA, upstreamB], [certA]);

    expect(result.size).toBe(2);
    // Each rendered entry must match what renderSite would produce in isolation
    // (the bundle is just a join, not a renderer of its own).
    expect(result.get(siteA.id)).toBe(renderSite(siteA, upstreamA, certA));
    expect(result.get(siteB.id)).toBe(renderSite(siteB, upstreamB, null));
  });

  it('throws NotFoundError when a site points at a missing upstream', () => {
    const site = makeSite(
      '11111111-1111-4111-8111-111111111111',
      'orphan.example.com',
      '22222222-2222-4222-8222-222222222222',
    );

    expect(() => renderBundle([site], [], [])).toThrow(NotFoundError);
  });

  it('returns an empty Map when given no sites', () => {
    const result = renderBundle([], [], []);
    expect(result.size).toBe(0);
  });

  it('silently ignores certs whose domain matches no site (stale cert rows are tolerated)', () => {
    const upstream = makeUpstream('22222222-2222-4222-8222-222222222222', 'pool');
    const site = makeSite(
      '11111111-1111-4111-8111-111111111111',
      'kept.example.com',
      upstream.id,
      'off',
    );
    const staleCert = makeCert('99999999-9999-4999-8999-999999999999', 'gone.example.com');

    const result = renderBundle([site], [upstream], [staleCert]);

    expect(result.size).toBe(1);
    // The site renders as if the cert did not exist — tlsMode is 'off' so
    // no TLS server block, and the stale cert must not leak into the output.
    expect(result.get(site.id)).toBe(renderSite(site, upstream, null));
    expect(result.get(site.id)).not.toContain('ssl_certificate');
  });
});
