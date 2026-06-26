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
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces`);
    await page.waitForLoadState('load');

    await expect(page.locator('h1')).toContainText(/distributed traces/i);

    // Trace A row: root service, operation, span count and status
    const checkoutRow = page.locator('table tbody tr', { hasText: 'POST /checkout' });
    await expect(checkoutRow).toBeVisible({ timeout: 15000 });
    await expect(checkoutRow).toContainText('checkout-service');
    // Columns: Time | Service | Operation | Duration | Spans | Status | Actions
    await expect(checkoutRow.locator('td').nth(4)).toHaveText('3');
    await expect(checkoutRow).toContainText('OK');

    // Trace B row is also listed
    const inventoryRow = page.locator('table tbody tr', { hasText: 'GET /stock' });
    await expect(inventoryRow).toBeVisible();
    await expect(inventoryRow).toContainText('inventory-service');
  });

  test('2. Service and status filters narrow the list, clearing restores it', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces`);
    await page.waitForLoadState('load');

    const checkoutRow = page.locator('table tbody tr', { hasText: 'POST /checkout' });
    const inventoryRow = page.locator('table tbody tr', { hasText: 'GET /stock' });
    await expect(checkoutRow).toBeVisible({ timeout: 15000 });
    await expect(inventoryRow).toBeVisible();

    // Filter by root service of trace A
    await page.locator('button:has-text("All services")').first().click();
    const serviceCheckbox = page.locator('label:has-text("checkout-service") input[type="checkbox"]');
    await serviceCheckbox.waitFor({ state: 'visible' });
    await serviceCheckbox.check();
    // Close popover
    await page.locator('body').click({ position: { x: 0, y: 0 } });
    await page.waitForTimeout(1500);

    await expect(checkoutRow).toBeVisible();
    await expect(inventoryRow).toHaveCount(0);

    // Error-only filter on non-error traces empties the list
    await page.locator('button:has-text("All statuses")').first().click();
    const errorsRadio = page.locator('label:has-text("Errors only") input[type="radio"]');
    await errorsRadio.waitFor({ state: 'visible' });
    await errorsRadio.check();
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    await expect(page.getByText('No traces match the current filters.')).toBeVisible({ timeout: 15000 });

    // Clearing the filters restores both traces
    await page.locator('button:has-text("Clear filters")').click();
    await expect(checkoutRow).toBeVisible({ timeout: 15000 });
    await expect(inventoryRow).toBeVisible();
  });

  test('3. Trace detail renders the waterfall and expand/collapse toggles child rows', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces/${checkoutTraceId}?projectId=${projectId}`);
    await page.waitForLoadState('load');

    await expect(page.locator('h1')).toContainText(/trace details/i);
    await expect(page.getByText('Trace Timeline')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('3 spans across 2 services')).toBeVisible();

    // All spans expanded by default
    const chargeRow = page.locator('div[role="button"]', { hasText: 'charge-card' });
    const dbRow = page.locator('div[role="button"]', { hasText: 'db-query' });
    await expect(page.locator('div[role="button"]', { hasText: 'POST /checkout' })).toBeVisible();
    await expect(chargeRow).toBeVisible();
    await expect(dbRow).toBeVisible();

    // Collapse the charge-card subtree: its child db-query disappears
    await chargeRow.locator('button').click();
    await expect(dbRow).toHaveCount(0);
    await expect(chargeRow).toBeVisible();

    // Expand again: child row comes back
    await chargeRow.locator('button').click();
    await expect(dbRow).toBeVisible();
  });

  test('4. Clicking a span opens the detail panel with kind, status, duration and attributes', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces/${checkoutTraceId}?projectId=${projectId}`);
    await page.waitForLoadState('load');

    const chargeRow = page.locator('div[role="button"]', { hasText: 'charge-card' });
    await expect(chargeRow).toBeVisible({ timeout: 15000 });
    await chargeRow.click();

    await expect(page.getByText('Span Details')).toBeVisible();
    await expect(page.getByText('payment-service - charge-card')).toBeVisible();

    // Span id, kind, status and duration
    await expect(page.getByText(chargeSpanId).first()).toBeVisible();
    await expect(page.getByText('Client', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
    // Duration field shows a formatted duration (exact ms can be off by one
    // due to ns timestamp precision, so match the format instead)
    const durationHeading = page.getByRole('heading', { name: 'Duration', exact: true });
    await expect(durationHeading).toBeVisible();
    await expect(durationHeading.locator('xpath=following-sibling::p')).toHaveText(/^\d+(\.\d+)?(ms|s|m)$/);

    // Attributes section shows the seeded span attributes
    await expect(page.getByText('Attributes', { exact: true })).toBeVisible();
    const attributesPre = page.locator('pre', { hasText: 'http.method' });
    await expect(attributesPre).toBeVisible();
    await expect(attributesPre).toContainText('payment.provider');
  });

  test('5. "View Logs for this Trace" lands on search filtered by the trace id', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/traces/${checkoutTraceId}?projectId=${projectId}`);
    await page.waitForLoadState('load');

    const chargeRow = page.locator('div[role="button"]', { hasText: 'charge-card' });
    await expect(chargeRow).toBeVisible({ timeout: 15000 });
    await chargeRow.click();
    await expect(page.getByText('Span Details')).toBeVisible();

    await page.locator('button:has-text("View Logs for this Trace")').click();
    await page.waitForURL(/\/dashboard\/search\?.*traceId=/);
    await page.waitForTimeout(2500);

    // The seeded correlated logs are shown
    const logsTable = page.locator('table.caption-bottom');
    await expect(logsTable).toBeVisible({ timeout: 15000 });
    const pageContent = await page.content();
    expect(pageContent).toContain(checkoutTraceId.substring(0, 8));
    expect(pageContent.toLowerCase()).toContain('traced log');
  });

  test('6. A log\'s trace id link navigates back to the trace detail', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search?traceId=${checkoutTraceId}&project=${projectId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);

    // Expand the first log's details
    const detailsButton = page.locator('button:has-text("Details")').first();
    await expect(detailsButton).toBeVisible({ timeout: 15000 });
    await detailsButton.click();

    // Follow the trace link (the trace id renders as a link to the trace timeline)
    const viewTraceLink = page.locator(`a[href*="/dashboard/traces/${checkoutTraceId}"]`).first();
    await expect(viewTraceLink).toBeVisible();
    await viewTraceLink.click();

    await page.waitForURL(new RegExp(`/dashboard/traces/${checkoutTraceId}`));
    await expect(page.locator('h1')).toContainText(/trace details/i);
    await expect(page.getByText(checkoutTraceId).first()).toBeVisible();
    await expect(page.getByText('Trace Timeline')).toBeVisible({ timeout: 15000 });
  });
});
