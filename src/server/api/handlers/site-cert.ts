/**
 * Issue (or re-issue) a certificate for a single site, identified by id.
 *
 * The handler is framework-agnostic, mirroring {@link createSite} et al.:
 *   - Look up the site by id and surface a {@link NotFoundError} if absent.
 *   - Drive the ACME flow via the injected `issue` closure — the closure
 *     wraps {@link issueCertificate} in production and is mocked in tests.
 *   - Insert a new `certs` row on first issuance, or update the existing
 *     row when the hostname already has one (the cert table treats `domain`
 *     as the unique key).
 *
 * NGINX reload is intentionally NOT triggered here. The new cert files
 * land on disk during issuance; the next mutation-driven reload (when a
 * site is created/updated) or scheduled reload picks them up.
 *
 * TODO(phase-9): once the API → reload bridge lands, fire a reload here
 * after a successful issuance so the new cert takes effect immediately.
 */

import { NotFoundError } from '../../domain/errors.js';
import type { AcmeAccount } from '../../certs/acme-account.js';
import type { ChallengeStore } from '../../certs/challenge-store.js';
import type { IssueResult } from '../../certs/issue.js';
import type { Cert } from '../../domain/cert.js';
import type { CertRepository } from '../../repositories/cert-repository.js';
import type { SiteRepository } from '../../repositories/site-repository.js';

export interface IssueCertForSiteDeps {
  siteRepo: SiteRepository;
  certRepo: CertRepository;
  account: AcmeAccount;
  challengeStore: ChallengeStore;
  certDir: string;
  /**
   * Injectable issuance closure. Production wires this to
   * {@link issueCertificate}; tests substitute a fake that returns a canned
   * {@link IssueResult} so no real ACME order is opened.
   */
  issue: (opts: {
    domain: string;
    account: AcmeAccount;
    challengeStore: ChallengeStore;
    certDir: string;
  }) => Promise<IssueResult>;
}

/**
 * Issue (or re-issue) the certificate for the site identified by `siteId`.
 *
 * Returns the resulting `Cert` row — newly created or freshly updated.
 */
export async function issueCertForSite(siteId: string, deps: IssueCertForSiteDeps): Promise<Cert> {
  const site = deps.siteRepo.findById(siteId);
  if (site === null) {
    throw new NotFoundError(`site not found: ${siteId}`);
  }

  const result = await deps.issue({
    domain: site.hostname,
    account: deps.account,
    challengeStore: deps.challengeStore,
    certDir: deps.certDir,
  });

  const existing = deps.certRepo.findByDomain(site.hostname);
  if (existing === null) {
    return deps.certRepo.create({
      domain: result.domain,
      provider: 'acme',
      pemPath: result.pemPath,
      keyPath: result.keyPath,
      notBefore: result.notBefore,
      notAfter: result.notAfter,
    });
  }

  return deps.certRepo.update(existing.id, {
    pemPath: result.pemPath,
    keyPath: result.keyPath,
    notBefore: result.notBefore,
    notAfter: result.notAfter,
  });
}
