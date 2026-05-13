import { describe, expect, it } from 'vitest';
import { bootstrapConfig } from './bootstrap-config';

describe('bootstrapConfig', () => {
  it('keeps `ready` and `status: "shipped"` in sync per feature', () => {
    for (const feature of bootstrapConfig.features) {
      const isShipped = feature.status === 'shipped';
      expect(feature.ready, `${feature.name}: ready === (status === "shipped")`).toBe(isShipped);
    }
  });

  it('exposes at least one shipped feature so a future regression is caught', () => {
    const shipped = bootstrapConfig.features.filter((f) => f.ready);
    expect(shipped.length).toBeGreaterThan(0);
  });
});
