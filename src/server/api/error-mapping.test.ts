import { afterEach, describe, expect, it, vi } from 'vitest';
import { z, type ZodError } from 'zod';

import { UnauthorizedError } from '../auth/require-token.js';
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import { mapErrorToResponse } from './error-mapping.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapErrorToResponse — domain errors', () => {
  it('maps NotFoundError to 404 with code "not_found"', () => {
    const result = mapErrorToResponse(new NotFoundError('site not found'));

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'site not found', code: 'not_found' });
  });

  it('maps ConflictError to 409 with code "conflict"', () => {
    const result = mapErrorToResponse(new ConflictError('site name in use'));

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'site name in use', code: 'conflict' });
  });

  it('maps domain ValidationError to 400 with code "validation"', () => {
    const result = mapErrorToResponse(new ValidationError('hostname required'));

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'hostname required', code: 'validation' });
  });

  it('maps unrecognized DomainError subclasses to 500 with their declared code', () => {
    class TeapotError extends DomainError {
      readonly code = 'im_a_teapot';
    }
    const result = mapErrorToResponse(new TeapotError('teapot'));

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'teapot', code: 'im_a_teapot' });
  });
});

describe('mapErrorToResponse — UnauthorizedError', () => {
  it('maps UnauthorizedError to 401 with code "unauthorized"', () => {
    const result = mapErrorToResponse(new UnauthorizedError('invalid token'));

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'invalid token', code: 'unauthorized' });
  });

  it('preserves the UnauthorizedError default message', () => {
    const result = mapErrorToResponse(new UnauthorizedError());

    expect(result.status).toBe(401);
    expect(result.body.code).toBe('unauthorized');
    expect(result.body.error).toBe('unauthorized');
  });
});

describe('mapErrorToResponse — ZodError', () => {
  it('maps ZodError to 400 with code "validation" and a populated `details`', () => {
    const parsed = z.object({ a: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    // `safeParse` returns either `{ success: true, data }` or `{ success: false, error }`.
    const zodError = (parsed as { success: false; error: ZodError }).error;

    const result = mapErrorToResponse(zodError);

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('validation');
    expect(result.body.error).toBe('invalid request body');
    expect(result.body.details).toBeDefined();
    expect(result.body.details).toEqual(zodError.flatten());
  });
});

describe('mapErrorToResponse — unanticipated errors', () => {
  it('maps a plain Error to 500 internal without leaking its message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const original = new Error('db password is hunter2');
    const result = mapErrorToResponse(original);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'internal server error', code: 'internal' });
    // The original (sensitive) message must NOT appear in the response body.
    expect(result.body.error).not.toContain('hunter2');
    // The original error should be logged for operators to diagnose.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedArgs = consoleErrorSpy.mock.calls[0];
    expect(loggedArgs).toBeDefined();
    expect(loggedArgs).toContain(original);
  });

  it('maps null to 500 internal with the generic message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = mapErrorToResponse(null);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'internal server error', code: 'internal' });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('maps undefined to 500 internal with the generic message', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = mapErrorToResponse(undefined);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'internal server error', code: 'internal' });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('maps a string throw to 500 internal without echoing the string', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = mapErrorToResponse('something went wrong with secret xyz');

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'internal server error', code: 'internal' });
    expect(result.body.error).not.toContain('secret xyz');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
