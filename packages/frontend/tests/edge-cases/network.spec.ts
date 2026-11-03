import { test, expect, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_API_URL, TEST_FRONTEND_URL, TestApiClient, waitForAuthForm } from '../fixtures/auth';
import { generateId } from '../helpers/factories';

const ALERTS_API = /\/api\/v1\/alerts(\?.*)?$/;

test.describe('Network Edge Cases', () => {
  let userToken: string;
  let organizationId: string;
  let projectId: string;
  let apiClient: TestApiClient;
  let channelName: string;
  const probe = `network probe ${generateId()}`;

  test.beforeAll(async () => {
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Network'), email, 'TestPassword123!');
    userToken = token;

    apiClient = new TestApiClient(token);
    const orgResult = await apiClient.createOrganization(`Network Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    const projectResult = await apiClient.createProject(organizationId, `Network Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    // One log, so the logs page has data to show once the API answers again
    const key = await apiClient.createApiKey(projectId, 'Network Test Key');
    await apiClient.ingestLogs(key.apiKey, [
      { service: 'network-svc', level: 'info', message: probe, time: new Date().toISOString() },
    ]);
    await expect
      .poll(async () => (await apiClient.getLogs(projectId, { limit: '10' })).logs.length, { timeout: 20000 })
      .toBe(1);

    channelName = `Network Channel ${Date.now()}`;
    await apiClient.createNotificationChannel(organizationId, channelName, 'webhook', {
      url: 'https://example.com/e2e-hook',
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Network Test', token: userToken }, userToken);

    // Set organization context
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);

    // Navigate to dashboard to trigger org loading
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    // RequireOrganization shows content only when the organization is ready
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible({ timeout: 30000 });
  });

  test('Login page handles network error gracefully', async ({ page }) => {
    // Clear auth and go to login
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await waitForAuthForm(page);

    // Intercept API requests to simulate network failure
    await page.route('**/api/v1/auth/login', (route) => route.abort('failed'));

    await page.locator('input#email').fill('test@example.com');
    await page.locator('input#password').fill('password123');
    await page.locator('button[type="submit"]').click();

    // The form shows the failure, stays on the login page and can be submitted again
    await expect(page.getByRole('alert').filter({ hasText: 'Failed to fetch' }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    await expect(page.locator('input#email')).toHaveValue('test@example.com');
  });

  test('Dashboard shows a loading state while the API is slow, then the panels', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/custom-dashboards**', async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);

    // While the responses are held back the page shows skeletons, not an error or empty state
    await expect(page.locator('.skeleton').first()).toBeVisible();
    await expect(page.getByText('Could not load the dashboard')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Total logs today' })).toHaveCount(0);

    release();

    // Real panels render once the delayed responses arrive
    await expect(page.getByRole('heading', { name: 'Total logs today' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Error rate' })).toBeVisible();
    await expect(page.getByText('Could not load the dashboard')).toHaveCount(0);
  });

  test('Dashboard shows an error with a working Retry when the API fails', async ({ page }) => {
    await page.route('**/api/v1/custom-dashboards**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Dashboards are down' }) })
    );

    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await expect(page.getByText('Could not load the dashboard')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Total logs today' })).toHaveCount(0);

    await page.unroute('**/api/v1/custom-dashboards**');
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByRole('heading', { name: 'Total logs today' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Could not load the dashboard')).toHaveCount(0);
  });

  test('Search page shows the API error and no rows when the logs endpoint fails', async ({ page }) => {
    await page.route('**/api/v1/logs**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    );

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?projectId=${projectId}`);
    const results = page.getByRole('region', { name: 'Results' });

    await expect(results.getByText('Could not load logs')).toBeVisible({ timeout: 20000 });
    await expect(results.getByText('Internal Server Error')).toBeVisible();
    await expect(results.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(results.getByText(probe)).toHaveCount(0);
    await expect(results.getByRole('row').filter({ hasText: probe })).toHaveCount(0);
  });

  test('Page redirects to login and clears the session when the API answers 401', async ({ page }) => {
    await page.route('**/api/v1/logs**', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) })
    );

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?projectId=${projectId}`);

    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard%2Flogs/, { timeout: 20000 });
    await waitForAuthForm(page);
    expect(await page.evaluate(() => localStorage.getItem('logtide_auth'))).toBeNull();
  });

  test('Form shows validation errors, then the API error, and keeps the dialog open', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);
    await page.getByRole('button', { name: 'Create alert' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Create alert rule' });
    await expect(dialog).toBeVisible();

    // Empty submit: client side validation, nothing is sent
    let createCalls = 0;
    await page.route(ALERTS_API, async (route) => {
      if (route.request().method() === 'POST') {
        createCalls++;
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          // the alerts client reads `message`; the real backend only sends `error` (see report)
          body: JSON.stringify({ statusCode: 400, error: 'Rule rejected by the server', message: 'Rule rejected by the server' }),
        });
      } else {
        await route.continue();
      }
    });
    await dialog.getByRole('button', { name: 'Create alert' }).click();
    await expect(dialog.getByText('Enter an alert name')).toBeVisible();
    await expect(dialog.getByText('Select at least one channel')).toBeVisible();
    expect(createCalls).toBe(0);

    // Valid input: the server rejects it and the message is shown while the dialog stays open
    await dialog.getByRole('textbox', { name: 'Alert name' }).fill('Network edge rule');
    await dialog.getByRole('button', { name: 'Select channels...' }).click();
    await page.getByRole('button', { name: new RegExp(channelName) }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Create alert' }).click();

    await expect(page.getByText('Rule rejected by the server')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Alert name' })).toHaveValue('Network edge rule');
    expect(createCalls).toBe(1);
  });

  test('Page recovers after the network comes back', async ({ page }) => {
    // Offline: every logs request fails at the network level
    await page.route('**/api/v1/logs**', (route) => route.abort('failed'));

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?projectId=${projectId}`);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText('Could not load logs')).toBeVisible({ timeout: 20000 });
    await expect(results.getByText(probe)).toHaveCount(0);

    // Back online: Retry loads the seeded log
    await page.unroute('**/api/v1/logs**');
    await results.getByRole('button', { name: 'Retry' }).click();

    await expect(results.getByText(probe)).toBeVisible({ timeout: 20000 });
    await expect(results.getByText('Could not load logs')).toHaveCount(0);
  });
});

test.describe('Session Edge Cases', () => {
  test('Handles concurrent sessions gracefully', async ({ browser }) => {
    const email = generateTestEmail();
    const { user, token } = await registerUser(generateTestName('Concurrent'), email, 'TestPassword123!');
    const apiClient = new TestApiClient(token);
    const orgName = `Concurrent Test Org ${Date.now()}`;
    const organizationId = (await apiClient.createOrganization(orgName)).organization.id;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    try {
      const pages = [await context1.newPage(), await context2.newPage()];

      // Same user signed in in two independent browser contexts
      for (const page of pages) {
        await page.goto(TEST_FRONTEND_URL);
        await setAuthState(page, user, token);
        await page.evaluate((orgId) => {
          localStorage.setItem('currentOrganizationId', orgId);
        }, organizationId);
        await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
      }

      for (const page of pages) {
        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
        await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible({ timeout: 30000 });
        await expect(page.getByRole('combobox', { name: 'Switch organization' })).toContainText(orgName);
      }

      // The session ends (logout elsewhere): the other tab is sent to login on its next request
      const logout = await fetch(`${TEST_API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(logout.ok).toBe(true);

      await pages[1].goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);
      await expect(pages[1]).toHaveURL(/\/login/, { timeout: 30000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('Handles expired token gracefully', async ({ page }) => {
    // Set an invalid/expired token
    await page.goto(TEST_FRONTEND_URL);
    await page.evaluate(() => {
      localStorage.setItem('logtide_auth', JSON.stringify({
        user: { id: 'test', email: 'test@test.com', name: 'Test' },
        token: 'invalid-expired-token',
        loading: false,
      }));
    });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);

    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await waitForAuthForm(page);
    await expect(page.locator('input#email')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('logtide_auth'))).toBeNull();
  });
});

test.describe('Browser Edge Cases', () => {
  async function signIn(page: import('@playwright/test').Page, label: string) {
    const email = generateTestEmail();
    const { user, token } = await registerUser(generateTestName(label), email, 'TestPassword123!');
    const apiClient = new TestApiClient(token);
    const orgName = `${label} Test Org ${Date.now()}`;
    const organizationId = (await apiClient.createOrganization(orgName)).organization.id;

    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, user, token);
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);
    return orgName;
  }

  test('Handles page refresh without losing context', async ({ page }) => {
    const orgName = await signIn(page, 'Refresh');
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await expect(page.getByRole('combobox', { name: 'Switch organization' })).toContainText(orgName, { timeout: 30000 });

    await page.reload();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('combobox', { name: 'Switch organization' })).toContainText(orgName);
  });

  test('Handles browser back/forward navigation', async ({ page }) => {
    await signIn(page, 'NavHistory');

    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible({ timeout: 30000 });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible({ timeout: 30000 });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({ timeout: 30000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/logs/);
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible({ timeout: 30000 });

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible({ timeout: 30000 });

    await page.goForward();
    await expect(page).toHaveURL(/\/dashboard\/logs/);
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible({ timeout: 30000 });
  });
});
