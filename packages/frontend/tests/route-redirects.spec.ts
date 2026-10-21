import { test, expect } from '@playwright/test';
import { TEST_FRONTEND_URL } from './fixtures/auth';

// Old explore URLs must answer a real HTTP 308 from the Node server (the app is
// a SPA, so a page-level redirect would first ship the empty shell).
test.describe('Legacy route redirects', () => {
	const cases: [string, string][] = [
		['/dashboard/search?q=x&project=1', '/dashboard/logs?q=x&project=1'],
		['/dashboard/monitoring', '/dashboard/uptime'],
		['/dashboard/monitoring/abc', '/dashboard/uptime/abc'],
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
});
