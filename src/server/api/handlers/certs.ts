/**
 * Framework-agnostic cert listing.
 *
 * Mirrors the site/upstream list handlers: pure function over a
 * {@link CertRepository}, no I/O beyond the repo, domain errors bubble
 * unchanged to {@link mapErrorToResponse}.
 */

import type { Cert } from '../../domain/cert.js';
import type { CertRepository } from '../../repositories/cert-repository.js';

export interface CertHandlerDeps {
  certRepo: CertRepository;
}

export function listCerts(deps: CertHandlerDeps): Cert[] {
  return deps.certRepo.list();
}
