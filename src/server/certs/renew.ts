/**
 * Renew an existing `Cert` row by re-issuing for the same domain.
 *
 * The renew flow is a thin wrapper around {@link issueCertificate}:
 *
 *   1. Issue a new chain + key for `cert.domain`. The atomic writes in
 *      `issueCertificate` overwrite the existing PEM/key files in place,
 *      so the on-disk paths usually don't change.
 *   2. Persist the fresh validity window to the DB. The repository bumps
 *      `updatedAt` automatically.
 *
 * Failure modes:
 *   - If `issueCertificate` throws, the DB row is untouched (we update
 *     only on success). The atomic writes in `issueCertificate` roll back
 *     their own partial state.
 *   - If the DB update throws, the new files are already on disk — that's
 *     an acceptable inconsistency for now because the next renew attempt
 *     will overwrite them. A future enhancement can swap that out for a
 *     transactional pair.
 */

import type { Cert } from '../domain/cert.js';
import type { CertRepository } from '../repositories/cert-repository.js';
import { issueCertificate, type IssueOptions } from './issue.js';

export interface RenewOptions extends IssueOptions {
  /** The existing row whose validity window we're replacing. */
  cert: Cert;
  certRepo: CertRepository;
}

/**
 * Re-issue the certificate for `cert.domain` and persist the new validity
 * window onto the existing row. Returns the updated `Cert`.
 */
export async function renewCertificate(opts: RenewOptions): Promise<Cert> {
  const { cert, certRepo, ...issueOpts } = opts;

  const result = await issueCertificate(issueOpts);

  return certRepo.update(cert.id, {
    pemPath: result.pemPath,
    keyPath: result.keyPath,
    notBefore: result.notBefore,
    notAfter: result.notAfter,
  });
}
