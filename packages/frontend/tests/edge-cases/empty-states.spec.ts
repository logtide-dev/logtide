import { test, expect, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL, TestApiClient } from '../fixtures/auth';
import { generateId } from '../helpers/factories';
import type { Page } from '@playwright/test';

test.describe('Empty States', () => {
  let userToken: string;
  // Org A: one project, no data at all
  let organizationId: string;
  let projectId: string;
  let projectName: string;
  // Org B: one project with a single log (search has data, but nothing matches)
  let dataOrgId: string;
  const dataMessage = `empty states probe ${generateId()}`;
  // Org C: no project at all
  let noProjectOrgId: string;

  async function useOrganization(page: Page, orgId: string) {
    await page.evaluate((id) => {
      localStorage.setItem('currentOrganizationId', id);
    }, orgId);
  }

  test.beforeAll(async () => {
    // Create a fresh user with no data
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Empty'), email, 'tidal-Orbit-Granite-57');
    userToken = token;

    const apiClient = new TestApiClient(token);
    const orgResult = await apiClient.createOrganization(`Empty States Org ${Date.now()}`);
    organizationId = orgResult.organization.id;
    projectName = `Empty States Project ${Date.now()}`;
    const projectResult = await apiClient.createProject(organizationId, projectName);
    projectId = projectResult.project.id;

    const dataOrg = await apiClient.createOrganization(`Empty States Data Org ${Date.now()}`);
    dataOrgId = dataOrg.organization.id;
    const dataProject = await apiClient.createProject(dataOrgId, `Empty States Data Project ${Date.now()}`);
    const key = await apiClient.createApiKey(dataProject.project.id, 'Empty States Key');
    await apiClient.ingestLogs(key.apiKey, [
      { service: 'empty-svc', level: 'info', message: dataMessage, time: new Date().toISOString() },
    ]);
    await expect
      .poll(async () => (await apiClient.getLogs(dataProject.project.id, { limit: '10' })).logs.length, { timeout: 20000 })
      .toBe(1);

    const noProjectOrg = await apiClient.createOrganization(`Empty States No Project Org ${Date.now()}`);
    noProjectOrgId = noProjectOrg.organization.id;
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Empty Test', token: userToken }, userToken);
    await useOrganization(page, organizationId);
  });

  test('Dashboard shows zero values when no logs exist', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible({ timeout: 30000 });

    const total = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Total logs today' }) });
    await expect(total).toBeVisible({ timeout: 20000 });
    await expect(total).toContainText(/\b0\b/);
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Error rate' }) })).toContainText('0.0%');
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Active services' }) })).toContainText(/\b0\b/);
    await expect(page.getByText('Could not load the dashboard')).toHaveCount(0);
  });

  test('Logs page invites to send logs when the organization has none', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByRole('heading', { name: 'No logs yet' })).toBeVisible({ timeout: 20000 });
    await expect(results.getByText('Start sending logs from your applications')).toBeVisible();
    await expect(results.getByRole('table')).toHaveCount(0);
  });

  test('Search page shows the no-results state when no logs match', async ({ page }) => {
    await useOrganization(page, dataOrgId);
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText(dataMessage)).toBeVisible({ timeout: 20000 });

    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill('nonexistent-query-that-will-never-match-12345');
    await query.press('Enter');

    await expect(results.getByRole('heading', { name: /^No logs match in/ })).toBeVisible({ timeout: 15000 });
    await expect(results.getByText('Try a wider time range or a simpler query.')).toBeVisible();
    await expect(results.getByText(dataMessage)).toHaveCount(0);
    await expect(results.getByRole('heading', { name: 'No logs yet' })).toHaveCount(0);
  });

  test('Projects page invites to create the first project when none exist', async ({ page }) => {
    await useOrganization(page, noProjectOrgId);
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);

    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('0 projects')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Create project', exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('A user without an organization is sent to onboarding', async ({ page }) => {
    const { user, token } = await registerUser(generateTestName('NoOrg'), generateTestEmail(), 'tidal-Orbit-Granite-57');
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, user, token);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
  });

  test('Alerts page shows the empty rules state when no alerts exist', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);

    const rules = page.getByRole('tabpanel', { name: 'Rules' });
    await expect(page.getByRole('tab', { name: 'Rules' })).toHaveAttribute('aria-selected', 'true', { timeout: 30000 });
    await expect(rules.getByRole('heading', { name: 'No alert rules' })).toBeVisible({ timeout: 20000 });
    await expect(rules.getByText('Create a rule to be notified when logs cross a threshold or change sharply.')).toBeVisible();
    await expect(rules.getByRole('button', { name: 'Create alert' })).toBeVisible();
    // Only the header row and the empty-state row exist: no rule is listed
    await expect(rules.getByRole('row')).toHaveCount(2);
  });

  test('Alert history shows empty state when no alerts triggered', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);

    // History is the second tab on the alerts page; with no alerts fired it is an empty table
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'History' }).getByText('No results')).toBeVisible({ timeout: 10000 });
  });

  test('Project settings shows the project and empty API key and receiver lists', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/settings`);

    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(projectName);
    await expect(page.getByRole('region', { name: 'API keys' }).getByText('No API keys yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Receivers' }).getByText('No receivers yet')).toBeVisible();
  });
});
