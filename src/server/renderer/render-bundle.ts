import type { Cert } from '../domain/cert.js';
import { NotFoundError } from '../domain/errors.js';
import type { Site } from '../domain/site.js';
import type { Upstream } from '../domain/upstream.js';
import { renderSite } from './render-site.js';

/**
 * Renders a complete bundle of sites into NGINX `server { ... }` snippets.
 *
 * Joins each {@link Site} to its referenced {@link Upstream} (by `upstreamId`)
 * and to its matching {@link Cert} (by `cert.domain === site.hostname`). A
 * missing upstream is a domain-invariant violation — every site must point
 * at an upstream that exists — so we throw {@link NotFoundError} rather than
 * silently degrading. A missing cert is fine; the renderer encodes "no cert
 * yet" semantics per `tlsMode`.
 *
 * Pure function. No I/O. Returns a `Map` keyed by `site.id` to preserve the
 * caller's iteration order and to make per-site lookups O(1) downstream.
 */
export function renderBundle(
  sites: Site[],
  upstreams: Upstream[],
  certs: Cert[],
): Map<string, string> {
  const upstreamsById = new Map<string, Upstream>(upstreams.map((u) => [u.id, u]));
  // Certs are indexed by `domain` because the join key from a Site is its
  // hostname, not a cert id. Stale cert rows (no matching site) are tolerated.
  const certsByDomain = new Map<string, Cert>(certs.map((c) => [c.domain, c]));

  const rendered = new Map<string, string>();

  for (const site of sites) {
    const upstream = upstreamsById.get(site.upstreamId);
    if (upstream === undefined) {
      throw new NotFoundError(
        `site ${site.id} references upstream ${site.upstreamId} which does not exist`,
      );
    }
    const cert = certsByDomain.get(site.hostname) ?? null;
    rendered.set(site.id, renderSite(site, upstream, cert));
  }

  return rendered;
}
