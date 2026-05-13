/**
 * `zoomies reload` — render the current bundle and trigger an NGINX reload.
 *
 * Local-only operation. The HTTP API does not yet expose a reload endpoint
 * (Phase 10 territory) — over HTTP this returns a structured "unsupported"
 * message and exits non-zero.
 */

import type { Command } from '../dispatcher.js';

export const RELOAD_USAGE = `Usage: zoomies reload

Render the current desired state and reload NGINX.

Local mode requires the following env vars to be set:
  ZOOMIES_NGINX_SITES_DIR   Directory Zoomies owns under /etc/nginx
  ZOOMIES_HEALTH_CHECK_URL  Post-reload smoke-test URL

HTTP mode is not yet supported and will exit non-zero with a hint.
`;

export const reloadCommand: Command = {
  name: 'reload',
  describe: 'Trigger an NGINX reload of the current desired state',
  usage: RELOAD_USAGE,
  async run(args, ctx): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
      ctx.stdout.write(RELOAD_USAGE);
      return 0;
    }
    const result = await ctx.client.reload.apply();
    const stream: NodeJS.WritableStream = result.ok ? ctx.stdout : ctx.stderr;
    const status = result.ok ? 'ok' : 'failed';
    const detail =
      result.message !== undefined && result.message !== '' ? `: ${result.message}` : '';
    stream.write(`${status} (step=${result.step})${detail}\n`);
    return result.ok ? 0 : 1;
  },
};
