import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL, TEST_API_URL } from '../fixtures/auth';

// Metrics > Sources (1.8): two hosts send OTLP metrics with a host.name
// resource attribute; the Sources list shows both, a click opens the host page
// and its Resources tab draws the template panels.

const HOSTS = [
  { name: 'e2e-host-calm', cpu: 12 },
  { name: 'e2e-host-busy', cpu: 93 },
];

async function sendHostMetrics(apiKey: string, hostName: string, cpu: number) {
  const now = Date.now();
  const point = (value: number, offsetMin: number, attrs: Array<{ key: string; value: { stringValue: string } }> = []) => ({
    asDouble: value,
    timeUnixNano: String((now - offsetMin * 60_000) * 1_000_000),
    attributes: attrs,
  });
  const dataPoints = (value: number, attrs: Array<{ key: string; value: { stringValue: string } }> = []) =>
    Array.from({ length: 10 }, (_, i) => point(value, i, attrs));

  const body = {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'host.name', value: { stringValue: hostName } },
            { key: 'service.name', value: { stringValue: 'e2e-agent' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'e2e-test' },
            metrics: [
              { name: 'system.cpu.utilization.total', unit: '%', gauge: { dataPoints: dataPoints(cpu) } },
              {
                name: 'system.cpu.utilization',
                unit: '%',
                gauge: { dataPoints: dataPoints(cpu, [{ key: 'system.cpu.state', value: { stringValue: 'user' } }]) },
              },
              { name: 'system.memory.utilization', unit: '%', gauge: { dataPoints: dataPoints(40) } },
              { name: 'system.filesystem.utilization', unit: '%', gauge: { dataPoints: dataPoints(55) } },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch(`${TEST_API_URL}/v1/otlp/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Metrics ingest failed: ${res.status}`);
}

test.describe('Metrics sources journey', () => {
  let userToken: string;
  let organizationId: string;
  let projectId: string;

  test.beforeAll(async () => {
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Sources'), email, 'tidal-Orbit-Granite-57');
    userToken = token;
    const apiClient = new TestApiClient(token);

    const orgResult = await apiClient.createOrganization(`Sources Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;
    const projectResult = await apiClient.createProject(organizationId, `Sources Test Project ${Date.now()}`);
    projectId = projectResult.project.id;
    const keyResult = await apiClient.createApiKey(projectId, 'Sources Test Key');

    for (const h of HOSTS) await sendHostMetrics(keyResult.apiKey, h.name, h.cpu);

    // Metrics are stored asynchronously: wait until the sources endpoint lists both hosts
    await expect
      .poll(
        async () => {
          const from = new Date(Date.now() - 60 * 60_000).toISOString();
          const res = await fetch(
            `${TEST_API_URL}/api/v1/metrics/sources?organizationId=${organizationId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date().toISOString())}`,
            { headers: { Authorization: `Bearer ${userToken}` } },
          );
          if (!res.ok) return [];
          const body = await res.json();
          return (body.hosts ?? []).map((h: { name: string }) => h.name).sort();
        },
        { timeout: 30000 },
      )
      .toEqual(HOSTS.map((h) => h.name).sort());
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);
  });

  test('lists both hosts, worst first, and opens a host with its Resources charts', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics`);
    await expect(page.getByRole('heading', { name: 'Metrics', level: 1 })).toBeVisible();

    const hostsSection = page.getByTestId('hosts-section');
    await expect(hostsSection).toBeVisible({ timeout: 30000 });
    await expect(hostsSection.getByRole('link', { name: 'e2e-host-calm' })).toBeVisible();
    await expect(hostsSection.getByRole('link', { name: 'e2e-host-busy' })).toBeVisible();

    // The busy host (CPU 93%) is not healthy, so it comes before the calm one
    const order = await hostsSection.getByRole('link').allTextContents();
    expect(order.indexOf('e2e-host-busy')).toBeLessThan(order.indexOf('e2e-host-calm'));

    // The kind filter lives in the URL
    await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: /Hosts/ }).click();
    await expect(page).toHaveURL(/kind=host/);

    await hostsSection.getByRole('link', { name: 'e2e-host-busy' }).click();
    await expect(page).toHaveURL(/\/dashboard\/metrics\/hosts\/e2e-host-busy/);
    await expect(page.getByRole('heading', { name: 'e2e-host-busy', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');

    // KPI row and the template panels the host can fill
    await expect(page.getByTestId('kpi-cpu')).toContainText('93', { timeout: 30000 });
    await expect(page.getByTestId('template-panel-cpu-state')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('template-panel-cpu-state').locator('canvas, svg').first()).toBeVisible({ timeout: 30000 });
  });

  test('the Metrics tab lists every metric the host sends', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/metrics/hosts/e2e-host-calm?tab=metrics`);
    await expect(page.getByTestId('metrics-grid')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('metric-card').filter({ hasText: 'system.cpu.utilization.total' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open system.cpu.utilization.total in Explore' })).toBeVisible();
  });

  test('Hardware is its own page and lights up in the sidebar', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/hardware`);
    await expect(page).toHaveURL(/\/dashboard\/hardware$/);
    await expect(page.getByRole('heading', { name: 'Hardware', level: 1 })).toBeVisible();
    await expect(page.locator('[data-nav-item="hardware"][aria-current="page"]').first()).toBeVisible();
  });
});
