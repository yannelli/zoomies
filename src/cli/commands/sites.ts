/**
 * `zoomies sites <subcommand>` — CRUD over sites.
 *
 * `list` renders a compact table; `get` dumps JSON; the mutating subcommands
 * print the new id or `ok` so scripts can chain (`zoomies sites create ... |
 * xargs zoomies sites get`).
 */

import { CliClientError, type CreateSiteInput, type UpdateSiteInput } from '../client.js';
import type { Command, CommandContext } from '../dispatcher.js';
import { FlagParseError, parseFlags } from './flags.js';

const VALID_TLS_MODES = ['off', 'acme', 'manual'] as const;
type TlsMode = (typeof VALID_TLS_MODES)[number];

export const SITES_USAGE = `Usage: zoomies sites <subcommand> [args]

Subcommands:
  list                                       Tabular listing of all sites
  get <id>                                   JSON dump of one site
  create --hostname <h> --upstream-id <id> --tls-mode <off|acme|manual>
                                             Create a new site
  update <id> [--hostname X] [--upstream-id X] [--tls-mode X]
                                             Patch an existing site
  delete <id> --yes                          Delete a site (--yes is required)
`;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function isTlsMode(value: string): value is TlsMode {
  return (VALID_TLS_MODES as readonly string[]).includes(value);
}

function printUsage(ctx: CommandContext): number {
  ctx.stdout.write(SITES_USAGE);
  return 0;
}

function writeUsageErr(ctx: CommandContext, msg: string): number {
  ctx.stderr.write(`zoomies sites: ${msg}\n`);
  ctx.stderr.write(SITES_USAGE);
  return 2;
}

function handleClientError(ctx: CommandContext, err: unknown): number {
  if (err instanceof CliClientError) {
    ctx.stderr.write(`zoomies sites: ${err.message} (${err.code})\n`);
    return 1;
  }
  const message = err instanceof Error ? err.message : String(err);
  ctx.stderr.write(`zoomies sites: ${message}\n`);
  return 1;
}

async function runList(ctx: CommandContext): Promise<number> {
  try {
    const sites = await ctx.client.sites.list();
    if (sites.length === 0) {
      ctx.stdout.write('(no sites)\n');
      return 0;
    }
    const header = ['id', 'hostname', 'upstream_id', 'tls_mode', 'created_at'];
    const rows = sites.map((s) => [
      shortId(s.id),
      s.hostname,
      shortId(s.upstreamId),
      s.tlsMode,
      s.createdAt,
    ]);
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
    );
    const fmt = (cols: readonly string[]): string =>
      cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
    ctx.stdout.write(fmt(header) + '\n');
    for (const row of rows) {
      ctx.stdout.write(fmt(row) + '\n');
    }
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runGet(args: readonly string[], ctx: CommandContext): Promise<number> {
  const [id] = args;
  if (id === undefined) {
    return writeUsageErr(ctx, 'get requires a site id');
  }
  try {
    const site = await ctx.client.sites.get(id);
    ctx.stdout.write(JSON.stringify(site, null, 2) + '\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runCreate(args: readonly string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      valueFlags: new Set(['hostname', 'upstream-id', 'tls-mode']),
    });
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }
  const hostname = parsed.flags['hostname'];
  const upstreamId = parsed.flags['upstream-id'];
  const tlsMode = parsed.flags['tls-mode'];
  if (hostname === undefined || upstreamId === undefined || tlsMode === undefined) {
    return writeUsageErr(ctx, 'create requires --hostname, --upstream-id, and --tls-mode');
  }
  if (!isTlsMode(tlsMode)) {
    return writeUsageErr(ctx, `--tls-mode must be one of ${VALID_TLS_MODES.join('|')}`);
  }
  const input: CreateSiteInput = {
    hostname,
    upstreamId,
    tlsMode,
  };
  try {
    const site = await ctx.client.sites.create(input);
    ctx.stdout.write(site.id + '\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runUpdate(args: readonly string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      valueFlags: new Set(['hostname', 'upstream-id', 'tls-mode']),
    });
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }
  const [id] = parsed.positional;
  if (id === undefined) {
    return writeUsageErr(ctx, 'update requires a site id');
  }
  const patch: UpdateSiteInput = {};
  if (parsed.flags['hostname'] !== undefined) {
    patch.hostname = parsed.flags['hostname'];
  }
  if (parsed.flags['upstream-id'] !== undefined) {
    patch.upstreamId = parsed.flags['upstream-id'];
  }
  if (parsed.flags['tls-mode'] !== undefined) {
    const tlsMode = parsed.flags['tls-mode'];
    if (!isTlsMode(tlsMode)) {
      return writeUsageErr(ctx, `--tls-mode must be one of ${VALID_TLS_MODES.join('|')}`);
    }
    patch.tlsMode = tlsMode;
  }
  try {
    await ctx.client.sites.update(id, patch);
    ctx.stdout.write('ok\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runDelete(args: readonly string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      valueFlags: new Set(),
      boolFlags: new Set(['yes']),
    });
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }
  const [id] = parsed.positional;
  if (id === undefined) {
    return writeUsageErr(ctx, 'delete requires a site id');
  }
  if (parsed.flags['yes'] !== 'true') {
    ctx.stderr.write(
      'zoomies sites: refusing to delete without --yes (this is a destructive op)\n',
    );
    return 2;
  }
  try {
    await ctx.client.sites.delete(id);
    ctx.stdout.write('ok\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

export const sitesCommand: Command = {
  name: 'sites',
  describe: 'List / create / update / delete sites',
  usage: SITES_USAGE,
  async run(args, ctx): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
      return printUsage(ctx);
    }
    const [sub, ...rest] = args;
    switch (sub) {
      case undefined:
        return printUsage(ctx);
      case 'list':
        return runList(ctx);
      case 'get':
        return runGet(rest, ctx);
      case 'create':
        return runCreate(rest, ctx);
      case 'update':
        return runUpdate(rest, ctx);
      case 'delete':
        return runDelete(rest, ctx);
      default:
        return writeUsageErr(ctx, `unknown subcommand '${sub}'`);
    }
  },
};
