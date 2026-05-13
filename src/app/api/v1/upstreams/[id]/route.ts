import { getRepositories } from '@/server/api/db-context';
import { mapErrorToResponse } from '@/server/api/error-mapping';
import { deleteUpstream, getUpstream, updateUpstream } from '@/server/api/handlers/upstreams';
import { requireToken } from '@/server/auth/require-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Next.js 15 dynamic-segment params are a Promise — must be awaited.
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    requireToken(request.headers);
    const { id } = await ctx.params;
    const { upstreams } = getRepositories();
    const result = getUpstream(id, { upstreamRepo: upstreams });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}

export async function PATCH(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    requireToken(request.headers);
    const { id } = await ctx.params;
    const { upstreams } = getRepositories();
    const input = (await request.json()) as unknown;
    const result = updateUpstream(id, input, { upstreamRepo: upstreams });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}

export async function DELETE(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    requireToken(request.headers);
    const { id } = await ctx.params;
    const { upstreams } = getRepositories();
    deleteUpstream(id, { upstreamRepo: upstreams });
    return new Response(null, { status: 204 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
