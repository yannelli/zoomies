import { describe, expect, it } from 'vitest';
import { CertSchema, type Cert } from './cert.js';

const baseTimestamps = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('CertSchema', () => {
  it('accepts a valid ACME cert with notBefore < notAfter', () => {
    const cert: Cert = {
      id: '11111111-1111-4111-8111-111111111111',
      domain: 'example.com',
      provider: 'acme',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-04-01T00:00:00.000Z',
      ...baseTimestamps,
    };

    const parsed = CertSchema.parse(cert);
    expect(parsed).toEqual(cert);
  });

  it('accepts a valid manual cert', () => {
    const cert: Cert = {
      id: '22222222-2222-4222-8222-222222222222',
      domain: 'api.example.org',
      provider: 'manual',
      pemPath: '/var/lib/zoomies/manual/api.example.org.pem',
      keyPath: '/var/lib/zoomies/manual/api.example.org.key',
      notBefore: '2026-02-01T00:00:00.000Z',
      notAfter: '2027-02-01T00:00:00.000Z',
      ...baseTimestamps,
    };

    const parsed = CertSchema.parse(cert);
    expect(parsed).toEqual(cert);
  });

  it('rejects a cert where notBefore equals notAfter', () => {
    const result = CertSchema.safeParse({
      id: '33333333-3333-4333-8333-333333333333',
      domain: 'example.com',
      provider: 'acme',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-01-01T00:00:00.000Z',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cert where notBefore is after notAfter', () => {
    const result = CertSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      domain: 'example.com',
      provider: 'acme',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-06-01T00:00:00.000Z',
      notAfter: '2026-01-01T00:00:00.000Z',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cert with an invalid domain', () => {
    const result = CertSchema.safeParse({
      id: '55555555-5555-4555-8555-555555555555',
      domain: 'not a valid domain!',
      provider: 'acme',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-04-01T00:00:00.000Z',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cert with an empty pemPath', () => {
    const result = CertSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      domain: 'example.com',
      provider: 'acme',
      pemPath: '',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-04-01T00:00:00.000Z',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cert with an unknown provider', () => {
    const result = CertSchema.safeParse({
      id: '77777777-7777-4777-8777-777777777777',
      domain: 'example.com',
      provider: 'self-signed',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2026-04-01T00:00:00.000Z',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cert with a non-ISO date', () => {
    const result = CertSchema.safeParse({
      id: '88888888-8888-4888-8888-888888888888',
      domain: 'example.com',
      provider: 'acme',
      pemPath: '/etc/zoomies/certs/example.com.pem',
      keyPath: '/etc/zoomies/certs/example.com.key',
      notBefore: '01/01/2026',
      notAfter: '2026-04-01T00:00:00.000Z',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });
});
