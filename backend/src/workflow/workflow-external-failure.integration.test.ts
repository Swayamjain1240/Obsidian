import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubApiClient } from '../github/client.js';
import { loadConfig } from '../config.js';
import { DurableWorkflowStore } from './store.js';
import { WorkflowService } from './service.js';
import { normalizeOperations, operationHash } from './operation-policy.js';

describe('workflow external failure integration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retains remote PR head information for delivery reconciliation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ number: 4, html_url: 'https://github.com/owner/repo/pull/4', head: { sha: 'c'.repeat(40) }, base: { ref: 'main' } }] }));
    const pulls = await new GithubApiClient('token').listOpenPullRequests({ owner: 'owner', name: 'repo', head: 'ai/enhancement/run', base: 'main' });
    expect(pulls[0]).toMatchObject({ number: 4, headSha: 'c'.repeat(40) });
  });

  it.each([401, 403, 404, 409, 429])('maps GitHub HTTP %s to a bounded failure without exposing response data', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ message: 'private response body with token-secret' }) }));
    await expect(new GithubApiClient('token-secret').listOpenPullRequests({ owner: 'owner', name: 'repo', head: 'ai/enhancement/run', base: 'main' })).rejects.toThrow('GitHub API request failed.');
  });

  it('rejects malformed commit details before they can authorize a retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sha: 'not-a-sha', tree: {}, message: 'unexpected', parents: [] }) }));
    await expect(new GithubApiClient('token').getCommitDetails({ owner: 'owner', name: 'repo', commitSha: 'a'.repeat(40) })).rejects.toThrow('valid commit detail');
  });

  it('rejects malformed tree payloads instead of treating an incomplete remote tree as reconciled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tree: 'not-an-array' }) }));
    await expect(new GithubApiClient('token').getTreeEntries({ owner: 'owner', name: 'repo', treeSha: 'a'.repeat(40) })).rejects.toThrow('valid tree');
  });

  it('turns a network timeout into a bounded GitHub failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket timeout with token-secret')));
    await expect(new GithubApiClient('token-secret').getBranchCommitSha({ owner: 'owner', name: 'repo', branch: 'main' })).rejects.toThrow('GitHub API request failed.');
  });

  it('marks a pull-request lookup outage as recovery-required after branch, commit, and ref receipts', async () => {
    const baseCommit = 'a'.repeat(40);
    const snapshot = { snapshotId: 'external-snapshot', repository: { owner: 'owner', name: 'repo', branch: 'main', commitSha: baseCommit }, archivePath: 'archive.tar.gz', manifestPath: 'snapshot.json', archiveSha256: 'b'.repeat(64), byteLength: 1, capturedAt: new Date(0).toISOString(), immutable: true as const };
    const context = { detectionRunId: 'external-detection', ownerUserId: '7', sessionId: 'external-session', snapshot, baseCommit, archiveSha256: snapshot.archiveSha256, languageCandidates: ['TypeScript'] };
    const operations = normalizeOperations([{ kind: 'modify', path: 'src/index.ts', content: 'after' }]);
    const manifestHash = 'c'.repeat(64);
    const store = new DurableWorkflowStore();
    const config = loadConfig({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/obsidian-test', FRONTEND_ORIGIN: 'http://localhost:5173' });
    const workflow = new WorkflowService(config, { getDurable: async () => ({ runId: 'baseline-1', completenessRunId: 'complete-1', snapshotId: snapshot.snapshotId, baseCommit, status: 'passed' as const, checks: [] }), selectedContextDurable: async () => ({ baselineRunId: 'baseline-1', completenessRunId: 'complete-1', scopeMode: 'EXISTING_ONLY' as const, context }) }, { getDurable: async () => ({ areas: [] }) }, store);
    const now = new Date(0).toISOString();
    await store.saveVersioned('7', 'enhancement_run', 'enhancement-1', { enhancementRunId: 'enhancement-1', baselineRunId: 'baseline-1', completenessRunId: 'complete-1', snapshotId: snapshot.snapshotId, baseCommit, ownerUserId: '7', scopeMode: 'EXISTING_ONLY' as const, status: 'validated' as const, recommendations: [], warning: null, createdAt: now, updatedAt: now, revision: 1, sessionId: 'external-session' });
    await store.saveVersioned('7', 'version_2_run', 'version-2', { version2RunId: 'version-2', ownerUserId: '7', status: 'ready_for_pr' as const, enhancementRunId: 'enhancement-1', sessionId: 'external-session', manifest: { manifestId: 'manifest-1', version2RunId: 'version-2', baseCommit, targetBranch: 'ai/enhancement/version-2', added: [], modified: ['src/index.ts'], deleted: [], approvedRepairIds: [], approvedRecommendationIds: ['recommendation-1'], rollbackRef: baseCommit, diffHash: manifestHash, diffSummary: ['modify: src/index.ts'], generatedAt: now, snapshotId: snapshot.snapshotId, operationHash: operationHash(operations) }, receipt: { pullRequestId: 'prepared-1', version2RunId: 'version-2', owner: 'owner', repository: 'repo', branchName: 'ai/enhancement/version-2', title: 'Version 2', body: 'Prepared', url: null, status: 'prepared', createdAt: now, manifestHash, revision: 1, deliveryStep: 'prepared' }, previewAcknowledgedAt: now, previewAcknowledgedHash: manifestHash, operations, snapshotId: snapshot.snapshotId, branchName: 'ai/enhancement/version-2', revision: 1 });
    const responses: Array<{ ok: boolean; json: () => Promise<unknown>; status?: number }> = [
      { ok: true, json: async () => ({}) },
      { ok: true, json: async () => ({ sha: baseCommit }) },
      { ok: true, json: async () => ({ sha: baseCommit, tree: { sha: 'd'.repeat(40) }, message: 'base', parents: [] }) },
      { ok: true, json: async () => ({ sha: 'e'.repeat(40) }) },
      { ok: true, json: async () => ({ sha: 'f'.repeat(40) }) },
      { ok: true, json: async () => ({ sha: '1'.repeat(40) }) },
      { ok: true, json: async () => ({}) },
      { ok: false, status: 429, json: async () => ({ message: 'rate limited' }) },
    ];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => responses.shift() ?? { ok: false, status: 500, json: async () => ({}) }));

    await expect(workflow.createPullRequest('7', 'version-2', 'token', { expectedRevision: 1, sessionId: 'external-session' })).rejects.toThrow('could not be reconciled');
    const state = await workflow.getVersion2State('7', 'version-2', 'external-session');
    expect(state.deliveryStep).toBe('recovery_required');
    expect(state.deliveryReceipts?.find((receipt) => receipt.step === 'branch')?.status).toBe('completed');
    expect(state.deliveryReceipts?.find((receipt) => receipt.step === 'commit')?.status).toBe('completed');
    expect(state.deliveryReceipts?.find((receipt) => receipt.step === 'ref')?.status).toBe('completed');
    expect(state.deliveryReceipts?.find((receipt) => receipt.step === 'pull_request')?.status).toBe('recovery_required');
    const restarted = new WorkflowService(config, { getDurable: async () => ({ runId: 'baseline-1', completenessRunId: 'complete-1', snapshotId: snapshot.snapshotId, baseCommit, status: 'passed' as const, checks: [] }), selectedContextDurable: async () => ({ baselineRunId: 'baseline-1', completenessRunId: 'complete-1', scopeMode: 'EXISTING_ONLY' as const, context }) }, { getDurable: async () => ({ areas: [] }) }, store);
    await expect(restarted.getVersion2State('7', 'version-2', 'external-session')).resolves.toMatchObject({ deliveryStep: 'recovery_required', deliveryReceipts: expect.arrayContaining([expect.objectContaining({ step: 'pull_request', status: 'recovery_required' })]) });
  });
});
