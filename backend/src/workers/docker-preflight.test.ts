import { describe, expect, it } from 'vitest';

import { checkDockerSandbox } from './docker-preflight.js';

describe('Docker worker preflight', () => {
  it('fails closed when the Docker binary is unavailable', async () => {
    const result = await checkDockerSandbox('obsidian-sandbox:dev', 'docker-that-is-not-installed');
    expect(result.available).toBe(false);
    expect(result.summary).toMatch(/unavailable|failed/);
  });

  const dockerTest = process.env.OBSIDIAN_DOCKER_TESTS === '1' ? it : it.skip;
  dockerTest('verifies the pinned worker image runtime', async () => {
    const result = await checkDockerSandbox('obsidian-sandbox:dev');
    expect(result).toEqual({ available: true, summary: 'Restricted Docker container started successfully.' });
  }, 60_000);
});
