import type { Cert } from '../domain/cert.js';
import type { Site } from '../domain/site.js';
import type { Upstream, UpstreamTarget } from '../domain/upstream.js';

/**
 * Pure NGINX config renderer for a single {@link Site}.
 *
 * Input: already-validated domain entities. Output: a deterministic, contiguous
 * string ending with a single trailing newline. The renderer performs **no**
 * I/O — no filesystem, no exec, no clocks. Two invocations with identical
 * inputs MUST produce byte-identical output (the test suite enforces this via
 * golden fixtures).
 *
 * NGINX validation (`nginx -t`) and reload orchestration live in later phases;
 * this module only generates the text.
 */

/**
 * NGINX `upstream` block identifiers must be valid identifiers — UUID hyphens
 * break that. We sanitize once and reuse for both the upstream block name and
 * the matching `proxy_pass` target inside the `server` block.
 */
function upstreamBlockName(site: Site): string {
  return `zoomies_${site.id.replace(/-/g, '_')}`;
}

function renderLoadBalancerDirective(upstream: Upstream): string {
  // Round-robin is the NGINX default — emitting it explicitly would be noise.
  if (upstream.loadBalancer === 'round_robin') return '';
  if (upstream.loadBalancer === 'least_conn') return '    least_conn;\n';
  return '    ip_hash;\n';
}

function renderTarget(target: UpstreamTarget): string {
  // Always emit `weight=` (even for weight=1) so snapshots stay stable when
  // the schema default eventually changes.
  return `    server ${target.host}:${target.port} weight=${target.weight};\n`;
}

function renderUpstreamBlock(site: Site, upstream: Upstream): string {
  const name = upstreamBlockName(site);
  const lbDirective = renderLoadBalancerDirective(upstream);
  const targetLines = upstream.targets.map(renderTarget).join('');

  return `upstream ${name} {\n${lbDirective}${targetLines}    keepalive 32;\n}\n`;
}

/**
 * The `location /` block is identical across HTTP and HTTPS server blocks —
 * extract it so both sides stay in sync.
 */
function renderProxyLocation(site: Site): string {
  const name = upstreamBlockName(site);
  return [
    '    location / {\n',
    '        proxy_http_version 1.1;\n',
    '        proxy_set_header Host $host;\n',
    '        proxy_set_header X-Real-IP $remote_addr;\n',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n',
    '        proxy_set_header X-Forwarded-Proto $scheme;\n',
    '        proxy_set_header Connection "";\n',
    `        proxy_pass http://${name};\n`,
    '    }\n',
  ].join('');
}

function renderHttpRedirectServer(site: Site): string {
  return [
    'server {\n',
    '    listen 80;\n',
    '    listen [::]:80;\n',
    `    server_name ${site.hostname};\n`,
    '\n',
    '    return 301 https://$host$request_uri;\n',
    '}\n',
  ].join('');
}

function renderHttpsServer(site: Site, cert: Cert): string {
  return [
    'server {\n',
    '    listen 443 ssl;\n',
    '    listen [::]:443 ssl;\n',
    `    server_name ${site.hostname};\n`,
    `    ssl_certificate ${cert.pemPath};\n`,
    `    ssl_certificate_key ${cert.keyPath};\n`,
    '\n',
    renderProxyLocation(site),
    '}\n',
  ].join('');
}

function renderHttpServerOff(site: Site): string {
  return [
    'server {\n',
    '    listen 80;\n',
    '    listen [::]:80;\n',
    `    server_name ${site.hostname};\n`,
    '\n',
    renderProxyLocation(site),
    '}\n',
  ].join('');
}

function renderHttpServerAcmePending(site: Site): string {
  return [
    'server {\n',
    '    listen 80;\n',
    '    listen [::]:80;\n',
    `    server_name ${site.hostname};\n`,
    '\n',
    '    # acme: awaiting issuance\n',
    '    location /.well-known/acme-challenge/ {\n',
    '        root /var/lib/zoomies/acme;\n',
    '    }\n',
    '\n',
    renderProxyLocation(site),
    '}\n',
  ].join('');
}

function renderHttpServerManualNoCert(site: Site): string {
  return [
    'server {\n',
    '    listen 80;\n',
    '    listen [::]:80;\n',
    `    server_name ${site.hostname};\n`,
    '\n',
    '    # tls=manual: cert missing, refusing to render https block\n',
    '\n',
    renderProxyLocation(site),
    '}\n',
  ].join('');
}

function renderServerBlocks(site: Site, cert: Cert | null): string {
  if (site.tlsMode === 'off') {
    return renderHttpServerOff(site);
  }

  if (site.tlsMode === 'acme') {
    if (cert === null) {
      return renderHttpServerAcmePending(site);
    }
    return `${renderHttpRedirectServer(site)}\n${renderHttpsServer(site, cert)}`;
  }

  // tlsMode === 'manual'
  if (cert === null) {
    return renderHttpServerManualNoCert(site);
  }
  return `${renderHttpRedirectServer(site)}\n${renderHttpsServer(site, cert)}`;
}

export function renderSite(site: Site, upstream: Upstream, cert: Cert | null): string {
  const header = `# managed-by zoomies — site:${site.id}  upstream:${upstream.id}\n`;
  const upstreamBlock = renderUpstreamBlock(site, upstream);
  const serverBlocks = renderServerBlocks(site, cert);

  return `${header}${upstreamBlock}\n${serverBlocks}`;
}
