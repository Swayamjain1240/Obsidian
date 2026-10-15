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

const completenessRun = {
  runId: 'complete-e2e',
  detectionRunId: 'run-e2e',
  snapshotId: 'snapshot-e2e',
  baseCommit: 'a'.repeat(40),
  archiveSha256: 'b'.repeat(64),
  status: 'awaiting_scope',
  projectStatus: 'partial',
  areas: [{ id: 'implementation', name: 'Implementation', status: 'partial', summary: 'One finding.', findingIds: ['implementation-1'], affectedPaths: ['src/index.ts'] }],
  findings: [{ id: 'implementation-1', kind: 'todo-marker', areaId: 'implementation', status: 'working_with_issues', summary: 'A TODO marker is present.', evidenceRefs: [{ path: 'src/index.ts', line: 3, reason: 'TODO/FIXME marker', kind: 'marker' }], affectedPaths: ['src/index.ts'] }],
  fileCount: 12,
  scannedFileCount: 8,
  scannedBytes: 4096,
  limited: false,
  warning: null,
  policyVersion: 'part5-v1',
  progress: { stage: 'awaiting_scope', files: 8, bytes: 4096, findings: 1 },
  createdAt: '2026-10-15T00:00:00.000Z',
};

const baselineRun = {
  runId: 'baseline-e2e',
  completenessRunId: 'complete-e2e',
  snapshotId: 'snapshot-e2e',
  baseCommit: 'a'.repeat(40),
  archiveSha256: 'b'.repeat(64),
  scopeMode: 'EXISTING_ONLY',
  status: 'passed',
  checks: [{ id: 'unit', category: 'unit', label: 'Unit tests', status: 'passed', summary: 'Unit tests completed successfully.', commandLabel: 'npm run test', exitCode: 0, durationMs: 12, evidenceRefs: [{ path: 'package.json', reason: 'test script selected', kind: 'manifest' }] }],
  passedCount: 1,
  failedCount: 0,
  notAvailableCount: 0,
  warning: null,
  policyVersion: 'part6-v1',
  progress: { stage: 'passed', checksCompleted: 1, checksTotal: 1, passed: 1, failed: 0, notAvailable: 0 },
  createdAt: '2026-10-15T00:00:00.000Z',
  nextPhase: 'enhancement_analysis',
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
  await page.route('**/api/v1/intake/completeness/complete-e2e', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ run: completenessRun, requestId: 'e2e-completeness' }),
  }));
  await page.route('**/api/v1/intake/baseline/baseline-e2e', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ run: baselineRun, requestId: 'e2e-baseline' }),
  }));
});

test('authenticated completeness review stays within one viewport on desktop, tablet, and mobile', async ({ page }) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/project/completeness?runId=complete-e2e&detectionRunId=run-e2e');
    await expect(page.getByRole('heading', { name: 'Review project completeness' })).toBeVisible();
    const scopeTab = page.getByRole('tab', { name: 'Scope' });
    if (await scopeTab.count()) await scopeTab.click();
    await expect(page.getByRole('button', { name: /Enhance existing parts only/ })).toBeVisible();

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

test('authenticated baseline review stays within one viewport on desktop, tablet, and mobile', async ({ page }) => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/project/baseline?runId=baseline-e2e&completenessRunId=complete-e2e');
    await expect(page.getByRole('heading', { name: 'Review baseline evidence' })).toBeVisible();
    await expect(page.locator('#baseline-check')).toBeVisible();
    await expect(page.locator('#baseline-check option')).toHaveCount(1);
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
