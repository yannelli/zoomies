/**
 * First-run demo bootstrap.
 *
 * When the worker boots with `ZOOMIES_DEMO_UPSTREAM` set, this seeds (at
 * most once) a single Site + Upstream + Cert row pointing the configured
 * hostname at the given upstream URL over HTTPS, using a self-signed
 * snakeoil cert. The intent is purely zero-config: `docker compose up`
 * yields a working HTTPS reverse proxy with no UI interaction.
 *
 * The bootstrap is idempotent at every step:
 *   - If a site for the demo hostname already exists, the function
 *     returns early without touching anything.
 *   - If the snakeoil cert files are absent, they are generated; if they
 *     are present, generation is skipped.
 *   - The rendered site file is always (re)written via the standard
 *     `applyDesiredState` reload path so an externally-cleared sites
 *     directory rebuilds correctly.
 *
 * No I/O happens outside the explicit branches below. The function never
 * throws on operational failures the caller can't act on — it logs and
 * returns a structured result so the worker can decide whether to keep
 * running.
 */

import { execFile } from 'node:child_process';
import { access, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { CertRepository } from '../repositories/cert-repository.js';
import { SiteRepository } from '../repositories/site-repository.js';
import { UpstreamRepository } from '../repositories/upstream-repository.js';
import { renderBundle } from '../renderer/render-bundle.js';
import { applyDesiredState } from '../reload/reload.js';
import type { Database } from 'better-sqlite3';

const execFileP = promisify(execFile);

export interface DemoBootstrapConfig {
  /** Hostname the demo site responds on. Defaults to `localhost`. */
  hostname: string;
  /** Full `http(s)://host:port` of the backend the demo site proxies. */
  upstream: string;
  /** Filesystem path where the snakeoil PEM lives / will be written. */
  certPemPath: string;
  /** Filesystem path where the snakeoil private key lives / will be written. */
  certKeyPath: string;
  /** Directory zoomies owns under nginx (rendered `<site>.conf` files). */
  sitesDir: string;
  /** Health-check URL `applyDesiredState` probes after reload. */
  healthCheckUrl: string;
}

export interface DemoBootstrapDeps {
  db: Database;
  /**
   * Materialise the snakeoil cert if it's not already on disk. Default
   * implementation shells out to `openssl req` (no shell string — argv
   * array). Tests pass a stub.
   */
  ensureSnakeoilCert?: (pemPath: string, keyPath: string, hostname: string) => Promise<void>;
}

export interface DemoBootstrapResult {
  status: 'created' | 'already-present' | 'disabled' | 'skipped-invalid-config';
  message?: string;
}

/**
 * Read the env-driven config or `null` when the demo flow is opted out.
 *
 * `ZOOMIES_DEMO_UPSTREAM` is the master switch: unsetting it (or setting
 * it to the empty string) disables the bootstrap entirely. All other
 * fields have sensible defaults so the typical operator only sets the
 * upstream URL.
 */
export function readDemoConfigFromEnv(): DemoBootstrapConfig | null {
  const upstream = process.env.ZOOMIES_DEMO_UPSTREAM;
  if (upstream === undefined || upstream === '') {
    return null;
  }

  const hostname = process.env.ZOOMIES_DEMO_HOSTNAME ?? 'localhost';
  const certPemPath =
    process.env.ZOOMIES_DEFAULT_CERT_PEM ?? '/var/lib/zoomies/certs/_default/fullchain.pem';
  const certKeyPath =
    process.env.ZOOMIES_DEFAULT_CERT_KEY ?? '/var/lib/zoomies/certs/_default/privkey.pem';
  const sitesDir = process.env.ZOOMIES_NGINX_SITES_DIR ?? '/etc/zoomies/nginx/sites';
  const healthCheckUrl = process.env.ZOOMIES_HEALTH_CHECK_URL ?? 'http://nginx/api/healthz';

  return { hostname, upstream, certPemPath, certKeyPath, sitesDir, healthCheckUrl };
}

/**
 * Parse `http(s)://host[:port]` into the {host, port} pair Zoomies needs
 * for an `UpstreamTarget`. We only accept http/https because the renderer
 * only emits `proxy_pass http://...` blocks today.
 *
 * Returns null on any parse failure or unsupported scheme so the caller
 * can surface a specific reason rather than throwing through.
 */
export function parseUpstreamUrl(raw: string): { host: string; port: number } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.hostname === '') {
    return null;
  }

  const port =
    url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number.parseInt(url.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return { host: url.hostname, port };
}

