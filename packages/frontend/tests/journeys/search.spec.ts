import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createTestLog, createTestLogs, createTracedLogs, createLogsWithLevels, generateId, generateUUID } from '../helpers/factories';

// Value of a datetime-local input for an instant, in the browser (= this machine) time zone
function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('Search Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let apiKey: string;
  let organizationId: string;
  const testTraceId = generateUUID();
  const probeId = generateId();
  const detailMessage = `Detail probe ${probeId}`;
  const ctxBefore = `Context before ${probeId}`;
  const ctxTarget = `Context target ${probeId}`;
  const ctxAfter = `Context after ${probeId}`;

  test.beforeAll(async () => {
    // Create test user and setup
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Search'), email, 'tidal-Orbit-Granite-57');
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
      createTestLog({ service: 'detail-svc', level: 'warn', message: detailMessage, metadata: { probe_key: probeId } }),
      createTestLog({ service: 'context-svc', level: 'info', message: ctxBefore, time: new Date(Date.now() - 3 * 60_000).toISOString() }),
      createTestLog({ service: 'context-svc', level: 'info', message: ctxTarget, time: new Date(Date.now() - 2 * 60_000).toISOString() }),
      createTestLog({ service: 'context-svc', level: 'info', message: ctxAfter, time: new Date(Date.now() - 1 * 60_000).toISOString() }),
    ];

    await apiClient.ingestLogs(apiKey, logs);

    // Wait until the API returns everything that was ingested
    await expect
      .poll(async () => (await apiClient.getLogs(projectId, { limit: '100' })).logs.length, { timeout: 20000 })
      .toBe(logs.length);
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
    // RequireOrganization shows content only when the organization is ready
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30000 });
  });

  test('1. User can view the search page with logs', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);

    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Log query' })).toBeVisible();

    // Seeded logs are listed in the results table
    await expect(page.getByRole('region', { name: 'Results' }).getByRole('table')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Filter by service api-gateway' }).first()).toBeVisible({ timeout: 20000 });
  });

  test('2. User can filter logs by search query', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('row').nth(1)).toBeVisible({ timeout: 20000 });

    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill('Connection timeout error');
    await query.press('Enter');

    await expect(results.getByText('Connection timeout error')).toHaveCount(3, { timeout: 15000 });
    await expect(results.getByText('Payment retry warning')).toHaveCount(0);
    await expect(page).toHaveURL(/q=Connection/);
  });

  test('3. User can filter logs by level', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);

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

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('button', { name: 'Filter by service user-service' }).first()).toBeVisible({ timeout: 20000 });

    await page.getByRole('complementary', { name: 'Facets' }).getByRole('button', { name: /^service api-gateway \(/ }).click();

    await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue('service:api-gateway');
    await expect(results.getByRole('button', { name: 'Filter by service api-gateway' }).first()).toBeVisible({ timeout: 15000 });
    await expect(results.getByRole('button', { name: 'Filter by service user-service' })).toHaveCount(0);
  });

  test('5. User can filter logs by trace ID', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);

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
    // The results table renders only the rows near the viewport, and the seeded
    // logs share a timestamp: filter so the probe row is always rendered.
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?q=${encodeURIComponent('service:detail-svc')}`);

    const results = page.getByRole('region', { name: 'Results' });
    const row = results.getByRole('row').filter({ hasText: detailMessage });
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();

    const details = page.getByRole('complementary', { name: 'Log details' });
    await expect(details).toBeVisible({ timeout: 15000 });
    await expect(details.getByRole('heading', { name: 'Message' })).toBeVisible();
    await expect(details.getByText(detailMessage, { exact: true })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Filter by service detail-svc' })).toBeVisible();
    await expect(details.getByText(probeId).first()).toBeVisible();
    await expect(page).toHaveURL(/logId=/);

    // The panel is part of the URL: a reload keeps it open on the same log
    await page.reload();
    await expect(
      page.getByRole('complementary', { name: 'Log details' }).getByText(detailMessage, { exact: true })
    ).toBeVisible({ timeout: 20000 });
  });

  test('7. User can view log context', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?q=${encodeURIComponent('service:context-svc')}`);

    const results = page.getByRole('region', { name: 'Results' });
    const row = results.getByRole('row').filter({ hasText: ctxTarget });
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();
    await page.getByRole('button', { name: 'View context' }).click();

    const dialog = page.getByRole('dialog', { name: 'Log context' });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole('region', { name: 'Selected log' }).getByText(ctxTarget)).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText(ctxBefore)).toBeVisible();
    await expect(dialog.getByText(ctxAfter)).toBeVisible();
  });

  test('8. User can change time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);

    // The ScopeBar time range picker offers every preset
    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Last hour', exact: true }).click();

    // The picker shows the new range and the URL carries it
    await expect(page.getByRole('button', { name: 'Last hour', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/range=1h/);
  });

  test('9. User can use custom time range', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?q=${encodeURIComponent('service:payment-service')}`);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText('Payment retry warning')).toHaveCount(2, { timeout: 20000 });

    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Custom range' }).click();
    const from = page.getByRole('textbox', { name: 'From' });
    const to = page.getByRole('textbox', { name: 'To' });

    // A window in the past holds none of the seeded logs
    await from.fill(localInput(Date.now() - 3 * 86_400_000));
    await to.fill(localInput(Date.now() - 2 * 86_400_000));
    await expect(page).toHaveURL(/from=/);
    await expect(page.getByText('No logs match in')).toBeVisible({ timeout: 15000 });
    await expect(results.getByText('Payment retry warning')).toHaveCount(0);

    // A window around the ingest time brings them back
    await to.fill(localInput(Date.now() + 3_600_000));
    await from.fill(localInput(Date.now() - 2 * 3_600_000));
    await expect(results.getByText('Payment retry warning')).toHaveCount(2, { timeout: 15000 });
    await expect(page.getByText('No logs match in')).toHaveCount(0);
  });

  test('10. User can export logs', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?q=${encodeURIComponent('service:payment-service')}`);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText('Payment retry warning')).toHaveCount(2, { timeout: 20000 });

    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export logs' });
    await expect(dialog.getByRole('button', { name: 'Export 2 logs' })).toBeVisible();

    const jsonDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export 2 logs' }).click();
    const jsonText = await streamToString(await (await jsonDownload).createReadStream());
    const exported = JSON.parse(jsonText) as { message: string; service: string }[];
    expect(exported).toHaveLength(2);
    expect(exported.every((l) => l.message === 'Payment retry warning' && l.service === 'payment-service')).toBe(true);

    // CSV: header plus one line per log
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.getByRole('button', { name: 'CSV' }).click();
    const csvDownload = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export 2 logs' }).click();
    const download = await csvDownload;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const csv = (await streamToString(await download.createReadStream())).split('\n');
    expect(csv[0]).toContain('Message');
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain('Payment retry warning');
  });

  test('12. User can click on service badge to filter', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);

    const results = page.getByRole('region', { name: 'Results' });
    await results.getByRole('button', { name: 'Filter by service payment-service' }).first().click();

    await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue('service:payment-service');
    await expect(results.getByRole('button', { name: 'Filter by service api-gateway' })).toHaveCount(0);
  });
});
