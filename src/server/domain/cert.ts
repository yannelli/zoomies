import { z } from 'zod';

// RFC 1123 hostname: labels of 1-63 chars (alphanumeric + hyphen, no leading
// or trailing hyphen), separated by dots. Defined locally so the cert module
// does not couple to the Site schema's hostname rules.
const DOMAIN_REGEX =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export const CertSchema = z
  .object({
    id: z.uuid(),
    domain: z.string().min(1).max(253).regex(DOMAIN_REGEX, 'must be a valid domain'),
    provider: z.enum(['acme', 'manual']),
    pemPath: z.string().min(1),
    keyPath: z.string().min(1),
    notBefore: z.iso.datetime(),
    notAfter: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine((cert) => Date.parse(cert.notBefore) < Date.parse(cert.notAfter), {
    message: 'notBefore must be earlier than notAfter',
    path: ['notAfter'],
  });

export type Cert = z.infer<typeof CertSchema>;
