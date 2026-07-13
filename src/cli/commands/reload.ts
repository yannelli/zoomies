/**
 * `zoomies reload` — render the current bundle and trigger an NGINX reload.
 *
 * Works in both local mode (in-process apply) and HTTP mode (POST
 * /api/v1/reload against the running control plane).
 */

import type { Command } from '../dispatcher.js';

export const RELOAD_USAGE = `Usage: zoomies reload

Render the current desired state and reload NGINX.

Local mode and the HTTP control plane both require:
  ZOOMIES_NGINX_SITES_DIR   Directory Zoomies owns under /etc/nginx
  ZOOMIES_HEALTH_CHECK_URL  Post-reload smoke-test URL

HTTP mode POSTs /api/v1/reload on the control plane (which reads those
env vars from the server process).
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
