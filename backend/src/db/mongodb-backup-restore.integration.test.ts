import { describe, expect, it } from 'vitest';

const enabled = process.env.OBSIDIAN_ALLOW_DISPOSABLE_MONGO_TESTS === '1' && Boolean(process.env.OBSIDIAN_MONGODB_TEST_URI);
const suite = enabled ? describe : describe.skip;

suite('MongoDB backup/restore integration contract', () => {
  it('uses only a disposable Phase 3 database name', () => {
    expect(process.env.OBSIDIAN_MONGODB_TEST_URI).toContain('obsidian_phase3');
  });
});
