/**
 * `zoomies status` — print version + connectivity info.
 *
 * In `--local` mode this is a SELECT 1 against the SQLite control-plane DB:
 * we have no Next.js server to ping. In HTTP mode it hits `/api/healthz`.
 */

import { version } from '../../version.js';
import type { Command } from '../dispatcher.js';

export const STATUS_USAGE = `Usage: zoomies status

Print version and a quick health summary.

  --local mode: opens the SQLite DB and runs SELECT 1.
  HTTP mode:    GETs /api/healthz against --api-url.
`;

export const statusCommand: Command = {
  name: 'status',
  describe: 'Print version + control-plane connectivity',
  usage: STATUS_USAGE,
  async run(args, ctx): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
      ctx.stdout.write(STATUS_USAGE);
      return 0;
    }

    const result = await ctx.client.status.health();
    const lines: string[] = [
      `version: ${version}`,
      `mode:    ${ctx.mode}`,
      `ok:      ${result.ok ? 'yes' : 'no'}`,
    ];
    if (ctx.mode === 'http') {
      lines.push(`url:     ${ctx.httpUrl}`);
      lines.push(`status:  ${result.status ?? 'n/a'}`);
    }
    if (result.body !== undefined) {
      lines.push(`body:    ${JSON.stringify(result.body)}`);
    }
    ctx.stdout.write(lines.join('\n') + '\n');
    return result.ok ? 0 : 1;
  },
};
