import { describe, expect, it } from 'vitest';
import { bootstrapConfig } from './bootstrap-config';

describe('bootstrapConfig', () => {
  it('marks every feature as not ready while the project is pre-alpha', () => {
    expect(bootstrapConfig.features.every((f) => f.ready === false)).toBe(true);
  });
});
