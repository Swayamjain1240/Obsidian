import { expect, test } from '@playwright/test';

test('recovery-required Version 2 state stays visible and does not offer PR creation', async ({ page }) => {
  await page.route('**/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 7, login: 'e2e-user' }, configured: true, requestId: 'auth' }) }));
  await page.route('**/api/v1/workflow/version2/version-2', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version2: { version2RunId: 'version-2', ownerUserId: '7', status: 'recovery_required', enhancementRunId: 'enhancement-1', manifest: null, receipt: null, revision: 3 }, requestId: 'state' }) }));
  await page.route('**/api/v1/workflow/version2/version-2/diff', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'WORKFLOW_STATE_INVALID', message: 'Version 2 has no change manifest.', requestId: 'diff' } }) }));
  await page.goto('/project/delivery?version2RunId=version-2');
  await expect(page.getByText('recovery_required')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create pull request' })).toBeDisabled();
});
