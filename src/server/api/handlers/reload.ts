/**
 * Framework-agnostic reload operation.
 *
 * Renders the current desired state from the three repositories and hands
 * it to {@link applyDesiredState}. Config (sites dir + health URL) is
 * required at the call site — missing values return a structured
 * `{ ok: false, step: 'config' }` result rather than throwing, matching
 * the local CLI client's historical behaviour.
 */

import type { CertRepository } from '../../repositories/cert-repository.js';
import type { SiteRepository } from '../../repositories/site-repository.js';
import type { UpstreamRepository } from '../../repositories/upstream-repository.js';
import {
  applyDesiredState,
  type ApplyResult,
  type ApplyDesiredStateOptions,
} from '../../reload/reload.js';
import { renderBundle } from '../../renderer/render-bundle.js';

export interface ApplyReloadDeps {
  siteRepo: SiteRepository;
  upstreamRepo: UpstreamRepository;
  certRepo: CertRepository;
  sitesDir?: string | undefined;
  healthCheckUrl?: string | undefined;
  /**
   * Injectable apply closure. Production wires this to
   * {@link applyDesiredState}; tests substitute a fake.
   */
  apply?: (
    rendered: ReadonlyMap<string, string>,
    opts: ApplyDesiredStateOptions,
  ) => Promise<ApplyResult>;
}

export type ReloadHandlerResult =
  | ApplyResult
  | {
      ok: false;
      step: 'config';
      message: string;
      code: 'config_missing';
    };

/**
 * Render the current desired state and apply it to NGINX.
 *
 * Returns a structured result for every operational outcome (missing
 * config, validation failure, write/reload/probe failure, success). Does
 * not throw on those paths; domain errors from {@link renderBundle}
 * (e.g. site → missing upstream) still propagate.
 */
export async function applyReload(deps: ApplyReloadDeps): Promise<ReloadHandlerResult> {
  const sitesDir = deps.sitesDir;
  const healthCheckUrl = deps.healthCheckUrl;

  if (sitesDir === undefined || sitesDir === '') {
    return {
      ok: false,
      step: 'config',
      message: 'ZOOMIES_NGINX_SITES_DIR is not set',
      code: 'config_missing',
    };
  }
  if (healthCheckUrl === undefined || healthCheckUrl === '') {
    return {
      ok: false,
      step: 'config',
      message: 'ZOOMIES_HEALTH_CHECK_URL is not set',
      code: 'config_missing',
    };
  }

  const rendered = renderBundle(
    deps.siteRepo.list(),
    deps.upstreamRepo.list(),
    deps.certRepo.list(),
  );
  const apply = deps.apply ?? applyDesiredState;
  return apply(rendered, { sitesDir, healthCheckUrl });
}
