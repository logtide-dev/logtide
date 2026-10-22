import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL, TEST_API_URL } from './fixtures/auth';
import { createTracedLogs, wait } from './helpers/factories';

/**
 * Generate a random lowercase hex string (OTLP trace/span ids).
 */
function randomHex(length: number): string {
  let s = '';
  while (s.length < length) {
    s += Math.random().toString(16).slice(2);
  }
  return s.slice(0, length);
}

/**
 * Ingest spans via the OTLP traces endpoint (JSON encoding).
 */
async function ingestOtlpSpans(apiKey: string, resourceSpans: unknown[]) {
  const response = await fetch(`${TEST_API_URL}/v1/otlp/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ resourceSpans }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'OTLP traces ingest failed' }));
    throw new Error(errorData.error || `OTLP traces ingest failed: ${response.status}`);
  }

  return response.json();
}

test.describe('Traces Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let apiKey: string;
  let organizationId: string;

  // Trace A: checkout flow, 3 spans across 2 services, no errors
  const checkoutTraceId = randomHex(32);
  const rootSpanId = randomHex(16);
  const chargeSpanId = randomHex(16);
  const dbSpanId = randomHex(16);

  // Trace B: single-span inventory trace (different root service)
  const inventoryTraceId = randomHex(32);
  const inventorySpanId = randomHex(16);

  test.beforeAll(async () => {
    // Create test user and setup
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Traces'), email, 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    // Create organization
    const orgResult = await apiClient.createOrganization(`Traces Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    // Create project
    const projectResult = await apiClient.createProject(organizationId, `Traces Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    // Create API key
    const apiKeyResult = await apiClient.createApiKey(projectId, 'Traces Test Key');
    apiKey = apiKeyResult.apiKey;

    // Seed spans via OTLP traces endpoint.
    // Times are in unix nanoseconds; trace A spans: root 0-200ms,
    // charge-card 20-150ms (child of root), db-query 30-100ms (child of charge-card).
    const baseNs = Date.now() * 1_000_000;
    const ms = 1_000_000;

    await ingestOtlpSpans(apiKey, [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'checkout-service' } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: checkoutTraceId,
                spanId: rootSpanId,
                name: 'POST /checkout',
                kind: 2, // SERVER
                startTimeUnixNano: String(baseNs),
                endTimeUnixNano: String(baseNs + 200 * ms),
                status: { code: 1 }, // OK
              },
            ],
          },
        ],
      },
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'payment-service' } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: checkoutTraceId,
                spanId: chargeSpanId,
                parentSpanId: rootSpanId,
                name: 'charge-card',
                kind: 3, // CLIENT
                startTimeUnixNano: String(baseNs + 20 * ms),
                endTimeUnixNano: String(baseNs + 150 * ms),
                status: { code: 1 }, // OK
                attributes: [
                  { key: 'http.method', value: { stringValue: 'POST' } },
                  { key: 'payment.provider', value: { stringValue: 'stripe' } },
                ],
              },
              {
                traceId: checkoutTraceId,
                spanId: dbSpanId,
                parentSpanId: chargeSpanId,
                name: 'db-query',
                kind: 1, // INTERNAL
                startTimeUnixNano: String(baseNs + 30 * ms),
                endTimeUnixNano: String(baseNs + 100 * ms),
                status: { code: 1 }, // OK
              },
            ],
          },
        ],
      },
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'inventory-service' } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: inventoryTraceId,
                spanId: inventorySpanId,
                name: 'GET /stock',
                kind: 2, // SERVER
                startTimeUnixNano: String(baseNs),
                endTimeUnixNano: String(baseNs + 50 * ms),
                status: { code: 1 }, // OK
              },
            ],
          },
        ],
      },
    ]);

    // Seed logs correlated with trace A (same trace_id)
    await apiClient.ingestLogs(apiKey, createTracedLogs(checkoutTraceId, 4));

    // Wait for data to be indexed
    await wait(2500);
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
    await page.waitForSelector('nav, [class*="sidebar"], h1, h2', { timeout: 30000 });
    await page.waitForTimeout(500);
  });

  test('1. Trace list shows the seeded trace with root service, span count and status', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces?project=${projectId}`);
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'Traces', level: 1 })).toBeVisible();

    // Trace A row: root service, operation, span count and status
    // Columns: Start | Root service | Operation | Duration | Spans | Status
    const checkoutRow = page.getByRole('row', { name: /checkout-service POST \/checkout 200ms 3 OK/ });
    await expect(checkoutRow).toBeVisible({ timeout: 15000 });
    await expect(checkoutRow.getByRole('cell').nth(4)).toHaveText('3');

    // Trace B row is also listed
    const inventoryRow = page.getByRole('row', { name: /inventory-service GET \/stock 50ms 1 OK/ });
    await expect(inventoryRow).toBeVisible();
  });

  test('2. Service and status filters narrow the list, clearing restores it', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces?project=${projectId}`);
    await page.waitForLoadState('load');

    const checkoutLink = page.getByRole('link', { name: 'POST /checkout' });
    const inventoryLink = page.getByRole('link', { name: 'GET /stock' });
    await expect(checkoutLink).toBeVisible({ timeout: 15000 });
    await expect(inventoryLink).toBeVisible();

    // Filter by root service of trace A
    await page.getByRole('combobox', { name: 'Service' }).selectOption('checkout-service');
    await expect(checkoutLink).toBeVisible();
    await expect(inventoryLink).toHaveCount(0, { timeout: 15000 });

    // Error-only filter on non-error traces empties the list
    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Errors only' });
    await expect(checkoutLink).toHaveCount(0, { timeout: 15000 });
    await expect(inventoryLink).toHaveCount(0);

    // Resetting both filters restores both traces
    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'All statuses' });
    await page.getByRole('combobox', { name: 'Service' }).selectOption({ label: 'All services' });
    await expect(checkoutLink).toBeVisible({ timeout: 15000 });
    await expect(inventoryLink).toBeVisible();
  });

  test('3. Trace detail renders the waterfall and expand/collapse toggles child rows', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces/${checkoutTraceId}?project=${projectId}`);
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: /^Trace / , level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trace timeline' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('3 spans across 2 services')).toBeVisible();

    // All spans expanded by default
    const chargeRow = page.getByRole('button', { name: /payment-service: charge-card/ });
    const dbRow = page.getByRole('button', { name: /payment-service: db-query/ });
    await expect(page.getByRole('button', { name: /checkout-service: POST \/checkout/ })).toBeVisible();
    await expect(chargeRow).toBeVisible();
    await expect(dbRow).toBeVisible();

    // Collapse the charge-card subtree: its child db-query disappears
    await chargeRow.getByRole('button', { name: 'Collapse children' }).click();
    await expect(dbRow).toHaveCount(0);
    await expect(chargeRow).toBeVisible();

    // Expand again: child row comes back
    await chargeRow.getByRole('button', { name: 'Expand children' }).click();
    await expect(dbRow).toBeVisible();
  });

  test('4. Clicking a span opens the detail panel with kind, status, duration and attributes', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces/${checkoutTraceId}?project=${projectId}`);
    await page.waitForLoadState('load');

    const chargeRow = page.getByRole('button', { name: /payment-service: charge-card/ });
    await expect(chargeRow).toBeVisible({ timeout: 15000 });
    await chargeRow.click();

    const panel = page.getByRole('complementary', { name: 'Span details' });
    await expect(panel.getByRole('heading', { name: 'charge-card' })).toBeVisible();
    await expect(panel).toContainText('payment-service');
    // Status and a formatted duration sit in the panel header
    await expect(panel).toContainText(/OK\s+\d+(\.\d+)?(ms|s|m)/);

    // Overview: span id and kind
    await expect(panel.getByText(chargeSpanId)).toBeVisible();
    await expect(panel.getByText('CLIENT', { exact: true })).toBeVisible();

    // Attributes tab shows the seeded span attributes
    await panel.getByRole('tab', { name: 'Attributes' }).click();
    await expect(panel.getByText('http.method')).toBeVisible();
    await expect(panel.getByText('payment.provider')).toBeVisible();
  });

  test('5. "View trace logs" lands on logs filtered by the trace id', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces/${checkoutTraceId}?project=${projectId}`);
    await page.waitForLoadState('load');

    const chargeRow = page.getByRole('button', { name: /payment-service: charge-card/ });
    await expect(chargeRow).toBeVisible({ timeout: 15000 });
    await chargeRow.click();

    await page.getByRole('link', { name: 'View trace logs' }).click();
    await page.waitForURL(/\/dashboard\/logs\?.*q=trace%3A/);

    // The query bar holds the trace clause and the seeded correlated logs are shown
    await expect(page.getByRole('combobox', { name: 'Log query' })).toHaveValue(`trace:${checkoutTraceId}`);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText(checkoutTraceId.substring(0, 8)).first()).toBeVisible({ timeout: 20000 });
    await expect(results.getByText(/traced log/i).first()).toBeVisible();
  });

  test('6. A log\'s trace id link navigates back to the trace detail', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?q=trace%3A${checkoutTraceId}&project=${projectId}`);
    await page.waitForLoadState('load');

    // Open the first log's details panel
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('row').nth(1)).toBeVisible({ timeout: 20000 });
    await results.getByRole('row').nth(1).click();

    // Follow the trace link (the trace id renders as a link to the trace timeline)
    const details = page.getByRole('complementary', { name: 'Log details' });
    const viewTraceLink = details.locator(`a[href*="/dashboard/traces/${checkoutTraceId}"]`).first();
    await expect(viewTraceLink).toBeVisible({ timeout: 15000 });
    await viewTraceLink.click();

    await page.waitForURL(new RegExp(`/dashboard/traces/${checkoutTraceId}`));
    await expect(page.getByRole('heading', { name: /^Trace /, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trace timeline' })).toBeVisible({ timeout: 15000 });
  });
});
