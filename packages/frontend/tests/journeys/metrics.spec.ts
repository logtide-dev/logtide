import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { wait } from '../helpers/factories';

test.describe('Metrics Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let apiKey: string;
  let organizationId: string;

  test.beforeAll(async () => {
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Metrics'), email, 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    const orgResult = await apiClient.createOrganization(`Metrics Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    const projectResult = await apiClient.createProject(organizationId, `Metrics Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    const apiKeyResult = await apiClient.createApiKey(projectId, 'Metrics Test Key');
    apiKey = apiKeyResult.apiKey;

    // Ingest some test metrics
    const now = Date.now();
    const metricsData = [];
    for (let i = 0; i < 10; i++) {
      metricsData.push({
        name: 'http.server.request.duration',
        type: 'gauge' as const,
        value: Math.random() * 100 + 10,
        service: 'api-gateway',
        time: new Date(now - i * 60000).toISOString(),
      });
      metricsData.push({
        name: 'process.cpu.utilization',
        type: 'gauge' as const,
        value: Math.random() * 0.8,
        service: 'api-gateway',
        time: new Date(now - i * 60000).toISOString(),
      });
    }

    await apiClient.ingestOtlpMetrics(apiKey, metricsData);
    await wait(2000);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await page.waitForLoadState('load');
  });

  test('should navigate to metrics page', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await expect(page.locator('h1')).toContainText('Metrics');
  });

  test('should show overview tab with metrics', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await page.waitForLoadState('load');
    const overviewTab = page.locator('button', { hasText: 'Overview' });
    await expect(overviewTab).toBeVisible();
  });

  test('should switch to explorer tab and show filters', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await page.waitForLoadState('load');
    const explorerTab = page.locator('button', { hasText: 'Explorer' });
    await explorerTab.click();
    await expect(page.locator('text=Filters')).toBeVisible();
  });

  test('should switch to golden signals tab', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await page.waitForLoadState('load');
    const goldenTab = page.locator('button', { hasText: 'Golden Signals' });
    await goldenTab.click();
    await expect(page.locator('text=Request rate')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Latency')).toBeVisible();
    await expect(page.locator('text=Saturation')).toBeVisible();
  });

  test('should switch time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await page.waitForLoadState('load');
    const oneHourBtn = page.locator('button', { hasText: '1h' });
    if (await oneHourBtn.isVisible()) {
      await oneHourBtn.click();
    }
  });

  test('should preserve state when switching tabs', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await page.waitForLoadState('load');
    const goldenTab = page.locator('button', { hasText: 'Golden Signals' });
    await goldenTab.click();
    await expect(page.locator('text=Request rate')).toBeVisible({ timeout: 10000 });
    const overviewTab = page.locator('button', { hasText: 'Overview' });
    await overviewTab.click();
    await goldenTab.click();
    await expect(page.locator('text=Request rate')).toBeVisible({ timeout: 10000 });
  });
});
