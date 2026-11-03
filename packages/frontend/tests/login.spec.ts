import { test, expect } from '@playwright/test';
import {
	waitForAuthForm,
	registerUser,
	TestApiClient,
	generateTestEmail,
	generateTestName,
	TEST_FRONTEND_URL,
} from './fixtures/auth';

const PASSWORD = 'TestPassword123!';

test.describe('Login Page', () => {
	test('the register link leads to the register form', async ({ page }) => {
		await page.goto(`${TEST_FRONTEND_URL}/login`);
		await waitForAuthForm(page);

		await page.getByRole('link', { name: 'Sign up' }).click();

		await expect(page).toHaveURL(/\/register/);
		await expect(page.locator('input#name')).toBeVisible();
		await expect(page.getByRole('button', { name: /create account|sign up/i })).toBeVisible();
		await expect(page.locator('input#password')).toBeVisible();
	});

	test('empty fields are blocked by the browser and no login request is sent', async ({ page }) => {
		await page.goto(`${TEST_FRONTEND_URL}/login`);
		await waitForAuthForm(page);

		let loginRequests = 0;
		page.on('request', (req) => {
			if (req.url().includes('/api/v1/auth/login')) loginRequests++;
		});

		const emailInput = page.locator('input#email');
		const passwordInput = page.locator('input#password');

		// Nothing filled: the email field is the first invalid one
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(emailInput).toHaveJSProperty('validity.valueMissing', true);
		expect(await emailInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe('');

		// Email filled, password still empty: the password field blocks submission
		await emailInput.fill(generateTestEmail());
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(passwordInput).toHaveJSProperty('validity.valueMissing', true);
		expect(await passwordInput.evaluate((el: HTMLInputElement) => el.validationMessage)).not.toBe('');

		await expect(page).toHaveURL(/\/login/);
		expect(loginRequests).toBe(0);
	});

	test('a registered user signs in through the form and lands on the dashboard', async ({ page }) => {
		const email = generateTestEmail();
		const { token } = await registerUser(generateTestName('Login'), email, PASSWORD);
		await new TestApiClient(token).createOrganization(`Login Org ${Date.now()}`);

		await page.goto(`${TEST_FRONTEND_URL}/login`);
		await waitForAuthForm(page);
		await page.locator('input#email').fill(email);
		await page.locator('input#password').fill(PASSWORD);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();

		await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
		const stored = await page.evaluate(() => localStorage.getItem('logtide_auth'));
		expect(JSON.parse(stored as string).user.email).toBe(email);
	});

	test('a wrong password shows an error and keeps the user on the login page', async ({ page }) => {
		const email = generateTestEmail();
		await registerUser(generateTestName('Login'), email, PASSWORD);

		await page.goto(`${TEST_FRONTEND_URL}/login`);
		await waitForAuthForm(page);
		await page.locator('input#email').fill(email);
		await page.locator('input#password').fill('WrongPassword999!');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();

		await expect(page.getByRole('alert').filter({ hasText: /invalid|incorrect|credentials/i })).toBeVisible();
		await expect(page).toHaveURL(/\/login/);
		expect(await page.evaluate(() => localStorage.getItem('logtide_auth'))).toBeNull();
	});
});
