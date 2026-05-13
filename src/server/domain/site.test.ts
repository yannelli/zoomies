import { describe, expect, it } from 'vitest';

import { SiteSchema } from './site.js';

const VALID_SITE = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  hostname: 'example.com',
  upstreamId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  tlsMode: 'acme' as const,
  createdAt: '2026-05-13T12:34:56.000Z',
  updatedAt: '2026-05-13T12:34:56.000Z',
};

describe('SiteSchema', () => {
  it('round-trips a fully valid site', () => {
    const parsed = SiteSchema.parse(VALID_SITE);

    expect(parsed).toEqual(VALID_SITE);
  });

  it('accepts a multi-label hostname', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      hostname: 'api.staging.example.com',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      id: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID upstreamId', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      upstreamId: 'upstream-1',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a hostname containing spaces', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      hostname: 'example com',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a hostname with uppercase letters', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      hostname: 'Example.com',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a hostname with a leading hyphen on a label', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      hostname: '-bad.example.com',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a hostname with a trailing hyphen on a label', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      hostname: 'bad-.example.com',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a hostname longer than 253 characters', () => {
    // 64 chars per label is over the per-label max (63), so build a
    // chain of valid 63-char labels until the total exceeds 253.
    const label = 'a'.repeat(63);
    const oversize = [label, label, label, label].join('.'); // 63*4 + 3 = 255
    expect(oversize.length).toBeGreaterThan(253);

    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      hostname: oversize,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid tlsMode value', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      tlsMode: 'auto',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO createdAt value', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      createdAt: '2026-05-13 12:34:56',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO updatedAt value', () => {
    const result = SiteSchema.safeParse({
      ...VALID_SITE,
      updatedAt: 'yesterday',
    });

    expect(result.success).toBe(false);
  });
});
