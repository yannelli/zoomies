/**
 * CLI client abstraction — single interface, two implementations.
 *
 * The CLI commands speak {@link CliClient}. `createLocalClient` wraps the
 * in-process repositories + framework-agnostic handlers; `createHttpClient`
 * hits the running Next.js HTTP API. Commands never branch on mode — the
 * dispatcher picks one client and hands it to every command.
 *
 * Failures bubble as plain `Error`s with a `code` discriminator where the
 * structured server response provided one, so command modules can pretty-
 * print without re-deriving HTTP details.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createSite,
  deleteSite,
  getSite,
  listSites,
  updateSite,
  type CreateSiteInput,
  type UpdateSiteInput,
} from '../server/api/handlers/sites.js';
import {
  createUpstream,
  deleteUpstream,
  getUpstream,
  listUpstreams,
  updateUpstream,
  type CreateUpstreamInput,
  type UpdateUpstreamInput,
} from '../server/api/handlers/upstreams.js';
import { issueCertForSite } from '../server/api/handlers/site-cert.js';
import { getDb, getRepositories } from '../server/api/db-context.js';
import { loadOrCreateAccount } from '../server/certs/acme-account.js';
import { createChallengeStore } from '../server/certs/challenge-store.js';
import { issueCertificate } from '../server/certs/issue.js';
import type { Cert } from '../server/domain/cert.js';
import type { Site } from '../server/domain/site.js';
import type { Upstream } from '../server/domain/upstream.js';
import { applyDesiredState, type ApplyStep } from '../server/reload/reload.js';
import { renderBundle } from '../server/renderer/render-bundle.js';

export type { CreateSiteInput, UpdateSiteInput, CreateUpstreamInput, UpdateUpstreamInput };

export interface SitesClient {
  list(): Promise<Site[]>;
  get(id: string): Promise<Site>;
  create(input: CreateSiteInput): Promise<Site>;
  update(id: string, patch: UpdateSiteInput): Promise<Site>;
  delete(id: string): Promise<void>;
}

export interface UpstreamsClient {
  list(): Promise<Upstream[]>;
  get(id: string): Promise<Upstream>;
  create(input: CreateUpstreamInput): Promise<Upstream>;
  update(id: string, patch: UpdateUpstreamInput): Promise<Upstream>;
  delete(id: string): Promise<void>;
}

export interface CertsClient {
  issueForSite(siteId: string): Promise<Cert>;
  list(): Promise<Cert[]>;
}

export interface ReloadResult {
  ok: boolean;
  step: ApplyStep | 'config' | 'unsupported';
  message?: string;
}

export interface ReloadClient {
  apply(): Promise<ReloadResult>;
}

export interface HealthResult {
  ok: boolean;
  status: number | null;
  body?: unknown;
}

export interface StatusClient {
  health(): Promise<HealthResult>;
}

export interface CliClient {
  sites: SitesClient;
  upstreams: UpstreamsClient;
  certs: CertsClient;
  reload: ReloadClient;
  status: StatusClient;
}

/**
 * Structured client error. Mirrors the shape of `mapErrorToResponse`'s
 * body so commands can pretty-print uniformly across local and http modes.
 */
export class CliClientError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    opts: { status?: number | null; code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'CliClientError';
    this.status = opts.status ?? null;
    this.code = opts.code ?? 'error';
    if (opts.details !== undefined) {
      this.details = opts.details;
    }
  }
}

/**
 * Wrap a synchronous handler call in `Promise.resolve` so the interface is
 * uniformly async. The handlers themselves are sync because `better-sqlite3`
 * is sync, but the HTTP client is necessarily async and we don't want the
 * command code branching on which one it has.
 */
async function syncAsync<T>(fn: () => T): Promise<T> {
  return Promise.resolve(fn());
}

