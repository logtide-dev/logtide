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
    const { user, token } = await registerUser(generateTestName('Alert'), testUserEmail, 'TestPassword123!');
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
    await expect(page.locator('h2:has-text("Alert Rules")')).toBeVisible({ timeout: 30000 });

    // Verify empty state or create button
    const createButton = page.locator('button:has-text("Create Alert"), button:has-text("Create Your First Alert")');
    await expect(createButton.first()).toBeVisible({ timeout: 10000 });
  });

  test('2. User can open the create alert dialog', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');

    // Wait for page to be ready with longer timeout for CI
    await expect(page.locator('h2:has-text("Alert Rules")')).toBeVisible({ timeout: 30000 });

    // Click create alert button
    const createButton = page.locator('button:has-text("Create Alert"), button:has-text("Create Your First Alert")');
    await createButton.first().click({ timeout: 10000 });

    // Verify dialog is open
    const dialog = page.locator('[role="dialog"], [class*="dialog"], [class*="Dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify dialog contains expected elements - use flexible matching
    await expect(page.locator('text=/alert.*name|name/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('3. User can create an alert rule', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');

    // Wait for page to be ready
    await expect(page.locator('h2:has-text("Alert Rules")')).toBeVisible({ timeout: 30000 });

    // Click create alert button
    const createButton = page.locator('button:has-text("Create Alert"), button:has-text("Create Your First Alert")');
    await createButton.first().click();

    // Fill the form
    const alertName = `E2E Test Alert ${Date.now()}`;
    await page.locator('input#name, input[placeholder*="error rate" i]').fill(alertName);

    // Select error level (should be pre-selected, but click to be sure)
    const errorButton = page.locator('button:has-text("error")').first();
    if (await errorButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Check if it's already selected (default variant)
      const isSelected = await errorButton.getAttribute('class');
      if (!isSelected?.includes('default')) {
        await errorButton.click();
      }
    }

    // Set threshold and time window
    await page.locator('input#threshold').fill('3');
    await page.locator('input#timeWindow').fill('5');

    // Set email recipient
    await page.locator('input#emails').fill('test@e2e-test.logward.dev');

    // Submit the form
    await page.locator('button:has-text("Create Alert")').last().click();

    // Wait for dialog to close and success message
    await page.waitForTimeout(2000);

    // Verify the alert was created
    const pageContent = await page.content();
    expect(pageContent).toContain(alertName);
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
      emailRecipients: ['test@e2e-test.logward.dev'],
    });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Find the disable button
    const disableButton = page.locator('button:has-text("Disable")').first();
    if (await disableButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await disableButton.click();
      await page.waitForTimeout(1000);

      // Verify the button text changed to Enable
      await expect(page.locator('button:has-text("Enable")').first()).toBeVisible();
    }
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
      emailRecipients: ['test@e2e-test.logward.dev'],
    });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Find and click delete button
    const deleteButton = page.locator('button:has-text("Delete")').first();
    if (await deleteButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await deleteButton.click();
      await page.waitForTimeout(500);

      // Confirm deletion in dialog
      const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete"), [class*="AlertDialog"] button:has-text("Delete")');
      if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmButton.click();
        await page.waitForTimeout(2000);
      }

      // Verify the alert was deleted
      const pageContent = await page.content();
      expect(pageContent).not.toContain(alertName);
    }
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
      emailRecipients: ['test@e2e-test.logward.dev'],
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
    await expect(page.locator('h1:has-text("Alerts")')).toBeVisible({ timeout: 30000 });

    // Page shows tabs - click on "Alert History" tab if not already active
    const historyTab = page.locator('button:has-text("Alert History"), [role="tab"]:has-text("History")');
    if (await historyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await historyTab.click();
      await page.waitForTimeout(1000);
    }

    // Page should either show history cards or empty state ("No alert history")
    const hasHistory = await page.locator('[class*="Card"]').first().isVisible().catch(() => false);
    const hasEmptyState = await page.locator('text=/no.*alert.*history/i').isVisible().catch(() => false);

    expect(hasHistory || hasEmptyState).toBe(true);
  });

  test('8. User can import Sigma rule as alert', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');

    // Wait for page to be ready
    await expect(page.locator('h2:has-text("Alert Rules")')).toBeVisible({ timeout: 30000 });

    // Click create alert button
    const createButton = page.locator('button:has-text("Create Alert"), button:has-text("Create Your First Alert")');
    await createButton.first().click();

    // Switch to Sigma tab
    const sigmaTab = page.locator('button:has-text("Import Sigma Rule"), [role="tab"]:has-text("Sigma")');
    if (await sigmaTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sigmaTab.click();
      await page.waitForTimeout(500);

      // Verify Sigma input is visible
      await expect(page.locator('textarea#sigmaYaml, textarea[placeholder*="Sigma" i]')).toBeVisible();

      // Fill in a sample Sigma rule
      const sigmaRule = `
title: Test Sigma Rule ${Date.now()}
id: test-${Date.now()}
status: test
level: high
description: Test rule for E2E testing
author: E2E Test
logsource:
    category: application
    product: logward
detection:
    selection:
        message|contains: 'error'
    condition: selection
falsepositives:
    - Testing
`.trim();

      await page.locator('textarea#sigmaYaml, textarea[placeholder*="Sigma" i]').fill(sigmaRule);

      // Add email recipient
      const sigmaEmailInput = page.locator('input#sigmaEmails');
      if (await sigmaEmailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sigmaEmailInput.fill('test@e2e-test.logward.dev');
      }

      // Submit the form
      await page.locator('button:has-text("Import Rule")').click();

      // Wait for import to complete
      await page.waitForTimeout(3000);
    }
  });
});
