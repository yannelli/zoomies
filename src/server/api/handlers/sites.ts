/**
 * Framework-agnostic CRUD operations for {@link Site} aggregates.
 *
 * These handlers are pure functions over a {@link SiteRepository}. They:
 *   - parse raw input with Zod at the boundary,
 *   - delegate persistence to the repository,
 *   - promote repository-level absence (`findById === null`,
 *     `delete === false`) into {@link NotFoundError},
 *   - and otherwise let domain errors (`NotFoundError`, `ConflictError`,
 *     `ZodError`) bubble verbatim so the Route Handler can hand them to
 *     {@link mapErrorToResponse} unchanged.
 *
 * No NGINX reload, no filesystem writes, no logging. Reload triggering is
 * deferred until Phase 7 wires the UI to these endpoints — that's when we
 * actually have a consumer that benefits from a downstream `applyDesiredState`.
 */

import type { z } from 'zod';

import { NotFoundError } from '../../domain/errors.js';
import { SiteSchema, type Site } from '../../domain/site.js';
import type { SiteRepository } from '../../repositories/site-repository.js';

export interface SiteHandlerDeps {
  siteRepo: SiteRepository;
}

export const CreateSiteInputSchema = SiteSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateSiteInputSchema = CreateSiteInputSchema.partial();

export type CreateSiteInput = z.infer<typeof CreateSiteInputSchema>;
export type UpdateSiteInput = z.infer<typeof UpdateSiteInputSchema>;

export function listSites(deps: SiteHandlerDeps): Site[] {
  return deps.siteRepo.list();
}

export function getSite(id: string, deps: SiteHandlerDeps): Site {
  const site = deps.siteRepo.findById(id);
  if (site === null) {
    throw new NotFoundError('site not found');
  }
  return site;
}

/**
 * Validate `rawInput` against {@link CreateSiteInputSchema} and persist it.
 *
 * `.parse` (not `.safeParse`) — the resulting `ZodError` is caught by the
 * Route Handler's top-level `try/catch` and translated by
 * `mapErrorToResponse` into a 400 with structured details.
 */
export function createSite(rawInput: unknown, deps: SiteHandlerDeps): Site {
  const input = CreateSiteInputSchema.parse(rawInput);
  return deps.siteRepo.create(input);
}

/**
 * Strip keys whose values are `undefined` from a Zod-parsed patch.
 *
 * Under `exactOptionalPropertyTypes: true` (CLI tsconfig), `Partial<T>`
 * means "key may be absent" — never "present-with-undefined". Zod's
 * `.partial()` infers `field?: T | undefined`, which is a different (looser)
 * type. The repo's `update(id, patch)` takes the strict shape, so we drop
 * any explicitly-undefined entries here and re-narrow the return type to
 * the repo-friendly partial.
 */
type StrictPartial<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

function stripUndefined<T extends Record<string, unknown>>(input: T): StrictPartial<T> {
  const out: StrictPartial<T> = {};
  for (const key of Object.keys(input) as Array<keyof T>) {
    const value = input[key];
    if (value !== undefined) {
      out[key] = value as Exclude<T[typeof key], undefined>;
    }
  }
  return out;
}

/**
 * Partially update an existing site.
 *
 * Mirrors the repository semantics: an empty patch is accepted, leaves all
 * fields untouched, and still bumps `updatedAt`. A non-existent id surfaces
 * as {@link NotFoundError} from the repository.
 */
export function updateSite(id: string, rawInput: unknown, deps: SiteHandlerDeps): Site {
  const patch = UpdateSiteInputSchema.parse(rawInput);
  return deps.siteRepo.update(id, stripUndefined(patch));
}

/**
 * Delete a site. The repository returns `false` for a no-op delete; we
 * promote that to {@link NotFoundError} at the API boundary so callers can
 * distinguish a successful 204 from a missing record.
 */
export function deleteSite(id: string, deps: SiteHandlerDeps): void {
  const deleted = deps.siteRepo.delete(id);
  if (!deleted) {
    throw new NotFoundError('site not found');
  }
}
