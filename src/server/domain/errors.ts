/**
 * Domain error hierarchy for the Zoomies control plane.
 *
 * These errors model failure modes inside the pure domain layer:
 * a record is missing, a uniqueness/state constraint is violated, or
 * input could not be reconciled with a domain invariant. They carry a
 * stable `code` discriminator so transport layers (Route Handlers, CLI)
 * can map them to HTTP statuses / exit codes without `instanceof` chains.
 *
 * No I/O. No Zod. No entity coupling.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    // Ensure stack traces show the concrete subclass name, not "Error".
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'conflict';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'validation';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
