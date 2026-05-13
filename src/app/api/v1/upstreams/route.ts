import { getRepositories } from '@/server/api/db-context';
import { mapErrorToResponse } from '@/server/api/error-mapping';
import { createUpstream, listUpstreams } from '@/server/api/handlers/upstreams';
import { requireToken } from '@/server/auth/require-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    requireToken(request.headers);
    const { upstreams } = getRepositories();
    const result = listUpstreams({ upstreamRepo: upstreams });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireToken(request.headers);
    const { upstreams } = getRepositories();
    const input = (await request.json()) as unknown;
    const result = createUpstream(input, { upstreamRepo: upstreams });
    return Response.json(result, { status: 201 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
