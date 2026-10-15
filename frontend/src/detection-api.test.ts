import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, pollDetection, rescanDetection, startDetection, type DetectionResult } from './api';

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    headers: { get: () => null },
  };
}

function run(status: DetectionResult['status']): DetectionResult {
  return {
    runId: 'run-1',
    snapshotId: 'snapshot-1',
    baseCommit: 'abc123',
    archiveSha256: 'hash',
    status,
    candidates: [],
    primaryCandidateId: null,
    unknownReason: null,
    fileCount: 2,
    evidenceFileCount: 1,
    policyVersion: 'v1',
    progress: { stage: status, files: 2, bytes: 128 },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('detection API contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('polls with GET until a terminal result and does not retry the start POST', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ run: run('queued'), requestId: 'post-1' }))
      .mockResolvedValueOnce(response({ run: run('queued'), requestId: 'get-1' }))
      .mockResolvedValueOnce(response({ run: run('awaiting_confirmation'), requestId: 'get-2' }));
    vi.stubGlobal('fetch', fetchMock);

    const started = await startDetection('handle-1');
    const updates: string[] = [];
    const completed = await pollDetection('run-1', {
      signal: new AbortController().signal,
      intervalMs: 0,
      onUpdate: (next) => updates.push(next.status),
    });

    expect(started.run.status).toBe('queued');
    expect(completed.run.status).toBe('awaiting_confirmation');
    expect(updates).toEqual(['queued', 'awaiting_confirmation']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(fetchMock.mock.calls.slice(1).every((call) => call[1]?.method === undefined)).toBe(true);
  });

  it('uses the explicit rescan endpoint and surfaces a failed POST without retrying it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ run: run('awaiting_confirmation'), requestId: 'rescan-1' }))
      .mockResolvedValueOnce(response({ error: { code: 'SCAN_FAILED', message: 'scan unavailable', requestId: 'err-1' } }, false, 502));
    vi.stubGlobal('fetch', fetchMock);

    const rescanned = await rescanDetection('run-1');
    expect(rescanned.run.status).toBe('awaiting_confirmation');
    await expect(startDetection('handle-2')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/intake/detections/run-1/rescan');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/intake/detections');
  });
});
