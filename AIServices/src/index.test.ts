import { describe, expect, it } from 'vitest';

import { createAiService } from './index.js';

describe('AI service boundary', () => {
  it('returns an honest unavailable result when no provider is configured', async () => {
    const result = await createAiService().run({
      operation: 'analyze',
      input: 'safe test input',
      timeoutMs: 1000,
    });

    expect(result.status).toBe('unavailable');
    expect(result.provider).toBe('disabled');
    expect(result.output).toBeUndefined();
  });

  it('does not silently construct an unsupported provider', () => {
    expect(() => createAiService('custom')).toThrow(/not implemented/);
  });
});
