import { test, expect } from '@playwright/test';
import { generateTestEmail, generateTestName, TEST_API_URL, TEST_FRONTEND_URL, waitForAuthForm } from '../fixtures/auth';

/**
 * Signup to first log, end to end through the UI: register, onboarding
 * workspace, copy the API key from the connect step, send a log over the
 * ingest API, see the connect step detect it and find the log in Logs.
 */

const PASSWORD = 'TestPassword123!';

test.describe('Signup to first log', () => {
  test('a new user registers, connects an app and sees the first log', async ({ page }) => {
    const message = `first log from the signup journey ${Date.now()}`;

    // 1. Register
    await page.goto(`${TEST_FRONTEND_URL}/register`);
    await waitForAuthForm(page);
    await page.locator('input#name').fill(generateTestName('Signup'));
    await page.locator('input#email').fill(generateTestEmail());
    await page.locator('input#password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // 2. Workspace
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
    await page.locator('input#org-name').fill(`Signup Org ${Date.now()}`);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    // 3. Connect: the API key is shown and Continue stays locked until data arrives
    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });
    const keyElement = page.getByTestId('api-key-value');
    await expect(keyElement).toHaveText(/\S+/, { timeout: 15000 });
    const apiKey = (await keyElement.innerText()).trim();
    expect(apiKey).toMatch(/^lp_/);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

    // 4. Ingest one log with that key
    const response = await fetch(`${TEST_API_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        logs: [{ time: new Date().toISOString(), service: 'signup-app', level: 'info', message }],
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).received).toBe(1);

    // 5. The waiter notices the signal and unlocks Continue
    await expect(page.getByText(/Received logs/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await page.getByRole('button', { name: 'Continue' }).click();

    // 6. Done, then the log shows up in Logs
    await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible({ timeout: 10000 });
    await page.getByRole('link', { name: 'Go to dashboard' }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText(message)).toBeVisible({ timeout: 20000 });
    await expect(results.getByRole('button', { name: 'Filter by service signup-app' })).toBeVisible();
  });
});
