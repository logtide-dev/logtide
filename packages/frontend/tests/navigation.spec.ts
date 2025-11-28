import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
	test('should have working navigation links', async ({ page }) => {
		await page.goto('/login');

		// Check that login page loads
		await expect(page).toHaveURL(/\/login/);
		// Title could be in h1, h2, or CardTitle - check for "Welcome" or "Sign in"
		await expect(page.locator('text=/welcome|sign in/i').first()).toBeVisible();
	});

	test('should redirect to login when accessing protected routes', async ({ page }) => {
		// Try to access dashboard without auth
		await page.goto('/dashboard');
		await expect(page).toHaveURL(/\/login/);

		// Try to access search without auth
		await page.goto('/search');
		await expect(page).toHaveURL(/\/login/);

		// Try to access projects without auth
		await page.goto('/projects');
		await expect(page).toHaveURL(/\/login/);
	});

	test('register page should load', async ({ page }) => {
		await page.goto('/register');

		// Title could be "Create an account" or "Sign Up"
		await expect(page.locator('text=/create.*account|sign up|register/i').first()).toBeVisible();
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.locator('input[type="password"]').first()).toBeVisible();
	});
});
