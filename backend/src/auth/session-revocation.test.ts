import { describe, expect, it, vi } from 'vitest';

const { model } = vi.hoisted(() => ({
  model: {
    updateOne: vi.fn(() => ({ exec: vi.fn(async () => undefined) })),
    findOne: vi.fn(),
    deleteOne: vi.fn(() => ({ exec: vi.fn(async () => undefined) })),
  },
}));

vi.mock('../db/connection.js', () => ({ getDatabaseStatus: () => 'connected' }));
vi.mock('../db/models.js', () => ({ AuthSessionModel: model }));

import { SessionStore } from './session-store.js';

describe('authoritative session revocation', () => {
  it('does not trust a stale local session cache when MongoDB is connected', async () => {
    const store = new SessionStore('a'.repeat(32), 60_000, 10, true);
    const signed = await store.createAsync({ githubUserId: 7, githubLogin: 'user', accessToken: 'token' });
    model.findOne.mockReturnValueOnce({ lean: () => ({ exec: async () => null }) });

    await expect(store.getAsync(signed)).resolves.toBeNull();
    expect(model.findOne).toHaveBeenCalledWith({ sessionId: expect.any(String) });
  });
});
