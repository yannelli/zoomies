import { getRepositories } from '@/server/api/db-context';
import { mapErrorToResponse } from '@/server/api/error-mapping';
import { listCerts } from '@/server/api/handlers/certs';
import { requireToken } from '@/server/auth/require-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/certs — list every cert row.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    requireToken(request.headers);
    const { certs } = getRepositories();
    const result = listCerts({ certRepo: certs });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
