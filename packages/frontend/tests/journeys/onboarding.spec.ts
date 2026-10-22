import { test, expect, type Page } from '@playwright/test';
import { generateTestEmail, generateTestName, TEST_FRONTEND_URL, waitForAuthForm } from '../fixtures/auth';

/**
 * Onboarding is four steps: verify email (only when the server requires it),
 * workspace, connect, done. The test stack does not require email verification,
 * so these journeys start at the workspace step.
 */

const PASSWORD = 'TestPassword123!';

async function register(page: Page, label: string) {
  await page.goto(`${TEST_FRONTEND_URL}/register`);
  await waitForAuthForm(page);
  await page.locator('input#name').fill(generateTestName(label));
  await page.locator('input#email').fill(generateTestEmail());
  await page.locator('input#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });
}

async function createWorkspace(page: Page, orgName: string, projectName = 'Production') {
  await page.locator('input#org-name').fill(orgName);
  await page.locator('input#project-name').fill(projectName);
  await page.getByRole('button', { name: 'Create workspace' }).click();
}

test.describe('Onboarding journey', () => {
  test('new user lands on the workspace step with a progress indicator', async ({ page }) => {
    await register(page, 'Workspace');

    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input#org-name')).toBeVisible();
    await expect(page.locator('input#project-name')).toHaveValue('Production');

    const progress = page.getByRole('progressbar', { name: 'Setup progress' });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', /\d+/);
    await expect(page.locator('li[aria-current="step"]')).toContainText('Workspace');
    // No email step when verification is not required
    await expect(page.getByText('Verify email')).toHaveCount(0);
  });

  test('create workspace moves to connect and shows the API key once', async ({ page }) => {
    await register(page, 'Connect');

    await createWorkspace(page, `Test Org ${Date.now()}`);

    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });
    const key = page.getByTestId('api-key-value');
    await expect(key).toBeVisible({ timeout: 15000 });
    await expect(key).toHaveText(/\S+/);
    await expect(page.getByRole('radiogroup', { name: 'Platform' })).toBeVisible();

    // Continue is locked until the first signal arrives
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  test('skip on connect reaches done and completes onboarding', async ({ page }) => {
    await register(page, 'Done');
    await createWorkspace(page, `Skip Org ${Date.now()}`);

    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /Explore your logs/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Create an alert/ })).toBeVisible();

    await page.getByRole('link', { name: 'Go to dashboard' }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Completed users are not sent back to onboarding
    await page.goto(`${TEST_FRONTEND_URL}/onboarding`);
    await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  });

  test('reload on connect resumes the same step without a second workspace', async ({ page }) => {
    await register(page, 'Resume');
    await createWorkspace(page, `Resume Org ${Date.now()}`);
    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });

    await page.reload();

    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input#org-name')).toHaveCount(0);
  });

  test('workspace form needs an organization name', async ({ page }) => {
    await register(page, 'Validation');

    await page.locator('input#org-name').fill('');
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeDisabled();

    // Suggestions come from the email domain, so click whichever the form offers first
    await page.locator('input#org-name ~ div button').first().click();
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  });
});

test.describe('Onboarding mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('workspace step fits at 375 px without horizontal scroll', async ({ page }) => {
    await register(page, 'Mobile');

    const submit = page.getByRole('button', { name: 'Create workspace' });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});

test.describe('Onboarding accessibility', () => {
  test('fields have labels and the form is keyboard reachable', async ({ page }) => {
    await register(page, 'A11y');

    await expect(page.getByLabel('Organization name')).toBeVisible();
    await expect(page.getByLabel('First project name')).toBeVisible();

    await page.getByLabel('Organization name').focus();
    await page.keyboard.type('Keyboard Org');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });
  });
});
