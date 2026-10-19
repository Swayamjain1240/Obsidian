import { expect, test } from '@playwright/test';

const plan = {
  planId: 'plan-e2e', baselineRunId: 'baseline-e2e', completenessRunId: 'complete-e2e', snapshotId: 'snapshot-e2e', baseCommit: 'a'.repeat(40), ownerUserId: '7', status: 'awaiting_approval', branchName: null, validationId: null, warning: null, revision: 1, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  items: [{ id: 'item-e2e', planId: 'plan-e2e', sourceCheckId: 'build', category: 'build', title: 'Review Build', reason: 'Build evidence requires review.', risk: 'low', affectedPaths: ['src/index.ts'], expectedTests: ['Build'], approvalState: 'awaiting_approval', operations: [], workerStatus: 'pending' }],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 7, login: 'e2e-user' }, configured: true, requestId: 'auth' }) }));
  await page.route('**/api/v1/workflow/repairs/plan-e2e', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan, requestId: 'plan' }) }));
  await page.route('**/api/v1/workflow/repairs/plan-e2e/items/item-e2e/approval', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: { ...plan, status: 'approved', revision: 2, items: [{ ...plan.items[0], approvalState: 'approved', workerStatus: 'pending', operations: [{ kind: 'modify', path: 'src/index.ts', contentHash: 'a'.repeat(64), contentBytes: 5 }] }] }, requestId: 'approval' }) });
  });
});

test('reviewer can approve one explicit operation and see the updated revision', async ({ page }) => {
  await page.goto('/project/repair?planId=plan-e2e&baselineRunId=baseline-e2e');
  await expect(page.getByRole('heading', { name: 'Repair review' })).toBeVisible();
  await page.getByLabel('Repository-relative path').fill('src/index.ts');
  await page.getByLabel('Approved file content').fill('fixed');
  await page.getByRole('button', { name: 'Approve operation' }).click();
  await expect(page.getByText('approved · pending')).toBeVisible();
});
