import { describe, expect, it } from 'vitest';
import { UpstreamSchema, type Upstream } from './upstream.js';

const baseTimestamps = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('UpstreamSchema', () => {
  it('accepts a valid round-robin upstream with one target', () => {
    const upstream: Upstream = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'web-pool',
      targets: [{ host: 'backend.internal', port: 8080, weight: 1 }],
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    };

    const parsed = UpstreamSchema.parse(upstream);
    expect(parsed).toEqual(upstream);
  });

  it('accepts a valid least_conn upstream with three weighted targets', () => {
    const upstream: Upstream = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'api-pool',
      targets: [
        { host: '10.0.0.1', port: 8080, weight: 5 },
        { host: '10.0.0.2', port: 8080, weight: 3 },
        { host: 'api-3.svc.cluster.local', port: 9090, weight: 2 },
      ],
      loadBalancer: 'least_conn',
      ...baseTimestamps,
    };

    const parsed = UpstreamSchema.parse(upstream);
    expect(parsed).toEqual(upstream);
  });

  it('rejects an upstream with zero targets', () => {
    const result = UpstreamSchema.safeParse({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'empty',
      targets: [],
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an upstream with more than 64 targets', () => {
    const targets = Array.from({ length: 65 }, (_, i) => ({
      host: `10.0.0.${(i % 254) + 1}`,
      port: 8080,
      weight: 1,
    }));
    const result = UpstreamSchema.safeParse({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'too-big',
      targets,
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a target with port 0', () => {
    const result = UpstreamSchema.safeParse({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'bad-port-low',
      targets: [{ host: 'backend.internal', port: 0, weight: 1 }],
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a target with port 65536', () => {
    const result = UpstreamSchema.safeParse({
      id: '66666666-6666-4666-8666-666666666666',
      name: 'bad-port-high',
      targets: [{ host: 'backend.internal', port: 65536, weight: 1 }],
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a target with negative weight', () => {
    const result = UpstreamSchema.safeParse({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'bad-weight-neg',
      targets: [{ host: 'backend.internal', port: 8080, weight: -1 }],
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a target with weight 0', () => {
    const result = UpstreamSchema.safeParse({
      id: '88888888-8888-4888-8888-888888888888',
      name: 'bad-weight-zero',
      targets: [{ host: 'backend.internal', port: 8080, weight: 0 }],
      loadBalancer: 'round_robin',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid loadBalancer value', () => {
    const result = UpstreamSchema.safeParse({
      id: '99999999-9999-4999-8999-999999999999',
      name: 'bad-lb',
      targets: [{ host: 'backend.internal', port: 8080, weight: 1 }],
      loadBalancer: 'random',
      ...baseTimestamps,
    });
    expect(result.success).toBe(false);
  });
});
