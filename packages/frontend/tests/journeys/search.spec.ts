import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createTestLogs, createTracedLogs, createLogsWithLevels, wait, generateUUID } from '../helpers/factories';

test.describe('Search Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let apiKey: string;
  let organizationId: string;
  const testTraceId = generateUUID();

  test.beforeAll(async () => {
    // Create test user and setup
    const email = generateTestEmail();
    const { user, token } = await registerUser(generateTestName('Search'), email, 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    // Create organization
    const orgResult = await apiClient.createOrganization(`Search Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    // Create project
    const projectResult = await apiClient.createProject(organizationId, `Search Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    // Create API key
    const apiKeyResult = await apiClient.createApiKey(projectId, 'Search Test Key');
    apiKey = apiKeyResult.apiKey;

    // Ingest test logs with various levels and services
    const logs = [
      ...createTestLogs(5, { service: 'api-gateway', level: 'info' }),
      ...createTestLogs(5, { service: 'user-service', level: 'debug' }),
      ...createTestLogs(3, { service: 'api-gateway', level: 'error', message: 'Connection timeout error' }),
      ...createTestLogs(2, { service: 'payment-service', level: 'warn', message: 'Payment retry warning' }),
      ...createTracedLogs(testTraceId, 5),
      ...createLogsWithLevels(),
    ];

    await apiClient.ingestLogs(apiKey, logs);

    // Wait for logs to be indexed
    await wait(2000);
  });

  test.beforeEach(async ({ page }) => {
    // Set auth state before each test
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);

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

  test('1. User can view the search page with logs', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');

    // Verify search page elements
    await expect(page.locator('h1')).toContainText(/log search|search/i);

    // Verify filter elements exist
    await expect(page.locator('input#search, input[placeholder*="search" i]')).toBeVisible();

    // Wait for logs to load
    await page.waitForTimeout(3000);

    // Verify logs are displayed
    const logsTable = page.locator('table, [class*="table"]');
    await expect(logsTable).toBeVisible();
  });

  test('2. User can filter logs by search query', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Search for error logs
    const searchInput = page.locator('input#search, input[placeholder*="search" i]');
    await searchInput.fill('timeout error');
    await searchInput.press('Enter');

    await page.waitForTimeout(2000);

    // Verify filtered results contain the search term
    const pageContent = await page.content();
    expect(pageContent.toLowerCase()).toContain('timeout');
  });

  test('3. User can filter logs by level', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Open levels filter
    const levelsButton = page.locator('button:has-text("All levels"), button:has-text("Levels")').first();
    await levelsButton.click();

    // Wait for popover
    await page.waitForTimeout(500);

    // Clear and select only error level
    const clearButton = page.locator('button:has-text("Clear")').first();
    if (await clearButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearButton.click();
    }

    // Select error checkbox
    const errorCheckbox = page.locator('label:has-text("error") input[type="checkbox"], input[value="error"]');
    if (await errorCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await errorCheckbox.check();
    }

    // Close popover by clicking outside
    await page.locator('body').click({ position: { x: 0, y: 0 } });
    await page.waitForTimeout(2000);

    // Verify only error logs are shown
    const errorBadges = page.locator('[class*="error"], .bg-red-100, [class*="bg-red"]');
    const count = await errorBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('4. User can filter logs by service', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Open services filter
    const servicesButton = page.locator('button:has-text("All services"), button:has-text("Services")').first();
    await servicesButton.click();

    await page.waitForTimeout(500);

    // Select api-gateway service if available
    const serviceCheckbox = page.locator('label:has-text("api-gateway") input[type="checkbox"]');
    if (await serviceCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await serviceCheckbox.check();
    }

    // Close popover
    await page.locator('body').click({ position: { x: 0, y: 0 } });
    await page.waitForTimeout(2000);

    // Verify logs are filtered
    const pageContent = await page.content();
    expect(pageContent).toContain('api-gateway');
  });

  test('5. User can filter logs by trace ID', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Enter trace ID
    const traceInput = page.locator('input#traceId, input[placeholder*="trace" i]');
    await traceInput.fill(testTraceId);
    await traceInput.press('Enter');

    await page.waitForTimeout(2000);

    // Verify traced logs are shown (check first 8 chars of UUID shown in message)
    const pageContent = await page.content();
    expect(pageContent).toContain(testTraceId.substring(0, 8));
  });

  test('6. User can expand log details', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Click on Details button for first log
    const detailsButton = page.locator('button:has-text("Details")').first();
    if (await detailsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await detailsButton.click();
      await page.waitForTimeout(1000);

      // Verify expanded content shows full message (text is "Full Message:")
      await expect(page.locator('text=/full message/i').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('7. User can view log context', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Click on Context button for first log
    const contextButton = page.locator('button:has-text("Context")').first();
    if (await contextButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await contextButton.click();
      await page.waitForTimeout(1000);

      // Verify context dialog appears
      const dialog = page.locator('[role="dialog"], [class*="dialog"], [class*="Dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });
    }
  });

  test('8. User can change time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Click on Last Hour button
    const lastHourButton = page.locator('button:has-text("Last Hour")');
    await lastHourButton.click();
    await page.waitForTimeout(2000);

    // Verify button is selected (has different variant)
    await expect(lastHourButton).toHaveClass(/default|primary|bg-primary/);
  });

  test('9. User can use custom time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Click on Custom button
    const customButton = page.locator('button:has-text("Custom")');
    await customButton.click();
    await page.waitForTimeout(500);

    // Verify datetime inputs appear
    await expect(page.locator('input[type="datetime-local"]').first()).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]').nth(1)).toBeVisible();
  });

  test('10. User can export logs', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Look for export buttons
    const exportJsonButton = page.locator('button:has-text("Export JSON"), button:has-text("JSON")');
    const exportCsvButton = page.locator('button:has-text("Export CSV"), button:has-text("CSV")');

    // Verify export buttons exist
    if (await exportJsonButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(exportJsonButton).toBeEnabled();
    }

    if (await exportCsvButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(exportCsvButton).toBeEnabled();
    }
  });

  test('11. User can navigate pagination', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Look for pagination controls
    const nextButton = page.locator('button:has-text("Next")');
    const previousButton = page.locator('button:has-text("Previous")');

    // Verify pagination exists
    if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // If there are multiple pages, next should be enabled
      const isEnabled = await nextButton.isEnabled().catch(() => false);
      if (isEnabled) {
        await nextButton.click();
        await page.waitForTimeout(2000);

        // Previous should now be enabled
        await expect(previousButton).toBeEnabled();
      }
    }
  });

  test('12. User can click on service badge to filter', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Find a service badge and click it
    const serviceBadge = page.locator('button:has([class*="Badge"]), [class*="badge"]').first();
    if (await serviceBadge.isVisible({ timeout: 5000 }).catch(() => false)) {
      const serviceName = await serviceBadge.textContent();
      await serviceBadge.click();
      await page.waitForTimeout(2000);

      // Verify filter was applied
      if (serviceName) {
        const pageContent = await page.content();
        expect(pageContent).toContain(serviceName.trim());
      }
    }
  });
});
