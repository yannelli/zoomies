/**
 * Translates errors thrown inside the control-plane domain layer (and Zod
 * validation failures at the request boundary) into HTTP-shaped responses.
 *
 * Handlers should call this from a single top-level `try { ... } catch` and
 * pass the caught value through verbatim. The mapping never re-throws and
 * never leaks unanticipated error messages — those collapse to a generic
 * `internal` response with the original logged to stderr for operators.
 */

import { ZodError } from 'zod';

import { UnauthorizedError } from '../auth/require-token.js';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../domain/errors.js';

export interface ApiErrorResponse {
  status: number;
  body: { error: string; code: string; details?: unknown };
}

/**
 * Build a 500 response without echoing the inbound error's message. The
 * original is logged so operators can diagnose, but we treat unanticipated
 * messages as potentially sensitive (they may include file paths, SQL
 * snippets, or other internals).
 */
function internalServerError(err: unknown): ApiErrorResponse {
  console.error('zoomies: unhandled error in api handler:', err);
  return {
    status: 500,
    body: { error: 'internal server error', code: 'internal' },
  };
}

export function mapErrorToResponse(err: unknown): ApiErrorResponse {
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: err.message, code: 'not_found' } };
  }

  if (err instanceof ConflictError) {
    return { status: 409, body: { error: err.message, code: 'conflict' } };
  }

  if (err instanceof ValidationError) {
    return { status: 400, body: { error: err.message, code: 'validation' } };
  }

  if (err instanceof UnauthorizedError) {
    return { status: 401, body: { error: err.message, code: 'unauthorized' } };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'invalid request body',
        code: 'validation',
        details: err.flatten(),
      },
    };
  }

  // Any other `DomainError` subclass we add later still gets its declared
  // `code` surfaced, but at a 500 since we don't know its semantics here.
  if (err instanceof DomainError) {
    return { status: 500, body: { error: err.message, code: err.code } };
  }

  return internalServerError(err);
}
