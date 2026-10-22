import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createTestLog, wait } from '../helpers/factories';

/**
 * Logs explorer: the query grammar, facet clicks that edit the query, and the
 * URL as the single source of truth for the search state.
 */
test.describe('Logs query and facets journey', () => {
  let userToken: string;
  let organizationId: string;
  let projectId: string;

  test.beforeAll(async () => {
    const { token } = await registerUser(generateTestName('Facets'), generateTestEmail(), 'TestPassword123!');
    userToken = token;
    const api = new TestApiClient(token);

    const org = await api.createOrganization(`Facets Org ${Date.now()}`);
    organizationId = org.organization.id;
    const project = await api.createProject(organizationId, `Facets Project ${Date.now()}`);
    projectId = project.project.id;
    const key = await api.createApiKey(projectId, 'Facets Key');

    await api.ingestLogs(key.apiKey, [
      createTestLog({ service: 'api-gateway', level: 'error', message: 'connection refused by upstream' }),
      createTestLog({ service: 'api-gateway', level: 'error', message: 'request timeout after 30s' }),
      createTestLog({ service: 'api-gateway', level: 'info', message: 'request served ok' }),
      createTestLog({ service: 'billing', level: 'error', message: 'card declined' }),
      createTestLog({ service: 'billing', level: 'info', message: 'invoice created' }),
      createTestLog({ service: 'worker', level: 'warn', message: 'queue depth high' }),
    ]);
    await wait(2000);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'facets@test.com', name: 'Facets', token: userToken }, userToken);
    await page.evaluate((orgId) => localStorage.setItem('currentOrganizationId', orgId), organizationId);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?project=${projectId}`);
    await expect(page.getByRole('region', { name: 'Results' }).getByText('card declined')).toBeVisible({ timeout: 30000 });
  });

  const results = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Results' });
  const queryBox = (page: import('@playwright/test').Page) => page.getByRole('combobox', { name: 'Log query' });
  const facets = (page: import('@playwright/test').Page) => page.getByRole('complementary', { name: 'Facets' });

  test('1. A grammar query narrows the results and lands in the URL', async ({ page }) => {
    await queryBox(page).fill('level:error service:api-gateway');
    await queryBox(page).press('Enter');

    await expect(results(page).getByText('connection refused by upstream')).toBeVisible({ timeout: 15000 });
    await expect(results(page).getByText('request timeout after 30s')).toBeVisible();
    await expect(results(page).getByText('card declined')).toHaveCount(0);
    await expect(results(page).getByText('request served ok')).toHaveCount(0);

    await expect(page).toHaveURL(/q=level%3Aerror\+service%3Aapi-gateway/);
  });

  test('2. Free text, quoted phrases and exclusions combine', async ({ page }) => {
    const query = queryBox(page);

    await query.fill('"connection refused"');
    await query.press('Enter');
    await expect(results(page).getByText('connection refused by upstream')).toBeVisible({ timeout: 15000 });
    await expect(results(page).getByText('request timeout after 30s')).toHaveCount(0);

    await query.fill('level:error -service:billing');
    await query.press('Enter');
    await expect(results(page).getByText('request timeout after 30s')).toBeVisible({ timeout: 15000 });
    await expect(results(page).getByText('card declined')).toHaveCount(0);

    await query.fill('level:(warn OR info)');
    await query.press('Enter');
    await expect(results(page).getByText('queue depth high')).toBeVisible({ timeout: 15000 });
    await expect(results(page).getByText('request served ok')).toBeVisible();
    await expect(results(page).getByText('connection refused by upstream')).toHaveCount(0);
  });

  test('3. Clicking a facet value adds a clause and the URL keeps it', async ({ page }) => {
    await queryBox(page).fill('level:error');
    await queryBox(page).press('Enter');
    await expect(results(page).getByText('card declined')).toBeVisible({ timeout: 15000 });
    await expect(results(page).getByText('request served ok')).toHaveCount(0);

    // Add a second clause from the Service facet
    await facets(page).getByRole('button', { name: /^service billing \(/ }).click();

    await expect(queryBox(page)).toHaveValue('level:error service:billing');
    await expect(page).toHaveURL(/q=level%3Aerror\+service%3Abilling/);
    await expect(results(page).getByText('card declined')).toBeVisible();
    await expect(results(page).getByText('connection refused by upstream')).toHaveCount(0);

    // A reload restores the same query and the same results
    await page.reload();
    await expect(queryBox(page)).toHaveValue('level:error service:billing');
    await expect(results(page).getByText('card declined')).toBeVisible({ timeout: 20000 });
    await expect(results(page).getByText('connection refused by upstream')).toHaveCount(0);
  });

  test('4. A facet menu excludes a value, and clearing the query undoes it', async ({ page }) => {
    await expect(queryBox(page)).toHaveValue('');

    await facets(page).getByRole('button', { name: 'More actions for service billing' }).click();
    await page.getByRole('button', { name: 'Exclude', exact: true }).click();

    await expect(queryBox(page)).toHaveValue('-service:billing');
    await expect(results(page).getByText('card declined')).toHaveCount(0, { timeout: 15000 });
    await expect(results(page).getByText('request served ok')).toBeVisible();

    await queryBox(page).fill('');
    await queryBox(page).press('Enter');
    await expect(page).not.toHaveURL(/q=/);
    await expect(results(page).getByText('card declined')).toBeVisible({ timeout: 15000 });
  });

  test('5. A malformed query shows an inline error and keeps the last results', async ({ page }) => {
    await queryBox(page).fill('level:(error');
    await queryBox(page).press('Enter');

    await expect(queryBox(page)).toHaveAttribute('aria-invalid', 'true', { timeout: 10000 });
    await expect(page.locator('#' + (await queryBox(page).getAttribute('aria-describedby')))).toBeVisible();
    await expect(results(page).getByText('card declined')).toBeVisible();
  });
});
