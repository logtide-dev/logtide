import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createTestLog, wait } from '../helpers/factories';

test.describe('Metadata Filtering Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let apiKey: string;
  let organizationId: string;

  test.beforeAll(async () => {
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('MetaFilter'), email, 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    const orgResult = await apiClient.createOrganization(`MetaFilter Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    const projectResult = await apiClient.createProject(organizationId, `MetaFilter Test Project ${Date.now()}`);
    projectId = projectResult.project.id;

    const apiKeyResult = await apiClient.createApiKey(projectId, 'MetaFilter Test Key');
    apiKey = apiKeyResult.apiKey;

    const logs = [
      createTestLog({ service: 'api', level: 'error', message: 'prod boom', metadata: { environment: 'production' } }),
      createTestLog({ service: 'api', level: 'error', message: 'dev boom', metadata: { environment: 'development' } }),
      createTestLog({ service: 'api', level: 'error', message: 'no env boom', metadata: {} }),
    ];

    await apiClient.ingestLogs(apiKey, logs);
    await wait(2000);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);

    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?projectId=${projectId}`);
    await page.waitForLoadState('load');
    await page.waitForSelector('text=prod boom', { timeout: 30000 });
  });

  test('1. All 3 logs visible before applying metadata filter', async ({ page }) => {
    await expect(page.getByText('prod boom')).toBeVisible();
    await expect(page.getByText('dev boom')).toBeVisible();
    await expect(page.getByText('no env boom')).toBeVisible();
  });

  test('2. Metadata filter by environment=production shows only prod log', async ({ page }) => {
    // Metadata keys are plain field clauses in the log query
    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill('environment:production');
    await query.press('Enter');

    await expect(page.getByText('prod boom')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('dev boom')).not.toBeVisible();
    await expect(page.getByText('no env boom')).not.toBeVisible();
    await expect(page).toHaveURL(/q=environment%3Aproduction/);
  });

  test('3. Clearing metadata filters restores all logs', async ({ page }) => {
    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill('environment:production');
    await query.press('Enter');
    await expect(page.getByText('dev boom')).not.toBeVisible({ timeout: 10000 });

    await query.fill('');
    await query.press('Enter');

    await expect(page.getByText('prod boom')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('dev boom')).toBeVisible();
    await expect(page.getByText('no env boom')).toBeVisible();
  });

  test('4. A negated metadata clause also keeps logs without the key', async ({ page }) => {
    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill('-environment:production');
    await query.press('Enter');

    await expect(page.getByText('dev boom')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('no env boom')).toBeVisible();
    await expect(page.getByText('prod boom')).not.toBeVisible();
  });
});
