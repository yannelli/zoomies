import { z } from 'zod';

// RFC 1123 hostname: labels of 1-63 chars (alphanumeric + hyphen, no leading
// or trailing hyphen), separated by dots. Total length capped at 253 chars
// by the outer z.string().max() below.
const HOSTNAME_REGEX =
  /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const HostnameOrIpSchema = z.union([
  z.ipv4(),
  z.ipv6(),
  z.string().min(1).max(253).regex(HOSTNAME_REGEX, 'must be a valid hostname'),
]);

export const UpstreamTargetSchema = z.object({
  host: HostnameOrIpSchema,
  port: z.number().int().min(1).max(65535),
  weight: z.number().int().min(1).max(1000),
});

export const UpstreamSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  targets: z.array(UpstreamTargetSchema).min(1).max(64),
  loadBalancer: z.enum(['round_robin', 'least_conn', 'ip_hash']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UpstreamTarget = z.infer<typeof UpstreamTargetSchema>;
export type Upstream = z.infer<typeof UpstreamSchema>;
