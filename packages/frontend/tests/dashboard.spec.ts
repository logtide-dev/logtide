import { test, expect } from '@playwright/test';
import {
	registerUser,
	setAuthState,
	TestApiClient,
	generateTestName,
	generateTestEmail,
	TEST_FRONTEND_URL,
} from './fixtures/auth';
import { createTestLog, generateId } from './helpers/factories';

test.describe('Dashboard', () => {
	test('the default dashboard shows the counts of the logs the org ingested', async ({ page }) => {
		const { user, token } = await registerUser(generateTestName('Dash'), generateTestEmail(), 'TestPassword123!');
		const api = new TestApiClient(token);
		const { organization } = await api.createOrganization(`Dash Org ${Date.now()}`);
		const { project } = await api.createProject(organization.id, `Dash Project ${Date.now()}`);
		const { apiKey } = await api.createApiKey(project.id, 'dashboard key');

		const service = `dash-svc-${generateId()}`;
		const levels = ['error', 'error', 'error', 'info', 'info'] as const;
		const ingested = await api.ingestLogs(
			apiKey,
			levels.map((level, i) => createTestLog({ level, service, message: `dashboard log ${i}` }))
		);
		expect(ingested.received).toBe(5);

		await page.goto(TEST_FRONTEND_URL);
		await setAuthState(page, user, token);
		await page.evaluate((orgId) => localStorage.setItem('currentOrganizationId', orgId), organization.id);
		await page.goto(`${TEST_FRONTEND_URL}/dashboard`);

		const panel = (title: string) =>
			page.locator('div.rounded-lg.border').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

		// Stat cards reflect exactly the 5 logs from 1 service (ingestion is async, so web-first retries)
		await expect(panel('Total logs today').getByText('5', { exact: true })).toBeVisible({ timeout: 30000 });
		await expect(panel('Active services').getByText('1', { exact: true })).toBeVisible();
		await expect(panel('Error rate')).toContainText('60.0%');

		// Top services lists the service this test created with its log count
		const topServices = panel('Top services');
		await expect(topServices.getByText(service, { exact: true })).toBeVisible();
		await expect(topServices).toContainText('5 logs');

		// Chart panel is rendered with its title
		await expect(page.getByRole('heading', { name: /Activity overview/ })).toBeVisible();
	});
});
