import { z } from 'zod';

/**
 * Hostname regex (RFC 1123-flavoured, restricted to lowercase).
 *
 * - Each label is 1–63 characters long, drawn from [a-z0-9-].
 * - Labels may NOT start or end with a hyphen.
 * - Labels are separated by a single dot. A trailing dot is rejected.
 * - A single-label hostname (e.g. `localhost`) is permitted.
 *
 * The overall length (max 253 chars) is enforced separately via `.max(253)`.
 */
const HOSTNAME_REGEX =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export const SiteSchema = z.object({
  id: z.string().uuid(),
  hostname: z
    .string()
    .min(1)
    .max(253)
    .regex(HOSTNAME_REGEX, 'must be a lowercase RFC 1123 hostname'),
  upstreamId: z.string().uuid(),
  tlsMode: z.enum(['off', 'acme', 'manual']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Site = z.infer<typeof SiteSchema>;