export function createLocalClient(): CliClient {
  const repos = () => getRepositories();

  return {
    sites: {
      async list() {
        return syncAsync(() => listSites({ siteRepo: repos().sites }));
      },
      async get(id) {
        return syncAsync(() => getSite(id, { siteRepo: repos().sites }));
      },
      async create(input) {
        return syncAsync(() => createSite(input, { siteRepo: repos().sites }));
      },
      async update(id, patch) {
        return syncAsync(() => updateSite(id, patch, { siteRepo: repos().sites }));
      },
      async delete(id) {
        return syncAsync(() => {
          deleteSite(id, { siteRepo: repos().sites });
        });
      },
    },
    upstreams: {
      async list() {
        return syncAsync(() => listUpstreams({ upstreamRepo: repos().upstreams }));
      },
      async get(id) {
        return syncAsync(() => getUpstream(id, { upstreamRepo: repos().upstreams }));
      },
      async create(input) {
        return syncAsync(() => createUpstream(input, { upstreamRepo: repos().upstreams }));
      },
      async update(id, patch) {
        return syncAsync(() => updateUpstream(id, patch, { upstreamRepo: repos().upstreams }));
      },
      async delete(id) {
        return syncAsync(() => {
          deleteUpstream(id, { upstreamRepo: repos().upstreams });
        });
      },
    },
    certs: {
      async issueForSite(siteId) {
        const contactEmail = process.env.ZOOMIES_ACME_EMAIL;
        if (contactEmail === undefined || contactEmail === '') {
          throw new CliClientError('ACME email not configured: set ZOOMIES_ACME_EMAIL', {
            code: 'config_missing',
          });
        }
        const directoryUrl =
          process.env.ZOOMIES_ACME_DIRECTORY_URL ??
          'https://acme-v02.api.letsencrypt.org/directory';
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

        const { sites, certs } = repos();
        return issueCertForSite(siteId, {
          siteRepo: sites,
          certRepo: certs,
          account,
          challengeStore,
          certDir,
          issue: issueCertificate,
        });
      },
      async list() {
        return syncAsync(() => repos().certs.list());
      },
    },
    reload: {
      async apply(): Promise<ReloadResult> {
        const sitesDir = process.env.ZOOMIES_NGINX_SITES_DIR;
        const healthCheckUrl = process.env.ZOOMIES_HEALTH_CHECK_URL;
        if (sitesDir === undefined || sitesDir === '') {
          return {
            ok: false,
            step: 'config',
            message: 'ZOOMIES_NGINX_SITES_DIR is not set',
          };
        }
        if (healthCheckUrl === undefined || healthCheckUrl === '') {
          return {
            ok: false,
            step: 'config',
            message: 'ZOOMIES_HEALTH_CHECK_URL is not set',
          };
        }
        const { sites, upstreams, certs } = repos();
        const rendered = renderBundle(sites.list(), upstreams.list(), certs.list());
        const result = await applyDesiredState(rendered, { sitesDir, healthCheckUrl });
        return {
          ok: result.ok,
          step: result.step,
          ...(result.message !== undefined ? { message: result.message } : {}),
        };
      },
    },
    status: {
      async health(): Promise<HealthResult> {
        try {
          const db = getDb();
          const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
          if (row?.ok === 1) {
            return { ok: true, status: null, body: { status: 'ok', db: 'reachable' } };
          }
          return { ok: false, status: null, body: { status: 'degraded', db: 'no rows' } };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, status: null, body: { status: 'error', message } };
        }
      },
    },
  };
}

interface ApiErrorBody {
  error?: string;
  code?: string;
  details?: unknown;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null;
}

async function parseJsonOrNull(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Throw a {@link CliClientError} carrying the server-provided code + details
 * when the response is non-2xx; otherwise return the parsed JSON body.
 */
async function unwrapResponse<T>(response: Response): Promise<T> {
  const body = await parseJsonOrNull(response);
  if (response.ok) {
    return body as T;
  }
  const message =
    isErrorBody(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
  const code = isErrorBody(body) && typeof body.code === 'string' ? body.code : 'http_error';
  const details = isErrorBody(body) ? body.details : undefined;
  const opts: { status: number; code: string; details?: unknown } = {
    status: response.status,
    code,
  };
  if (details !== undefined) {
    opts.details = details;
  }
  throw new CliClientError(message, opts);
}

export function createHttpClient(baseUrl: string, token: string | undefined): CliClient {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined && token !== '') {
    headers.authorization = `Bearer ${token}`;
  }

  const url = (path: string): string => {
    const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${trimmed}${path}`;
  };

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url(path), {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    return unwrapResponse<T>(response);
  }

  return {
    sites: {
      list: () => request<Site[]>('/api/v1/sites'),
      get: (id) => request<Site>(`/api/v1/sites/${encodeURIComponent(id)}`),
      create: (input) =>
        request<Site>('/api/v1/sites', { method: 'POST', body: JSON.stringify(input) }),
      update: (id, patch) =>
        request<Site>(`/api/v1/sites/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      async delete(id) {
        const response = await fetch(url(`/api/v1/sites/${encodeURIComponent(id)}`), {
          method: 'DELETE',
          headers,
        });
        if (response.ok) {
          return;
        }
        await unwrapResponse(response);
      },
    },
    upstreams: {
      list: () => request<Upstream[]>('/api/v1/upstreams'),
      get: (id) => request<Upstream>(`/api/v1/upstreams/${encodeURIComponent(id)}`),
      create: (input) =>
        request<Upstream>('/api/v1/upstreams', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      update: (id, patch) =>
        request<Upstream>(`/api/v1/upstreams/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      async delete(id) {
        const response = await fetch(url(`/api/v1/upstreams/${encodeURIComponent(id)}`), {
          method: 'DELETE',
          headers,
        });
        if (response.ok) {
          return;
        }
        await unwrapResponse(response);
      },
    },
    certs: {
      issueForSite: (siteId) =>
        request<Cert>(`/api/v1/sites/${encodeURIComponent(siteId)}/cert`, {
          method: 'POST',
        }),
      list: () => {
        throw new CliClientError('listing certs over HTTP is not yet implemented; use --local', {
          code: 'unsupported',
        });
      },
    },
    reload: {
      async apply(): Promise<ReloadResult> {
        return {
          ok: false,
          step: 'unsupported',
          message: 'reload via HTTP not yet implemented; use --local',
        };
      },
    },
    status: {
      async health(): Promise<HealthResult> {
        try {
          const response = await fetch(url('/api/healthz'), { headers });
          const body = await parseJsonOrNull(response);
          return { ok: response.ok, status: response.status, body };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, status: null, body: { error: message } };
        }
      },
    },
  };
}
