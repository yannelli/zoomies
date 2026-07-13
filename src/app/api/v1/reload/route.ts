import { getRepositories } from '@/server/api/db-context';
import { mapErrorToResponse } from '@/server/api/error-mapping';
import { applyReload } from '@/server/api/handlers/reload';
import { requireToken } from '@/server/auth/require-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/reload — render the current desired state and reload NGINX.
 *
 * Success → 200 with `{ ok: true, step: 'success' }`.
 * Missing env config → 500 with `{ ok: false, step: 'config', code: 'config_missing', ... }`.
 * Apply failure (validate/write/reload/probe) → 502 with the ApplyResult body.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireToken(request.headers);
    const { sites, upstreams, certs } = getRepositories();
    const result = await applyReload({
      siteRepo: sites,
      upstreamRepo: upstreams,
      certRepo: certs,
      sitesDir: process.env.ZOOMIES_NGINX_SITES_DIR ?? undefined,
      healthCheckUrl: process.env.ZOOMIES_HEALTH_CHECK_URL ?? undefined,
    });

    if (result.ok) {
      return Response.json(result, { status: 200 });
    }
    if (result.step === 'config') {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result, { status: 502 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
