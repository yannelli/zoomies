import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { version } from './version.js';

export function main(argv: readonly string[]): number {
  const [, , ...args] = argv;

  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`zoomies ${version}\n`);
    return 0;
  }

  process.stdout.write(
    `zoomies ${version} — control plane for NGINX reverse proxy (pre-alpha)\n` +
      `Run \`zoomies --version\` to print the version.\n`,
  );
  return 0;
}

const entryArg = process.argv[1];
const entryUrl = entryArg ? pathToFileURL(resolve(entryArg)).href : undefined;
const isEntrypoint = entryUrl !== undefined && import.meta.url === entryUrl;
if (isEntrypoint) {
  process.exit(main(process.argv));
}
