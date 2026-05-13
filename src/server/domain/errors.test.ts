import { describe, expect, it } from 'vitest';

import { ConflictError, DomainError, NotFoundError, ValidationError } from './errors.js';

describe('domain errors', () => {
  describe('NotFoundError', () => {
    it('is an instance of DomainError and Error', () => {
      const err = new NotFoundError('site not found');

      expect(err).toBeInstanceOf(NotFoundError);
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toBeInstanceOf(Error);
    });

    it('exposes the expected `code` discriminator', () => {
      const err = new NotFoundError('site not found');

      expect(err.code).toBe('not_found');
    });

    it('sets `name` to the subclass name', () => {
      const err = new NotFoundError('site not found');

      expect(err.name).toBe('NotFoundError');
    });

    it('round-trips message and cause', () => {
      const cause = new Error('underlying');
      const err = new NotFoundError('site not found', { cause });

      expect(err.message).toBe('site not found');
      expect(err.cause).toBe(cause);
    });

    it('omits cause when not provided', () => {
      const err = new NotFoundError('site not found');

      expect(err.cause).toBeUndefined();
    });
  });

  describe('ConflictError', () => {
    it('is an instance of DomainError and Error', () => {
      const err = new ConflictError('hostname already used');

      expect(err).toBeInstanceOf(ConflictError);
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toBeInstanceOf(Error);
    });

    it('exposes the expected `code` discriminator', () => {
      const err = new ConflictError('hostname already used');

      expect(err.code).toBe('conflict');
    });

    it('sets `name` to the subclass name', () => {
      const err = new ConflictError('hostname already used');

      expect(err.name).toBe('ConflictError');
    });

    it('round-trips message and cause', () => {
      const cause = new Error('db unique violation');
      const err = new ConflictError('hostname already used', { cause });

      expect(err.message).toBe('hostname already used');
      expect(err.cause).toBe(cause);
    });
  });

  describe('ValidationError', () => {
    it('is an instance of DomainError and Error', () => {
      const err = new ValidationError('invalid hostname');

      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toBeInstanceOf(Error);
    });

    it('exposes the expected `code` discriminator', () => {
      const err = new ValidationError('invalid hostname');

      expect(err.code).toBe('validation');
    });

    it('sets `name` to the subclass name', () => {
      const err = new ValidationError('invalid hostname');

      expect(err.name).toBe('ValidationError');
    });

    it('round-trips message and cause', () => {
      const cause = { issues: [] };
      const err = new ValidationError('invalid hostname', { cause });

      expect(err.message).toBe('invalid hostname');
      expect(err.cause).toBe(cause);
    });
  });
});
