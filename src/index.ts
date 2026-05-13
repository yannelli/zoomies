import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dispatch } from './cli/dispatcher.js';
import { version } from './version.js';

/**
 * CLI entrypoint. Two fast paths bypass the dispatcher to preserve sync
 * behaviour required by the legacy test suite:
 *
 *   1. `--version` / `-v` prints the version line and returns 0 synchronously.
 *   2. No arguments at all prints the help banner and returns 0 synchronously.
 *
 * Every other argv shape is delegated to {@link dispatch}, which returns a
 * Promise<number>.
 */
export function main(argv: readonly string[]): number | Promise<number> {
  const [, , ...args] = argv;

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`zoomies ${version}\n`);
    return 0;
  }

  if (args.length === 0) {
    process.stdout.write(
      `zoomies ${version} — control plane for NGINX reverse proxy (pre-alpha)\n` +
        `Run \`zoomies --help\` for the command list, \`zoomies --version\` for the version.\n`,
    );
    return 0;
  }

  return dispatch(argv);
}

const entryArg = process.argv[1];
const entryUrl = entryArg ? pathToFileURL(resolve(entryArg)).href : undefined;
const isEntrypoint = entryUrl !== undefined && import.meta.url === entryUrl;
if (isEntrypoint) {
  const result = main(process.argv);
  if (typeof result === 'number') {
    process.exit(result);
  } else {
    void result.then((code) => {
      process.exit(code);
    });
  }
}
