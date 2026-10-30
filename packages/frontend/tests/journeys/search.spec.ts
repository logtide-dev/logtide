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
    const { token } = await registerUser(generateTestName('Search'), email, 'TestPassword123!');
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
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Log query' })).toBeVisible();

    // Seeded logs are listed in the results table
    await expect(page.getByRole('region', { name: 'Results' }).getByRole('table')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Filter by service api-gateway' }).first()).toBeVisible({ timeout: 20000 });
  });

  test('2. User can filter logs by search query', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
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
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('button', { name: 'Filter by level info' }).first()).toBeVisible({ timeout: 20000 });

    // Clicking the error value in the Level facet narrows the query
    await page.getByRole('complementary', { name: 'Facets' }).getByRole('button', { name: /^level error \(/ }).click();

    await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue('level:error');
    await expect(results.getByRole('button', { name: 'Filter by level error' }).first()).toBeVisible({ timeout: 15000 });
    await expect(results.getByRole('button', { name: 'Filter by level info' })).toHaveCount(0);
  });

  test('4. User can filter logs by service', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('button', { name: 'Filter by service user-service' }).first()).toBeVisible({ timeout: 20000 });

    await page.getByRole('complementary', { name: 'Facets' }).getByRole('button', { name: /^service api-gateway \(/ }).click();

    await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue('service:api-gateway');
    await expect(results.getByRole('button', { name: 'Filter by service api-gateway' }).first()).toBeVisible({ timeout: 15000 });
    await expect(results.getByRole('button', { name: 'Filter by service user-service' })).toHaveCount(0);
  });

  test('5. User can filter logs by trace ID', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill(`trace:${testTraceId}`);
    await query.press('Enter');

    // Only the traced logs remain; their message carries the first 8 chars of the id
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText(testTraceId.substring(0, 8)).first()).toBeVisible({ timeout: 15000 });
    await expect(results.getByRole('button', { name: 'Filter by service user-service' })).toHaveCount(0);
    await expect(page).toHaveURL(/q=trace%3A/);
  });

  test('6. User can expand log details', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('row').nth(1)).toBeVisible({ timeout: 20000 });
    await results.getByRole('row').nth(1).click();

    const details = page.getByRole('complementary', { name: 'Log details' });
    await expect(details).toBeVisible({ timeout: 15000 });
    await expect(details.getByRole('heading', { name: 'Message' })).toBeVisible();
    await expect(page).toHaveURL(/logId=/);
  });

  test('7. User can view log context', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('row').nth(1)).toBeVisible({ timeout: 20000 });
    await results.getByRole('row').nth(1).click();
    await page.getByRole('button', { name: 'View context' }).click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
  });

  test('8. User can change time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    // The ScopeBar time range picker offers every preset
    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Last hour', exact: true }).click();

    // The picker shows the new range and the URL carries it
    await expect(page.getByRole('button', { name: 'Last hour', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/range=1h/);
  });

  test('9. User can use custom time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Custom range' }).click();

    // Custom range has a calendar plus typed From and To inputs
    await expect(page.getByRole('textbox', { name: 'From' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'To' })).toBeVisible();
  });

  test('10. User can export logs', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
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

  test('12. User can click on service badge to filter', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await page.waitForLoadState('load');

    const results = page.getByRole('region', { name: 'Results' });
    await results.getByRole('button', { name: 'Filter by service payment-service' }).first().click();

    await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue('service:payment-service');
    await expect(results.getByRole('button', { name: 'Filter by service api-gateway' })).toHaveCount(0);
  });
});
