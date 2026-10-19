import type { GithubRepository } from '../github/client.js';
import type { WorkflowStore } from '../workflow/store.js';

export interface SelectedRepository {
  ownerUserId: string;
  sessionId: string;
  repository: GithubRepository;
  selectedBranch: string;
  selectedAt: string;
}

export class RepositorySelectionStore {
  private readonly selections = new Map<string, SelectedRepository>();

  public constructor(private readonly store?: WorkflowStore) {}

  public select(ownerUserId: string, sessionId: string, repository: GithubRepository, selectedBranch = repository.default_branch): SelectedRepository {
    const value = { ownerUserId, sessionId, repository: { ...repository }, selectedBranch, selectedAt: new Date().toISOString() };
    this.selections.set(`${ownerUserId}:${sessionId}`, value);
    return value;
  }

  public get(ownerUserId: string, sessionId: string): SelectedRepository | null {
    const value = this.selections.get(`${ownerUserId}:${sessionId}`);
    return value ? { ...value, repository: { ...value.repository } } : null;
  }

  public async persist(ownerUserId: string, sessionId: string): Promise<void> {
    const selected = this.get(ownerUserId, sessionId);
    if (!selected) return;
    await this.store?.save(ownerUserId, 'repository_selection', sessionId, selected);
  }

  public async getDurable(ownerUserId: string, sessionId: string): Promise<SelectedRepository | null> {
    const cached = this.get(ownerUserId, sessionId);
    if (cached) return cached;
    const persisted = await this.store?.get<SelectedRepository>(ownerUserId, 'repository_selection', sessionId);
    if (!persisted || persisted.ownerUserId !== ownerUserId || persisted.sessionId !== sessionId || typeof persisted.selectedBranch !== 'string') return null;
    this.selections.set(`${ownerUserId}:${sessionId}`, { ...persisted, repository: { ...persisted.repository } });
    return this.get(ownerUserId, sessionId);
  }

  public clear(ownerUserId: string, sessionId: string): void {
    this.selections.delete(`${ownerUserId}:${sessionId}`);
  }
}
