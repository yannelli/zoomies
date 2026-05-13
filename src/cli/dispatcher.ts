/**
 * Hand-rolled CLI argv parser and dispatcher.
 *
 * Phase 0 was explicit about not adding deps for things the standard
 * library can do; this dispatcher is intentionally minimal:
 *   - parse top-level flags up to the first non-flag positional,
 *   - resolve a `Command` record by name,
 *   - build a `CommandContext` (no DB, no client) and hand the remaining
 *     argv to `command.run(args, ctx)`.
 *
 * `--version` / `-v` and `--help` / `-h` are zero-side-effect: they never
 * open the DB or construct a client. The CLI client factory is only invoked
 * when a real command runs, and is overridable via {@link dispatchWithClient}
 * for tests.
 */

import { version } from '../version.js';
import { createHttpClient, createLocalClient, type CliClient } from './client.js';
import { certsCommand } from './commands/certs.js';
import { reloadCommand } from './commands/reload.js';
import { sitesCommand } from './commands/sites.js';
import { statusCommand } from './commands/status.js';
import { upstreamsCommand } from './commands/upstreams.js';

export interface CommandContext {
  mode: 'local' | 'http';
  httpUrl: string;
  httpToken?: string | undefined;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  client: CliClient;
}

export interface Command {
  name: string;
  describe: string;
  usage: string;
  run(args: readonly string[], ctx: CommandContext): Promise<number>;
}

/**
 * Factory wrapping `createLocalClient` / `createHttpClient`. Tests pass a
 * substitute via {@link dispatchWithClient} so they can inject a fake client
 * without monkey-patching module-scope code.
 */
export interface ClientFactory {
  (mode: 'local' | 'http', httpUrl: string, httpToken: string | undefined): CliClient;
}

const COMMANDS: readonly Command[] = [
  statusCommand,
  sitesCommand,
  upstreamsCommand,
  certsCommand,
  reloadCommand,
];

const DEFAULT_API_URL = 'http://localhost:3000';

interface ParsedTopLevel {
  showVersion: boolean;
  showHelp: boolean;
  modeOverride: 'local' | null;
  httpUrl: string;
  httpToken: string | undefined;
  /** Remaining argv (first element is the command name, if any). */
  rest: string[];
}

/**
 * Walk argv consuming top-level flags until we hit the first non-flag
 * positional. That positional and everything after it are the command's
 * own argv — we hand them off unparsed.
 *
 * Mid-stream `--help` / `--version` still trigger the global behaviour
 * (i.e. `zoomies sites --help` falls through to the sites command's help;
 * `zoomies --help sites` shows global help). The split is on position:
 * once we see a non-flag, we stop parsing top-level flags.
 */
function parseTopLevel(args: readonly string[]): ParsedTopLevel {
  let showVersion = false;
  let showHelp = false;
  let modeOverride: 'local' | null = null;
  let httpUrl = process.env.ZOOMIES_API_URL ?? DEFAULT_API_URL;
  let httpToken = process.env.ZOOMIES_API_TOKEN;
  const rest: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      i += 1;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      showVersion = true;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
      i += 1;
      continue;
    }
    if (arg === '--local') {
      modeOverride = 'local';
      i += 1;
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      httpUrl = arg.slice('--api-url='.length);
      i += 1;
      continue;
    }
    if (arg === '--api-url') {
      const next = args[i + 1];
      if (next === undefined) {
        throw new Error('--api-url requires a value');
      }
      httpUrl = next;
      i += 2;
      continue;
    }
    if (arg.startsWith('--token=')) {
      httpToken = arg.slice('--token='.length);
      i += 1;
      continue;
    }
    if (arg === '--token') {
      const next = args[i + 1];
      if (next === undefined) {
        throw new Error('--token requires a value');
      }
      httpToken = next;
      i += 2;
      continue;
    }
    // First non-flag positional → command name. Everything from here on
    // (including subsequent flags) belongs to the command.
    rest.push(...args.slice(i));
    break;
  }

  return { showVersion, showHelp, modeOverride, httpUrl, httpToken, rest };
}

function writeVersion(stdout: NodeJS.WritableStream): number {
  stdout.write(`zoomies ${version}\n`);
  return 0;
}

function writeHelp(stdout: NodeJS.WritableStream): number {
  const banner =
    `zoomies ${version} — control plane for NGINX reverse proxy (pre-alpha)\n` +
    `\n` +
    `Usage: zoomies [global flags] <command> [args]\n` +
    `\n` +
    `Commands:\n`;
  const longestName = COMMANDS.reduce((m, c) => Math.max(m, c.name.length), 0);
  const commandLines = COMMANDS.map((c) => `  ${c.name.padEnd(longestName)}  ${c.describe}`).join(
    '\n',
  );
  const flagsBlock =
    `\n\n` +
    `Global flags:\n` +
    `  --local            Run against the local SQLite DB instead of the HTTP API\n` +
    `  --api-url <url>    HTTP API base URL (env: ZOOMIES_API_URL, default ${DEFAULT_API_URL})\n` +
    `  --token <token>    Bearer token for the HTTP API (env: ZOOMIES_API_TOKEN)\n` +
    `  --version, -v      Print version and exit\n` +
    `  --help, -h         Show this help\n` +
    `\n` +
    `Run \`zoomies <command> --help\` for command-specific usage.\n`;
  stdout.write(banner + commandLines + flagsBlock);
  return 0;
}

/**
 * Dispatch with an injected client factory. Tests use this to substitute
 * a fake client and verify dispatcher behaviour without touching the DB.
 */
export async function dispatchWithClient(
  argv: readonly string[],
  factory: ClientFactory,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
): Promise<number> {
  // argv shape: ['node', 'zoomies', ...]. Skip the first two entries.
  const args = argv.slice(2);

  let parsed: ParsedTopLevel;
  try {
    parsed = parseTopLevel(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`zoomies: ${message}\n`);
    return 2;
  }

  if (parsed.showVersion) {
    return writeVersion(stdout);
  }

  if (parsed.rest.length === 0) {
    // No command. `--help` is implied — render the banner.
    return writeHelp(stdout);
  }

  const [commandName, ...commandArgs] = parsed.rest;
  if (commandName === undefined) {
    return writeHelp(stdout);
  }

  if (parsed.showHelp && parsed.rest.length === 0) {
    return writeHelp(stdout);
  }

  const command = COMMANDS.find((c) => c.name === commandName);
  if (command === undefined) {
    stderr.write(
      `zoomies: unknown command '${commandName}'. Run \`zoomies --help\` for the command list.\n`,
    );
    return 2;
  }

  // Pass `--help` / `-h` through to the command itself so per-command
  // help is single-sourced in each command module.
  if (parsed.showHelp && !commandArgs.includes('--help') && !commandArgs.includes('-h')) {
    commandArgs.push('--help');
  }

  const mode: 'local' | 'http' = parsed.modeOverride ?? 'http';
  const client = factory(mode, parsed.httpUrl, parsed.httpToken);

  const ctx: CommandContext = {
    mode,
    httpUrl: parsed.httpUrl,
    httpToken: parsed.httpToken,
    stdout,
    stderr,
    client,
  };

  try {
    return await command.run(commandArgs, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`zoomies: ${message}\n`);
    return 1;
  }
}

const defaultFactory: ClientFactory = (mode, httpUrl, httpToken) =>
  mode === 'local' ? createLocalClient() : createHttpClient(httpUrl, httpToken);

export async function dispatch(argv: readonly string[]): Promise<number> {
  return dispatchWithClient(argv, defaultFactory);
}
