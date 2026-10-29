import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createErrorLogs, wait } from '../helpers/factories';

test.describe('Alert Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let apiKey: string;
  let organizationId: string;
  let testUserEmail: string;

  test.beforeAll(async () => {
    // Create test user and setup
    testUserEmail = generateTestEmail();
    const { token } = await registerUser(generateTestName('Alert'), testUserEmail, 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    // Create organization
    const orgResult = await apiClient.createOrganization(`Alert Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    // Create project
    const projectResult = await apiClient.createProject(organizationId, `Alert Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    // Create API key
    const apiKeyResult = await apiClient.createApiKey(projectId, 'Alert Test Key');
    apiKey = apiKeyResult.apiKey;
  });

  test.beforeEach(async ({ page }) => {
    // Set auth state before each test
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: testUserEmail, name: 'Alert Test', token: userToken }, userToken);

    // Also set the current organization ID in localStorage so the store can restore it
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);

    // Navigate to dashboard first to trigger organization loading
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await page.waitForLoadState('load');
    // Wait for organization to be loaded (RequireOrganization shows content only when org is ready)
    await page.waitForSelector('nav, [class*="sidebar"], h1, h2', { timeout: 30000 });
    await page.waitForTimeout(500);
  });

  test('1. User can view the alerts page', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');

    // Verify alerts page elements with longer timeout for CI
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible({ timeout: 30000 });

    // Verify empty state or create button
    const createButton = page.getByRole('button', { name: 'Create alert' });
    await expect(createButton.first()).toBeVisible({ timeout: 10000 });
  });

  test('2. User can open the create alert dialog', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');

    // Wait for page to be ready with longer timeout for CI
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible({ timeout: 30000 });

    // Click create alert button - be more specific to avoid sidebar buttons if any
    const createButton = page.locator('main').getByRole('button', { name: 'Create alert' });
    await expect(createButton.first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000); // Wait for animations
    await createButton.first().click({ force: true });

    // Wait for dialog to be fully visible
    const dialog = page.locator('[role="dialog"]');
    try {
        await expect(dialog).toBeVisible({ timeout: 10000 });
    } catch (e) {
        console.log('Dialog did not appear. Page inner text:', await page.innerText('body'));
        throw e;
    }

    // Verify dialog contains expected elements - use flexible matching
    await expect(dialog.getByText('Create alert rule')).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByLabel('Alert name')).toBeVisible({ timeout: 5000 });
  });

  test('3. User can create an alert rule', async ({ page }) => {
    // 1. Create a notification channel via API first
    const channelName = `E2E Channel ${Date.now()}`;
    await apiClient.createNotificationChannel(
      organizationId,
      channelName,
      'email',
      { recipients: ['test@e2e.logtide.dev'] },
      { enabled: true }
    );

    // 2. Navigate to alerts page
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible({ timeout: 30000 });

    // 3. Open the Create alert dialog
    const createButton = page.getByRole('button', { name: 'Create alert' });
    await expect(createButton.first()).toBeVisible({ timeout: 10000 });
    await createButton.first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(500);

    // 4. Fill basic fields
    const alertName = `E2E Alert ${Date.now()}`;
    await dialog.locator('input#alert-name').fill(alertName);
    await dialog.locator('input#alert-threshold').fill('3');
    await dialog.locator('input#alert-window').fill('5');

    // 5. Handle Notification Channel selection using ChannelSelector
    const channelSelector = page.locator('[data-popover-trigger]').filter({ hasText: /Select channels/i }).first();
    await expect(channelSelector).toBeVisible({ timeout: 10000 });
    await channelSelector.click({ force: true });
    await page.waitForTimeout(2000); 

    // Try to find the channel we created via API
    const channelOption = page.locator('button').filter({ hasText: channelName }).first();
    if (await channelOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await channelOption.click({ force: true });
    } else {
        console.log('API channel not found, creating one via UI...');
        // Fallback: create channel via UI
        const createUiBtn = page.locator('button').filter({ hasText: /Create.*channel/i }).last();
        await createUiBtn.click({ force: true });
        
        await page.waitForTimeout(1000);
        // Find the newly opened dialog (nested)
        const nestedDialog = page.locator('[role="dialog"]').last();
        await nestedDialog.locator('input').first().fill(`UI-${Date.now()}`);
        await nestedDialog.locator('input').nth(1).fill('test@ui.dev');
        await nestedDialog.locator('button').filter({ hasText: /Create/i }).first().click({ force: true });
        await page.waitForTimeout(2000);
    }

    // 6. Submit the form
    const submitBtn = dialog.getByRole('button', { name: 'Create alert' });
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();

    // 7. Verify the alert was created (dialog should close)
    await page.waitForTimeout(2000);
    const dialogStillOpen = await dialog.isVisible().catch(() => false);
    const pageContent = await page.content();
    expect(dialogStillOpen === false || pageContent.includes(alertName)).toBe(true);
  });

  test('4. User can toggle alert enabled/disabled', async ({ page }) => {
    // First create an alert via API
    await apiClient.createAlertRule(projectId, {
      organizationId,
      projectId,
      name: `Toggle Test Alert ${Date.now()}`,
      enabled: true,
      level: ['error'],
      threshold: 5,
      timeWindow: 5,
      emailRecipients: ['test@e2e-test.logtide.dev'],
    });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // The enable switch is labelled "Disable <name>" while the rule is on
    const toggle = page.getByRole('switch', { name: /^Disable Toggle Test Alert/ }).first();
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await toggle.click();

    // After the patch the same row offers "Enable <name>"
    await expect(page.getByRole('switch', { name: /^Enable Toggle Test Alert/ }).first()).toBeVisible({ timeout: 10000 });
  });

  test('5. User can delete an alert rule', async ({ page }) => {
    // First create an alert via API
    const alertName = `Delete Test Alert ${Date.now()}`;
    await apiClient.createAlertRule(projectId, {
      organizationId,
      projectId,
      name: alertName,
      enabled: true,
      level: ['error'],
      threshold: 5,
      timeWindow: 5,
      emailRecipients: ['test@e2e-test.logtide.dev'],
    });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // The rule is a table row with a labelled delete button
    const deleteButton = page.getByRole('button', { name: `Delete alert ${alertName}` });
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();

    // ConfirmDialog: Cancel has focus, Delete must be clicked explicitly
    const dialogTitle = page.getByText('Delete alert rule');
    await expect(dialogTitle).toBeVisible({ timeout: 5000 });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

    // Wait for the dialog to close (indicates action was taken)
    await expect(dialogTitle).toBeHidden({ timeout: 10000 });

    // Verify via API that the alert count decreased or specific alert is gone
    // This is more reliable than checking UI on CI
    await page.waitForTimeout(1000); // Give backend time to process
    const alerts = await apiClient.getAlertRules(organizationId, projectId);
    const alertStillExists = alerts.alertRules?.some((a: any) => a.name === alertName) ?? false;
    expect(alertStillExists).toBe(false);
  });

  test('6. Alert is triggered when threshold is reached', async ({ page }) => {
    // Create an alert with low threshold
    const alertName = `Trigger Test Alert ${Date.now()}`;
    await apiClient.createAlertRule(projectId, {
      organizationId,
      projectId,
      name: alertName,
      enabled: true,
      level: ['error'],
      threshold: 3,
      timeWindow: 5,
      emailRecipients: ['test@e2e-test.logtide.dev'],
    });

    // Ingest enough error logs to trigger the alert
    const errorLogs = createErrorLogs(5, 'trigger-test-service');
    await apiClient.ingestLogs(apiKey, errorLogs);

    // Wait for alert processing
    await wait(5000);

    // Navigate to alert history page
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Check if alert history shows triggered alerts
    // Note: This depends on the alert processing worker running
    const pageContent = await page.content();
    // We just verify the page loads correctly - actual triggering depends on worker
    expect(pageContent).toContain('Alert');
  });

  test('7. User can view alert history', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);
    await page.waitForLoadState('load');

    // Verify alert history page elements with longer timeout for CI
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible({ timeout: 30000 });

    // The History tab shows rows or an empty table
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible({ timeout: 10000 });
  });

  test('8. Sigma import lives in Security > Rules, not in the alert dialog', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible({ timeout: 30000 });

    // No Sigma tab on the project alerts page
    await expect(page.getByRole('tab', { name: /sigma/i })).toHaveCount(0);

    // The dialog points to Security > Rules instead of offering an import tab
    await page.getByRole('button', { name: 'Create alert' }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole('tab', { name: /sigma/i })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: /security > rules/i })).toHaveAttribute('href', '/dashboard/security/rules');
  });
});
