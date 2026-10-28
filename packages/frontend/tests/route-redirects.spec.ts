import { test, expect } from '@playwright/test';
import { TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from './fixtures/auth';

// Old explore URLs must answer a real HTTP 308 from the Node server (the app is
// a SPA, so a page-level redirect would first ship the empty shell).
test.describe('Legacy route redirects', () => {
	const cases: [string, string][] = [
		['/dashboard/search?q=x&project=1', '/dashboard/logs?q=x&project=1'],
		['/dashboard/monitoring', '/dashboard/uptime'],
		['/dashboard/monitoring/abc', '/dashboard/uptime/abc'],
		['/dashboard/search?projectId=p1&q=level%3Aerror&range=6h', '/dashboard/logs?projectId=p1&q=level%3Aerror&range=6h'],
		['/dashboard/monitoring?status=down', '/dashboard/uptime?status=down'],
		['/dashboard/projects/p1/sessions', '/dashboard/sessions?project=p1'],
		['/dashboard/projects/p1/sessions/s1?range=7d', '/dashboard/sessions/s1?project=p1&range=7d'],
		['/dashboard/projects/p1/performance?range=7d', '/dashboard/web-vitals?project=p1&range=7d'],
		['/dashboard/projects/p1/overview', '/dashboard/projects/p1'],
		['/dashboard/projects/p1/alerts', '/dashboard/alerts?project=p1'],
		['/dashboard/security/incidents', '/dashboard/incidents?source=sigma'],
		['/dashboard/security/incidents/i1', '/dashboard/incidents/i1'],
		['/dashboard/settings', '/dashboard/settings/general'],
	];

	for (const [from, to] of cases) {
		test(`${from} answers 308 to ${to}`, async ({ page }) => {
			const res = await page.request.get(`${TEST_FRONTEND_URL}${from}`, { maxRedirects: 0 });
			expect(res.status()).toBe(308);
			expect(res.headers()['location']).toBe(to);
		});
	}

	test('a browser visit to an old URL ends at login without an error page', async ({ page }) => {
		await page.goto(`${TEST_FRONTEND_URL}/dashboard/search?q=x`);
		await expect(page).toHaveURL(/\/login/);
	});

	test.describe('signed in', () => {
		let token: string;
		let organizationId: string;
		let projectId: string;
		const message = `redirect probe ${Date.now()}`;

		test.beforeAll(async () => {
			({ token } = await registerUser(generateTestName('Redirect'), generateTestEmail(), 'TestPassword123!'));
			const api = new TestApiClient(token);
			const org = await api.createOrganization(`Redirect Org ${Date.now()}`);
			organizationId = org.organization.id;
			const project = await api.createProject(organizationId, `Redirect Project ${Date.now()}`);
			projectId = project.project.id;
			const key = await api.createApiKey(projectId, 'Redirect Key');
			await api.ingestLogs(key.apiKey, [
				{ service: 'redirect-svc', level: 'error', message, time: new Date().toISOString() },
				{ service: 'redirect-svc', level: 'info', message: 'redirect probe quiet', time: new Date().toISOString() },
			]);
		});

		test.beforeEach(async ({ page }) => {
			await page.goto(TEST_FRONTEND_URL);
			await setAuthState(page, { id: 'test', email: 'redirect@test.com', name: 'Redirect', token }, token);
			await page.evaluate((orgId) => localStorage.setItem('currentOrganizationId', orgId), organizationId);
		});

		test('an old search link lands on Logs with the same query and range', async ({ page }) => {
			await page.goto(`${TEST_FRONTEND_URL}/dashboard/search?q=level%3Aerror&range=6h&projectId=${projectId}`);

			await expect(page).toHaveURL(/\/dashboard\/logs\?/);
			await expect(page).toHaveURL(/q=level%3Aerror/);
			await expect(page).toHaveURL(/range=6h/);
			await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
			await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue('level:error');
			await expect(page.getByRole('button', { name: 'Last 6 hours' })).toBeVisible();

			// The filter is applied, not just displayed
			const results = page.getByRole('region', { name: 'Results' });
			await expect(results.getByText(message)).toBeVisible({ timeout: 20000 });
			await expect(results.getByText('redirect probe quiet')).toHaveCount(0);
		});

		test('an old monitoring link lands on Uptime with its filter', async ({ page }) => {
			await page.goto(`${TEST_FRONTEND_URL}/dashboard/monitoring?status=down`);
			await expect(page).toHaveURL(/\/dashboard\/uptime\?.*status=down/);
			await expect(page.getByRole('heading', { name: 'Uptime', level: 1 })).toBeVisible({ timeout: 20000 });
		});

		test('an old project sessions link lands on Sessions scoped to the project', async ({ page }) => {
			await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/sessions?range=7d`);
			await expect(page).toHaveURL(new RegExp(`/dashboard/sessions\?.*project=${projectId}`));
			await expect(page).toHaveURL(/range=7d/);
			await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible({ timeout: 20000 });
		});

		test('an old project performance link lands on Web vitals scoped to the project', async ({ page }) => {
			await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/performance?range=7d`);
			await expect(page).toHaveURL(new RegExp(`/dashboard/web-vitals\?.*project=${projectId}`));
			await expect(page).toHaveURL(/range=7d/);
			await expect(page.getByRole('heading', { name: 'Web vitals', level: 1 })).toBeVisible({ timeout: 20000 });
		});

		test('an old security incidents link lands on the incident inbox filtered to Sigma', async ({ page }) => {
			await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents`);
			await expect(page).toHaveURL(/\/dashboard\/incidents\?.*source=sigma/);
			await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible({ timeout: 20000 });
		});
	});
});
