import { mapErrorToResponse } from '@/server/api/error-mapping';
import { getRepositories } from '@/server/api/db-context';
import { createSite, listSites } from '@/server/api/handlers/sites';
import { requireToken } from '@/server/auth/require-token';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    requireToken(request.headers);
    const { sites } = getRepositories();
    const result = listSites({ siteRepo: sites });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireToken(request.headers);
    const { sites } = getRepositories();
    const input = (await request.json()) as unknown;
    const result = createSite(input, { siteRepo: sites });
    return Response.json(result, { status: 201 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
