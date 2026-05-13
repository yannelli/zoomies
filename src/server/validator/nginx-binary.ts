/**
 * Resolves the NGINX binary path used by the validator.
 *
 * Reads `ZOOMIES_NGINX_BIN` on every call (no module-load caching) so tests
 * can flip the value via `vi.stubEnv` between cases. Falls back to the
 * conventional `/usr/sbin/nginx` install location.
 */
export function getNginxBinary(): string {
  return process.env.ZOOMIES_NGINX_BIN ?? '/usr/sbin/nginx';
}
