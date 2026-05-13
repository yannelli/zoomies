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

const isEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  process.exit(main(process.argv));
}
