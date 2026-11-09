import { test, expect, TestApiClient, registerUser, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createErrorLogs } from '../helpers/factories';
import { openAsUser } from '../helpers/siem';

test.describe('Alert Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let projectName: string;
  let apiKey: string;
  let organizationId: string;
  let testUserEmail: string;

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const alertsUrl = (pid: string) => `${TEST_FRONTEND_URL}/dashboard/alerts?project=${pid}`;

  async function listRules() {
    return (await apiClient.getAlertRules(organizationId, projectId)).alertRules;
  }

  async function seedRule(name: string, overrides: Record<string, unknown> = {}) {
    const res = await apiClient.createAlertRule(projectId, {
      organizationId,
      projectId,
      name,
      enabled: true,
      level: ['error'],
      threshold: 5,
      timeWindow: 5,
      emailRecipients: ['test@e2e-test.logtide.dev'],
      ...overrides,
    });
    return res.alertRule;
  }

  test.beforeAll(async () => {
    testUserEmail = generateTestEmail();
    const { token } = await registerUser(generateTestName('Alert'), testUserEmail, 'tidal-Orbit-Granite-57');
    userToken = token;
    apiClient = new TestApiClient(token);

    organizationId = (await apiClient.createOrganization(`Alert Test Org ${uniq()}`)).organization.id;
    projectName = `Alert Test Project ${uniq()}`;
    projectId = (await apiClient.createProject(organizationId, projectName)).project.id;
    apiKey = (await apiClient.createApiKey(projectId, 'Alert Test Key')).apiKey;
  });

  test.beforeEach(async ({ page }) => {
    await openAsUser(page, userToken, organizationId, testUserEmail);
  });

  test('1. A project without alert rules shows the empty state', async ({ page }) => {
    // A dedicated project, so rules created by the other tests do not matter
    const emptyProject = (await apiClient.createProject(organizationId, `Empty Alert Project ${uniq()}`)).project.id;

    await page.goto(alertsUrl(emptyProject));
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('tab', { name: 'Rules', selected: true })).toBeVisible();

    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText('No alert rules')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Create alert' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Open detection rules' })).toHaveAttribute('href', '/dashboard/security/rules');
  });

  test('2. User can create an alert rule', async ({ page }) => {
    const channelName = `E2E Channel ${uniq()}`;
    const { channel } = await apiClient.createNotificationChannel(
      organizationId,
      channelName,
      'email',
      { recipients: ['test@e2e.logtide.dev'] },
      { enabled: true }
    );
    const alertName = `E2E Alert ${uniq()}`;

    await page.goto(alertsUrl(projectId));
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('main').getByRole('button', { name: 'Create alert' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Create alert rule')).toBeVisible();
    await dialog.getByLabel('Alert name').fill(alertName);
    await dialog.locator('input#alert-threshold').fill('3');
    await dialog.locator('input#alert-window').fill('5');

    await dialog.getByRole('button', { name: 'Select channels...' }).click();
    await page.getByRole('button', { name: new RegExp(channelName) }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Create alert' }).click();

    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole('row').filter({ hasText: alertName })).toHaveCount(1, { timeout: 15000 });

    const created = (await listRules()).find((r: { name: string }) => r.name === alertName);
    expect(created).toBeDefined();
    expect(created.threshold).toBe(3);
    expect(created.timeWindow).toBe(5);
    expect(created.channelIds).toEqual([channel.id]);
    expect(created.enabled).toBe(true);
  });

  test('3. User can toggle alert enabled/disabled', async ({ page }) => {
    const name = `Toggle Test Alert ${uniq()}`;
    await seedRule(name);

    await page.goto(alertsUrl(projectId));
    const enabledInApi = async () => (await listRules()).find((r: { name: string }) => r.name === name)?.enabled;

    await page.getByRole('switch', { name: `Disable ${name}` }).click();
    await expect(page.getByRole('switch', { name: `Enable ${name}` })).toBeVisible();
    await expect.poll(enabledInApi).toBe(false);

    await page.getByRole('switch', { name: `Enable ${name}` }).click();
    await expect(page.getByRole('switch', { name: `Disable ${name}` })).toBeVisible();
    await expect.poll(enabledInApi).toBe(true);
  });

  test('4. User can delete an alert rule', async ({ page }) => {
    const alertName = `Delete Test Alert ${uniq()}`;
    await seedRule(alertName);

    await page.goto(alertsUrl(projectId));
    await page.getByRole('button', { name: `Delete alert ${alertName}` }).click();

    // ConfirmDialog: Cancel has focus, Delete must be clicked explicitly
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText('Delete alert rule')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm).toBeHidden();

    await expect(page.getByRole('button', { name: `Delete alert ${alertName}` })).toHaveCount(0);
    await expect
      .poll(async () => (await listRules()).some((a: { name: string }) => a.name === alertName))
      .toBe(false);
  });

  test('5. A fired alert shows up in the History tab', async ({ page }) => {
    test.setTimeout(240_000);
    const alertName = `History Test Alert ${uniq()}`;
    const rule = await seedRule(alertName, { threshold: 2, timeWindow: 5 });

    await apiClient.ingestLogs(apiKey, createErrorLogs(4, `history-service-${uniq()}`));

    // The worker evaluates alert rules about once a minute
    await expect
      .poll(
        async () => {
          const res = await apiClient.getAlertHistory(organizationId);
          return res.history.some((h) => h.ruleId === rule.id && h.ruleName === alertName);
        },
        { timeout: 180_000, intervals: [5_000] }
      )
      .toBe(true);

    await page.goto(alertsUrl(projectId));
    await page.getByRole('tab', { name: 'History' }).click();
    const row = page.getByRole('tabpanel', { name: 'History' }).getByRole('row').filter({ hasText: alertName });
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await expect(row).toContainText('Alert');
    await expect(row).toContainText(projectName);
    await expect(row.getByRole('link', { name: 'Show matched logs' })).toBeVisible();
  });

  test('6. Sigma import lives in Security > Rules, not in the alert dialog', async ({ page }) => {
    await page.goto(alertsUrl(projectId));
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible({ timeout: 30000 });

    // No Sigma tab on the alerts page
    await expect(page.getByRole('tab', { name: /sigma/i })).toHaveCount(0);

    // The dialog points to Security > Rules instead of offering an import tab
    await page.getByRole('main').getByRole('button', { name: 'Create alert' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: /sigma/i })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: /security > rules/i })).toHaveAttribute('href', '/dashboard/security/rules');
  });
});
