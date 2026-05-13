/**
 * `zoomies upstreams <subcommand>` — CRUD over upstreams.
 *
 * `create` collects targets via a repeated `--target host:port:weight` flag.
 * `update` accepts `--targets-json` so callers can replace the whole targets
 * list atomically — partial mutations of a single target row would race the
 * other targets in the same upstream and are out of scope.
 */

import type { CreateUpstreamInput, UpdateUpstreamInput } from '../client.js';
import { CliClientError } from '../client.js';
import type { Command, CommandContext } from '../dispatcher.js';
import type { UpstreamTarget } from '../../server/domain/upstream.js';
import { FlagParseError, parseFlags } from './flags.js';

const VALID_LOAD_BALANCERS = ['round_robin', 'least_conn', 'ip_hash'] as const;
type LoadBalancer = (typeof VALID_LOAD_BALANCERS)[number];

export const UPSTREAMS_USAGE = `Usage: zoomies upstreams <subcommand> [args]

Subcommands:
  list                                       Tabular listing of all upstreams
  get <id>                                   JSON dump of one upstream
  create --name <n> --load-balancer <round_robin|least_conn|ip_hash>
         --target host:port:weight ...       Create upstream (repeat --target)
  update <id> [--name X] [--load-balancer X] [--targets-json '<json>']
                                             Patch an existing upstream

The --target value is host:port:weight (e.g. 10.0.0.1:8080:1). Pass --target
multiple times to add multiple backends.

The --targets-json contract: a JSON array of objects
  [{"host":"10.0.0.1","port":8080,"weight":1}, ...]
Replaces the full targets list. Use only when scripting; --target on create
is friendlier for ad-hoc use.
`;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function isLoadBalancer(value: string): value is LoadBalancer {
  return (VALID_LOAD_BALANCERS as readonly string[]).includes(value);
}

function printUsage(ctx: CommandContext): number {
  ctx.stdout.write(UPSTREAMS_USAGE);
  return 0;
}

function writeUsageErr(ctx: CommandContext, msg: string): number {
  ctx.stderr.write(`zoomies upstreams: ${msg}\n`);
  ctx.stderr.write(UPSTREAMS_USAGE);
  return 2;
}

function handleClientError(ctx: CommandContext, err: unknown): number {
  if (err instanceof CliClientError) {
    ctx.stderr.write(`zoomies upstreams: ${err.message} (${err.code})\n`);
    return 1;
  }
  const message = err instanceof Error ? err.message : String(err);
  ctx.stderr.write(`zoomies upstreams: ${message}\n`);
  return 1;
}

/**
 * Parse a single `--target host:port:weight` value.
 *
 * Splits on `:` from the right so an IPv6 literal (e.g. `[::1]:8080:1`)
 * still parses cleanly: the last two segments are always port + weight,
 * and the remainder is host.
 */
export function parseTargetFlag(value: string): UpstreamTarget {
  const parts = value.split(':');
  if (parts.length < 3) {
    throw new FlagParseError(`--target must be host:port:weight (got '${value}')`);
  }
  const weightStr = parts[parts.length - 1]!;
  const portStr = parts[parts.length - 2]!;
  const host = parts.slice(0, -2).join(':');
  if (host === '') {
    throw new FlagParseError(`--target host is empty (got '${value}')`);
  }
  const port = Number.parseInt(portStr, 10);
  const weight = Number.parseInt(weightStr, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new FlagParseError(`--target port must be 1-65535 (got '${portStr}')`);
  }
  if (!Number.isFinite(weight) || weight < 1) {
    throw new FlagParseError(`--target weight must be >= 1 (got '${weightStr}')`);
  }
  return { host, port, weight };
}

async function runList(ctx: CommandContext): Promise<number> {
  try {
    const upstreams = await ctx.client.upstreams.list();
    if (upstreams.length === 0) {
      ctx.stdout.write('(no upstreams)\n');
      return 0;
    }
    const header = ['id', 'name', 'load_balancer', 'targets', 'created_at'];
    const rows = upstreams.map((u) => [
      shortId(u.id),
      u.name,
      u.loadBalancer,
      String(u.targets.length),
      u.createdAt,
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
    return writeUsageErr(ctx, 'get requires an upstream id');
  }
  try {
    const upstream = await ctx.client.upstreams.get(id);
    ctx.stdout.write(JSON.stringify(upstream, null, 2) + '\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runCreate(args: readonly string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      valueFlags: new Set(['name', 'load-balancer']),
      repeatedFlags: new Set(['target']),
    });
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }
  const name = parsed.flags['name'];
  const loadBalancer = parsed.flags['load-balancer'];
  if (name === undefined || loadBalancer === undefined) {
    return writeUsageErr(ctx, 'create requires --name and --load-balancer');
  }
  if (!isLoadBalancer(loadBalancer)) {
    return writeUsageErr(ctx, `--load-balancer must be one of ${VALID_LOAD_BALANCERS.join('|')}`);
  }
  const targetValues = parsed.repeated['target'] ?? [];
  if (targetValues.length === 0) {
    return writeUsageErr(ctx, 'create requires at least one --target host:port:weight');
  }
  let targets: UpstreamTarget[];
  try {
    targets = targetValues.map((v) => parseTargetFlag(v));
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }

  const input: CreateUpstreamInput = {
    name,
    loadBalancer,
    targets,
  };
  try {
    const upstream = await ctx.client.upstreams.create(input);
    ctx.stdout.write(upstream.id + '\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

async function runUpdate(args: readonly string[], ctx: CommandContext): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      valueFlags: new Set(['name', 'load-balancer', 'targets-json']),
    });
  } catch (err) {
    if (err instanceof FlagParseError) {
      return writeUsageErr(ctx, err.message);
    }
    throw err;
  }
  const [id] = parsed.positional;
  if (id === undefined) {
    return writeUsageErr(ctx, 'update requires an upstream id');
  }
  const patch: UpdateUpstreamInput = {};
  if (parsed.flags['name'] !== undefined) {
    patch.name = parsed.flags['name'];
  }
  if (parsed.flags['load-balancer'] !== undefined) {
    const lb = parsed.flags['load-balancer'];
    if (!isLoadBalancer(lb)) {
      return writeUsageErr(ctx, `--load-balancer must be one of ${VALID_LOAD_BALANCERS.join('|')}`);
    }
    patch.loadBalancer = lb;
  }
  if (parsed.flags['targets-json'] !== undefined) {
    try {
      const targets = JSON.parse(parsed.flags['targets-json']) as unknown;
      if (!Array.isArray(targets)) {
        return writeUsageErr(ctx, '--targets-json must be a JSON array');
      }
      patch.targets = targets as UpstreamTarget[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return writeUsageErr(ctx, `--targets-json: invalid JSON (${message})`);
    }
  }
  try {
    await ctx.client.upstreams.update(id, patch);
    ctx.stdout.write('ok\n');
    return 0;
  } catch (err) {
    return handleClientError(ctx, err);
  }
}

export const upstreamsCommand: Command = {
  name: 'upstreams',
  describe: 'List / create / update upstreams',
  usage: UPSTREAMS_USAGE,
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
      default:
        return writeUsageErr(ctx, `unknown subcommand '${sub}'`);
    }
  },
};
