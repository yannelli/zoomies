/**
 * `zoomies certs <subcommand>` — issue / list cert rows.
 *
 * `issue` blocks until the ACME order completes (10–60 s in production
 * against Let's Encrypt). The HTTP API does not yet expose a list-certs
 * endpoint, so `list` is local-only for now.
 */

import { CliClientError } from '../client.js';
import type { Command, CommandContext } from '../dispatcher.js';
import { FlagParseError, parseFlags } from './flags.js';

export const CERTS_USAGE = `Usage: zoomies certs <subcommand> [args]

Subcommands:
  issue --site-id <id>   Issue (or re-issue) a Let's Encrypt cert for a site.
                         Blocks until the ACME order completes (10-60 seconds
                         against the production Let's Encrypt API).
                         Local mode requires ZOOMIES_ACME_EMAIL to be set.
  list                   Tabular listing of all certs (local mode only).
`;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function printUsage(ctx: CommandContext): number {
  ctx.stdout.write(CERTS_USAGE);
  return 0;
}

function writeUsageErr(ctx: CommandContext, msg: string): number {
  ctx.stderr.write(`zoomies certs: ${msg}\n`);
  ctx.stderr.write(CERTS_USAGE);
  return 2;
}

function handleClientError(ctx: CommandContext, err: unknown): number {
  if (err instanceof CliClientError) {
    ctx.stderr.write(`zoomies certs: ${err.message} (${err.code})\n`);
    return 1;
  }
  const message = err instanceof Error ? err.message : String(err);
  ctx.stderr.write(`zoomies certs: ${message}\n`);
  return 1;
}

async function runIssue(args: readonly string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(args, { valueFlags: new Set(['site-id']) });
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }
  const siteId = parsed.flags['site-id'];
  if (siteId === undefined) {
    return writeUsageErr(ctx, 'issue requires --site-id <id>');
  }
  try {
    const cert = await ctx.client.certs.issueForSite(siteId);
    ctx.stdout.write(JSON.stringify(cert, null, 2) + '\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runList(ctx: CommandContext): Promise<number> {
  if (ctx.mode === 'http') {
    ctx.stderr.write(
      'zoomies certs: listing certs over HTTP is not yet supported; rerun with --local\n',
    );
    return 2;
  }
  try {
    const certs = await ctx.client.certs.list();
    if (certs.length === 0) {
      ctx.stdout.write('(no certs)\n');
      return 0;
    }
    const header = ['id', 'domain', 'provider', 'not_after'];
    const rows = certs.map((c) => [shortId(c.id), c.domain, c.provider, c.notAfter]);
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

export const certsCommand: Command = {
  name: 'certs',
  describe: 'Issue / list ACME certificates',
  usage: CERTS_USAGE,
  async run(args, ctx): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
      return printUsage(ctx);
    }
    const [sub, ...rest] = args;
    switch (sub) {
      case undefined:
        return printUsage(ctx);
      case 'issue':
        return runIssue(rest, ctx);
      case 'list':
        return runList(ctx);
      default:
        return writeUsageErr(ctx, `unknown subcommand '${sub}'`);
    }
  },
};
