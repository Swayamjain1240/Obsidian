import { describe, expect, it } from 'vitest';

import { RepositorySelectionStore } from './repository-authorization.js';

describe('repository selection authorization', () => {
  it('binds selection to both user and session', () => {
    const store = new RepositorySelectionStore();
    const repo = { id: 1, name: 'repo', full_name: 'owner/repo', private: true, default_branch: 'main', html_url: 'https://github.com/owner/repo', language: 'TypeScript', updated_at: new Date(0).toISOString() };
    store.select('7', 'session-a', repo);
    expect(store.get('8', 'session-a')).toBeNull();
    expect(store.get('7', 'session-b')).toBeNull();
    expect(store.get('7', 'session-a')?.repository.full_name).toBe('owner/repo');
  });

  it('rehydrates an owner/session selection from the workflow store', async () => {
    const records = new Map<string, unknown>();
    const durable = {
      save: async (owner: string, kind: string, id: string, value: unknown) => { records.set(`${owner}:${kind}:${id}`, structuredClone(value)); },
      get: async <T>(owner: string, kind: string, id: string) => (structuredClone(records.get(`${owner}:${kind}:${id}`)) as T | undefined) ?? null,
    } as never;
    const repo = { id: 1, name: 'repo', full_name: 'owner/repo', private: true, default_branch: 'main', html_url: 'https://github.com/owner/repo', language: 'TypeScript', updated_at: new Date(0).toISOString() };
    const first = new RepositorySelectionStore(durable);
    first.select('7', 'session-a', repo);
    await first.persist('7', 'session-a');
    const restored = await new RepositorySelectionStore(durable).getDurable('7', 'session-a');
    expect(restored?.repository.full_name).toBe('owner/repo');
  });
});
