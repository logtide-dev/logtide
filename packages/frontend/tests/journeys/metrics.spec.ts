import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL, TEST_API_URL } from '../fixtures/auth';

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

    // Ingest fixed values so the UI can be checked against them
    const now = Date.now();
    const metricsData = [];
    for (let i = 0; i < 10; i++) {
      metricsData.push({
        name: 'http.server.request.duration',
        type: 'gauge' as const,
        value: 120,
        service: 'api-gateway',
        time: new Date(now - i * 60000).toISOString(),
      });
      metricsData.push({
        name: 'process.cpu.utilization',
        type: 'gauge' as const,
        value: 0.25,
        service: 'api-gateway',
        time: new Date(now - i * 60000).toISOString(),
      });
    }

    await apiClient.ingestOtlpMetrics(apiKey, metricsData);

    // Metrics are stored asynchronously: wait until the API lists them
    await expect
      .poll(
        async () => {
          const res = await fetch(`${TEST_API_URL}/api/v1/metrics/names?projectId=${projectId}`, {
            headers: { Authorization: `Bearer ${userToken}` },
          });
          const body = await res.json();
          return (body.names ?? []).map((n: { name: string }) => n.name).sort();
        },
        { timeout: 20000 }
      )
      .toEqual(['http.server.request.duration', 'process.cpu.utilization']);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics?project=${projectId}`);
    await expect(page.getByRole('heading', { name: 'Metrics', level: 1 })).toBeVisible();
  });

  test('overview lists the seeded metrics of the service with their latest value', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'api-gateway' })).toBeVisible({ timeout: 20000 });

    const duration = page.getByRole('button', { name: /http\.server\.request\.duration/ });
    await expect(duration).toBeVisible();
    await expect(duration).toContainText('120');
    await expect(duration).toContainText('gauge');

    const cpu = page.getByRole('button', { name: /process\.cpu\.utilization/ });
    await expect(cpu).toBeVisible();
    await expect(cpu).toContainText('0.25');
  });

  test('clicking an overview card opens the explorer on that metric with its data points', async ({ page }) => {
    await page.getByRole('button', { name: /http\.server\.request\.duration/ }).click();

    await expect(page.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/tab=explorer/);
    await expect(page).toHaveURL(/metric=http\.server\.request\.duration/);
    await expect(page.getByRole('combobox', { name: 'Metric' })).toHaveValue('http.server.request.duration');
    await expect(page.getByRole('img', { name: 'Metric chart' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('10 data points')).toBeVisible({ timeout: 20000 });

    // Every seeded point has the fixed value 120 and belongs to the seeded service
    const rows = page.getByRole('row').filter({ hasText: 'api-gateway' });
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('120');
  });

  test('explorer asks to pick a metric and then plots the chosen one', async ({ page }) => {
    await page.getByRole('tab', { name: 'Explorer' }).click();
    await expect(page.getByText('Select a metric to visualize')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Metric chart' })).toHaveCount(0);

    const metric = page.getByRole('combobox', { name: 'Metric' });
    await metric.click();
    await page.getByRole('option', { name: /process\.cpu\.utilization/ }).click();

    await expect(metric).toHaveValue('process.cpu.utilization');
    await expect(page.getByText('Select a metric to visualize')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Metric chart' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('10 data points')).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(/metric=process\.cpu\.utilization/);
  });

  test('golden signals draw the panels the seeded metrics can feed and hint at the missing ones', async ({ page }) => {
    await page.getByRole('tab', { name: 'Golden signals' }).click();
    await expect(page).toHaveURL(/tab=golden/);

    for (const title of ['Request rate', 'Error rate', 'Latency', 'Saturation']) {
      await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });
    }
    // No 5xx attribute was sent: only the error rate panel has nothing to draw
    await expect(
      page.getByText('Send http.server.error.count or http.server.request.duration with status_code attributes')
    ).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Send http.server.request.duration or http.server.request.count to populate')).toHaveCount(0);
    await expect(page.getByText('Send http.server.request.duration to populate this panel')).toHaveCount(0);
    await expect(page.getByText('Send process.cpu.utilization')).toHaveCount(0);
    await expect(page.getByText('No metrics found')).toHaveCount(0);
  });

  test('changing the time range reloads the metrics for that window', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'api-gateway' })).toBeVisible({ timeout: 20000 });

    const request = page.waitForRequest((req) => {
      if (!req.url().includes('/metrics/overview')) return false;
      const url = new URL(req.url());
      const span = Date.parse(url.searchParams.get('to')!) - Date.parse(url.searchParams.get('from')!);
      return Math.abs(span - 3600_000) < 60_000;
    });
    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Last hour', exact: true }).click();
    await request;

    await expect(page.getByRole('button', { name: 'Last hour', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/range=1h/);
    // The seeded points are minutes old, so they are still inside the hour
    await expect(page.getByRole('button', { name: /http\.server\.request\.duration/ })).toBeVisible();
  });

  test('metric and range survive switching tabs', async ({ page }) => {
    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Last hour', exact: true }).click();

    await page.getByRole('tab', { name: 'Explorer' }).click();
    const metric = page.getByRole('combobox', { name: 'Metric' });
    await metric.click();
    await page.getByRole('option', { name: /http\.server\.request\.duration/ }).click();
    await expect(page.getByText('10 data points')).toBeVisible({ timeout: 20000 });

    await page.getByRole('tab', { name: 'Golden signals' }).click();
    await expect(page.getByText('Request rate', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('tab', { name: 'Explorer' }).click();

    await expect(metric).toHaveValue('http.server.request.duration');
    await expect(page.getByRole('button', { name: 'Last hour', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/range=1h/);
    await expect(page.getByText('10 data points')).toBeVisible({ timeout: 20000 });
  });
});
