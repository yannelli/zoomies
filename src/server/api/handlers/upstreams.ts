/**
 * Framework-agnostic CRUD operations for {@link Upstream} aggregates.
 *
 * Mirrors the site handlers in shape: Zod at the boundary, repository for
 * persistence, domain errors bubble unchanged to {@link mapErrorToResponse}.
 *
 * One asymmetry vs. sites: `deleteUpstream` may need to translate a raw
 * SQLite FOREIGN KEY error into a {@link ConflictError}. The migration
 * declares `sites.upstream_id REFERENCES upstreams(id) ON DELETE RESTRICT`,
 * so deleting an upstream that any site still references blows up with
 * `SQLITE_CONSTRAINT_FOREIGNKEY`. The repository does not currently catch
 * this — see the inline translation in {@link deleteUpstream}.
 */

import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../domain/errors.js';
import { UpstreamSchema, type Upstream } from '../../domain/upstream.js';
import type { UpstreamRepository } from '../../repositories/upstream-repository.js';

export interface UpstreamHandlerDeps {
  upstreamRepo: UpstreamRepository;
}

export const CreateUpstreamInputSchema = UpstreamSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateUpstreamInputSchema = CreateUpstreamInputSchema.partial();

export type CreateUpstreamInput = z.infer<typeof CreateUpstreamInputSchema>;
export type UpdateUpstreamInput = z.infer<typeof UpdateUpstreamInputSchema>;

interface SqliteLikeError {
  code?: unknown;
}

/**
 * SQLite signals a deferred FOREIGN KEY violation via its internal trigger
 * machinery, so `better-sqlite3` surfaces the constraint error with
 * `code: 'SQLITE_CONSTRAINT_TRIGGER'` (and message "FOREIGN KEY constraint
 * failed"). Direct-mode FK violations report `'SQLITE_CONSTRAINT_FOREIGNKEY'`.
 * Match both — and only those — and require the message to mention the
 * foreign key so we don't mis-classify unrelated trigger failures.
 */
function isForeignKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as SqliteLikeError).code;
  if (typeof code !== 'string') return false;
  if (code !== 'SQLITE_CONSTRAINT_FOREIGNKEY' && code !== 'SQLITE_CONSTRAINT_TRIGGER') {
    return false;
  }
  return /FOREIGN KEY constraint failed/i.test(err.message);
}

export function listUpstreams(deps: UpstreamHandlerDeps): Upstream[] {
  return deps.upstreamRepo.list();
}

export function getUpstream(id: string, deps: UpstreamHandlerDeps): Upstream {
  const upstream = deps.upstreamRepo.findById(id);
  if (upstream === null) {
    throw new NotFoundError('upstream not found');
  }
  return upstream;
}

export function createUpstream(rawInput: unknown, deps: UpstreamHandlerDeps): Upstream {
  const input = CreateUpstreamInputSchema.parse(rawInput);
  return deps.upstreamRepo.create(input);
}

/**
 * Strip keys whose values are `undefined` from a Zod-parsed patch.
 *
 * Under `exactOptionalPropertyTypes: true` (CLI tsconfig), `Partial<T>`
 * means "key may be absent" — never "present-with-undefined". Zod's
 * `.partial()` infers `field?: T | undefined`, a looser shape. The repo's
 * `update(id, patch)` takes the strict shape, so we drop explicitly-undefined
 * entries here and re-narrow the return type to the repo-friendly partial.
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

export function updateUpstream(id: string, rawInput: unknown, deps: UpstreamHandlerDeps): Upstream {
  const patch = UpdateUpstreamInputSchema.parse(rawInput);
  return deps.upstreamRepo.update(id, stripUndefined(patch));
}

/**
 * Delete an upstream.
 *
 * - Missing id → {@link NotFoundError} (the repo returns `false`; we
 *   promote it to 404 at the API boundary).
 * - Upstream still referenced by a site → {@link ConflictError}. The
 *   underlying SQLite FOREIGN KEY error is opaque to API consumers, so we
 *   translate it into a domain error here. (The site repository handles
 *   the inverse direction; the upstream repository was not updated for
 *   this case because it's a Phase 6 API-boundary concern.)
 */
export function deleteUpstream(id: string, deps: UpstreamHandlerDeps): void {
  let deleted: boolean;
  try {
    deleted = deps.upstreamRepo.delete(id);
  } catch (err) {
    if (isForeignKeyError(err)) {
      throw new ConflictError('upstream is still referenced by one or more sites', {
        cause: err,
      });
    }
    throw err;
  }
  if (!deleted) {
    throw new NotFoundError('upstream not found');
  }
}
