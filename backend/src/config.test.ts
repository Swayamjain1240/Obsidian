
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '4000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  AI_PROVIDER: 'disabled',
};

describe('loadConfig', () => {
  it('loads valid configuration without exposing values', () => {
    const config = loadConfig(validEnvironment);

    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(4000);
    expect(config.AI_PROVIDER).toBe('disabled');
    expect(config.BASELINE_MAX_CHECKS).toBe(12);
    expect(config.BASELINE_MAX_OUTPUT_BYTES).toBe(65_536);
  });

  it('rejects missing required configuration', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' }))
      .toThrow(/MONGODB_URI/);
  });

  it('requires verified worker isolation by default in production', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
    });

    expect(config.BASELINE_REQUIRE_ISOLATION).toBe(true);
  });

  it('rejects disabling sandbox isolation in production', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        BASELINE_REQUIRE_ISOLATION: 'false',
      }),
    ).toThrow(/cannot be disabled in production/);
  });

  it('allows explicit isolation in production', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      BASELINE_REQUIRE_ISOLATION: 'true',
    });

    expect(config.BASELINE_REQUIRE_ISOLATION).toBe(true);
  });
});
