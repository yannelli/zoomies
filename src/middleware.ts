import { NextResponse, type NextRequest } from 'next/server';

/**
 * Stamp every `/api/*` response with `Cache-Control: no-store` so that
 * intermediate proxies (CDNs, an ops-side NGINX, browsers) treat the
 * response as non-storable. Mutation-relevant data, auth flows, and
 * health checks must remain fresh.
 *
 * Route handlers that legitimately want caching (a future static
 * metadata endpoint, say) can override this by setting their own
 * `Cache-Control` header on the response.
 */
export function middleware(_request: NextRequest): NextResponse {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
