import { test, expect } from '@playwright/test';
import { TEST_FRONTEND_URL } from './fixtures/auth';

test.describe('Navigation', () => {
	test('should redirect to login when accessing protected routes', async ({ page }) => {
		// Try to access dashboard without auth
		await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
		await expect(page).toHaveURL(/\/login/);

		// Try to access search without auth
		await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
		await expect(page).toHaveURL(/\/login/);

		// Try to access projects without auth
		await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);
		await expect(page).toHaveURL(/\/login/);
	});
});
