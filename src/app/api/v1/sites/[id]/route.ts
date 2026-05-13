import { getRepositories } from '@/server/api/db-context';
import { mapErrorToResponse } from '@/server/api/error-mapping';
import { deleteSite, getSite, updateSite } from '@/server/api/handlers/sites';
import { requireToken } from '@/server/auth/require-token';

export const runtime = 'nodejs';

// Next.js 15 dynamic-segment params are a Promise — must be awaited.
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    requireToken(request.headers);
    const { id } = await ctx.params;
    const { sites } = getRepositories();
    const result = getSite(id, { siteRepo: sites });
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
    const { sites } = getRepositories();
    const input = (await request.json()) as unknown;
    const result = updateSite(id, input, { siteRepo: sites });
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
    const { sites } = getRepositories();
    deleteSite(id, { siteRepo: sites });
    return new Response(null, { status: 204 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
