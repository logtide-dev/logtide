import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL, TEST_API_URL } from '../fixtures/auth';

const METRIC = 'system.cpu.utilization';
const HOSTS = ['vps-app', 'db-01'];

test.describe('Metrics Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let organizationId: string;

  test.beforeAll(async () => {
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Metrics'), email, 'tidal-Orbit-Granite-57');
    userToken = token;
    apiClient = new TestApiClient(token);

    const orgResult = await apiClient.createOrganization(`Metrics Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    const projectResult = await apiClient.createProject(organizationId, `Metrics Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    const apiKeyResult = await apiClient.createApiKey(projectId, 'Metrics Test Key');
    const apiKey = apiKeyResult.apiKey;

    // Two hosts report the same metric: the explorer must tell them apart.
    // The shared fixture only sets service.name, so the OTLP body is built here.
    const now = Date.now();
    const resourceMetrics = HOSTS.map((host, hostIndex) => ({
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'node-agent' } },
          { key: 'host.name', value: { stringValue: host } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: 'e2e-test' },
          metrics: [
            {
              name: METRIC,
              unit: '1',
              gauge: {
                dataPoints: Array.from({ length: 10 }, (_, i) => ({
                  asDouble: hostIndex === 0 ? 0.7 : 0.2,
                  timeUnixNano: String((now - i * 60000) * 1_000_000),
                  attributes: [],
                })),
              },
            },
          ],
        },
      ],
    }));
    const res = await fetch(`${TEST_API_URL}/v1/otlp/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ resourceMetrics }),
    });
    expect(res.ok).toBe(true);

    // Metrics are stored asynchronously: wait until the catalog lists them
    await expect
      .poll(
        async () => {
          const r = await fetch(`${TEST_API_URL}/api/v1/metrics/catalog?organizationId=${organizationId}`, {
            headers: { Authorization: `Bearer ${userToken}` },
          });
          const body = await r.json();
          return (body.metrics ?? []).map((m: { name: string }) => m.name);
        },
        { timeout: 20000 }
      )
      .toContain(METRIC);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);
  });

  test('explore: pick a metric, group by host and see one chart per host', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics/explore?project=${projectId}`);
    await expect(page.getByRole('heading', { name: 'Metrics', level: 1 })).toBeVisible();
    await expect(page.getByText('Pick a metric to start')).toBeVisible();

    const metric = page.getByRole('combobox', { name: 'Metric A' });
    await metric.click();
    await page.getByRole('option', { name: new RegExp(METRIC.replace(/\./g, '\\.')) }).click();
    await expect(metric).toHaveValue(METRIC);
    await expect(page).toHaveURL(/[?&]q=/);

    // Not grouped yet: the breakdown suggestions offer the host attribute
    const suggestions = page.getByRole('region', { name: 'Breakdown suggestions' });
    await expect(suggestions).toBeVisible({ timeout: 20000 });
    await suggestions.getByRole('button', { name: /resource\.host\.name/ }).click();

    // Grouping by a source attribute defaults to the split view: one card per host
    await expect(page.getByTestId('split-card')).toHaveCount(2, { timeout: 20000 });
    for (const host of HOSTS) {
      await expect(page.getByTestId('split-card').filter({ hasText: host })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Breakdown suggestions' })).toHaveCount(0);

    // The display toggle switches to one chart with a legend
    await page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Lines' }).click();
    await expect(page.getByTestId('split-card')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Series legend' })).toBeVisible();
  });

  test('explore: a shared link restores the query', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics/explore?project=${projectId}`);
    const metric = page.getByRole('combobox', { name: 'Metric A' });
    await metric.click();
    await page.getByRole('option', { name: new RegExp(METRIC.replace(/\./g, '\\.')) }).click();
    await expect(page).toHaveURL(/[?&]q=/);

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Metric A' })).toHaveValue(METRIC);
  });

  test('catalog: lists the metric and opens it in Explore', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics/catalog?project=${projectId}`);
    await expect(page.getByRole('button', { name: METRIC })).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: METRIC }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('host.name')).toBeVisible({ timeout: 20000 });
    await drawer.getByRole('link', { name: 'Open in Explore' }).click();

    await expect(page).toHaveURL(/\/dashboard\/metrics\/explore\?.*q=/);
    await expect(page.getByRole('combobox', { name: 'Metric A' })).toHaveValue(METRIC);
  });
});
