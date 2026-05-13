/**
 * POST /api/v1/sites/[id]/cert — issue (or re-issue) an ACME cert for a site.
 *
 * Synchronous-from-the-client's-perspective: this endpoint blocks until the
 * ACME order completes, which in real life takes 10-60 seconds. A future
 * non-blocking enqueue model is a possible improvement once we have a job
 * queue, but for now operators get a clean success-or-failure response.
 *
 * No NGINX reload is triggered here — the cert files land on disk during
 * issuance, and the next mutation-driven or scheduled reload picks them up.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { getRepositories } from '@/server/api/db-context';
import { mapErrorToResponse } from '@/server/api/error-mapping';
import { issueCertForSite } from '@/server/api/handlers/site-cert';
import { requireToken } from '@/server/auth/require-token';
import { loadOrCreateAccount } from '@/server/certs/acme-account';
import { createChallengeStore } from '@/server/certs/challenge-store';
import { issueCertificate } from '@/server/certs/issue';

export const runtime = 'nodejs';

interface RouteContext {
  // Next.js 15 dynamic-segment params are a Promise — must be awaited.
  params: Promise<{ id: string }>;
}

const DEFAULT_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory';

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    requireToken(request.headers);
    const { id } = await ctx.params;

    const contactEmail = process.env.ZOOMIES_ACME_EMAIL;
    if (contactEmail === undefined || contactEmail === '') {
      return Response.json(
        { error: 'ACME email not configured', code: 'config_missing' },
        { status: 500 },
      );
    }

    const directoryUrl = process.env.ZOOMIES_ACME_DIRECTORY_URL ?? DEFAULT_DIRECTORY_URL;
    const stateDir = process.env.ZOOMIES_STATE_DIR ?? join(process.cwd(), '.zoomies');
    const certDir = process.env.ZOOMIES_CERT_DIR ?? join(stateDir, 'certs');

    await mkdir(certDir, { recursive: true });
    const challengeStore = createChallengeStore({ stateDir });
    await mkdir(challengeStore.basePath, { recursive: true });

    const account = await loadOrCreateAccount({
      accountKeyPath: join(stateDir, 'acme-account.key'),
      contactEmail,
      directoryUrl,
    });

    const { sites, certs } = getRepositories();
    const result = await issueCertForSite(id, {
      siteRepo: sites,
      certRepo: certs,
      account,
      challengeStore,
      certDir,
      issue: issueCertificate,
    });

    return Response.json(result, { status: 201 });
  } catch (err) {
    const { status, body } = mapErrorToResponse(err);
    return Response.json(body, { status });
  }
}
