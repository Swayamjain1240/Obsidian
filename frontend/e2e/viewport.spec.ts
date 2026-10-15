import { expect, test } from '@playwright/test';

const run = {
  runId: 'run-e2e',
  snapshotId: 'snapshot-e2e',
  baseCommit: 'a'.repeat(40),
  archiveSha256: 'b'.repeat(64),
  status: 'awaiting_confirmation',
  candidates: [{
    id: 'typescript-react',
    language: 'TypeScript',
    frameworks: ['React'],
    packageManager: 'npm',
    evidenceStrength: 'strong',
    evidenceRefs: [{ path: 'package.json', reason: 'dependency marker: react', kind: 'dependency-marker' }],
    adapterAvailable: true,
  }],
  primaryCandidateId: 'typescript-react',
  unknownReason: null,
  fileCount: 12,
  evidenceFileCount: 1,
  policyVersion: 'part4-v1',
  progress: { stage: 'awaiting_confirmation', files: 12, bytes: 4096 },
  createdAt: '2026-10-15T00:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 7, login: 'viewport-user' }, configured: true, requestId: 'e2e-auth' }),
  }));
  await page.route('**/api/v1/intake/detections/run-e2e', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ run, requestId: 'e2e-run' }),
  }));
});

test('authenticated confirmation stays within one viewport on desktop, tablet, and mobile', async ({ page }) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/project/confirm?runId=run-e2e');
    await expect(page.getByRole('heading', { name: 'Confirm the detected stack' })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
    expect(dimensions.documentWidth, `${viewport.name} horizontal overflow`).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.documentHeight, `${viewport.name} vertical overflow`).toBeLessThanOrEqual(dimensions.viewportHeight);
  }
});