/**
 * Generate a self-signed cert at the given paths using openssl. Idempotent
 * — returns immediately if both files already exist. Called by the
 * bootstrap when the entrypoint script in the NGINX container has not
 * yet written its own snakeoil (e.g. the worker came up first, or a
 * fresh volume is being initialised).
 *
 * Lifetime: 825 days, matching the browser-accepted maximum so the cert
 * behaves the same as a real one for tooling that consumes notAfter.
 */
async function defaultEnsureSnakeoilCert(
  pemPath: string,
  keyPath: string,
  hostname: string,
): Promise<void> {
  if ((await fileExists(pemPath)) && (await fileExists(keyPath))) {
    return;
  }

  await mkdir(dirname(pemPath), { recursive: true });
  await mkdir(dirname(keyPath), { recursive: true });

  await execFileP('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyPath,
    '-out',
    pemPath,
    '-days',
    '825',
    '-subj',
    `/CN=${hostname}`,
    '-addext',
    `subjectAltName=DNS:${hostname},DNS:*.${hostname},IP:127.0.0.1,IP:::1`,
  ]);

  await chmod(keyPath, 0o600);
  await chmod(pemPath, 0o644);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the demo bootstrap. Safe to call on every worker startup — the
 * inner checks make this idempotent.
 *
 * Returns a `DemoBootstrapResult` describing whether anything changed.
 * The worker logs the result but does not gate its renewal loop on it:
 * a failed demo bootstrap should not stop the real workload.
 */
export async function ensureDemoSite(deps: DemoBootstrapDeps): Promise<DemoBootstrapResult> {
  const config = readDemoConfigFromEnv();
  if (config === null) {
    return { status: 'disabled' };
  }

  const target = parseUpstreamUrl(config.upstream);
  if (target === null) {
    return {
      status: 'skipped-invalid-config',
      message: `ZOOMIES_DEMO_UPSTREAM is not a valid http(s) URL: ${config.upstream}`,
    };
  }

  const sites = new SiteRepository(deps.db);
  const upstreams = new UpstreamRepository(deps.db);
  const certs = new CertRepository(deps.db);

  if (sites.findByHostname(config.hostname) !== null) {
    return { status: 'already-present' };
  }

  const ensureCert = deps.ensureSnakeoilCert ?? defaultEnsureSnakeoilCert;
  await ensureCert(config.certPemPath, config.certKeyPath, config.hostname);

  // Cert row mirrors the on-disk cert. The CertSchema requires
  // notBefore < notAfter; we use a 825-day window to match the file's
  // openssl lifetime.
  const now = new Date();
  const notAfter = new Date(now.getTime() + 825 * 24 * 60 * 60 * 1000);

  let cert = certs.findByDomain(config.hostname);
  cert ??= certs.create({
    domain: config.hostname,
    provider: 'manual',
    pemPath: config.certPemPath,
    keyPath: config.certKeyPath,
    notBefore: now.toISOString(),
    notAfter: notAfter.toISOString(),
  });

  const upstream = upstreams.create({
    name: `demo-${config.hostname}`,
    targets: [{ host: target.host, port: target.port, weight: 1 }],
    loadBalancer: 'round_robin',
  });

  const site = sites.create({
    hostname: config.hostname,
    upstreamId: upstream.id,
    tlsMode: 'manual',
  });

  const rendered = renderBundle([site], [upstream], [cert]);
  const apply = await applyDesiredState(rendered, {
    sitesDir: config.sitesDir,
    healthCheckUrl: config.healthCheckUrl,
  });

  if (!apply.ok) {
    return {
      status: 'created',
      message: `seeded rows for ${config.hostname} but reload reported step=${apply.step}: ${apply.message ?? ''}`,
    };
  }

  return { status: 'created' };
}
