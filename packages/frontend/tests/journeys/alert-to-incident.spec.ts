import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createTestLog } from '../helpers/factories';

/**
 * Alert from a search to an incident, end to end: build a rule from a Logs
 * query, push the logs over the threshold, let the worker evaluate it (it
 * runs every minute), find the incident in the inbox, then acknowledge and
 * resolve it. Needs the worker process next to the API, like production.
 */
test.describe('Alert to incident journey', () => {
  test.setTimeout(240_000);

  test('a rule built from a search fires, opens an incident and is resolved from the inbox', async ({ page }) => {
    const { token } = await registerUser(generateTestName('Alerter'), generateTestEmail(), 'TestPassword123!');
    const api = new TestApiClient(token);
    const org = await api.createOrganization(`Alert Journey Org ${Date.now()}`);
    const organizationId = org.organization.id;
    const project = await api.createProject(organizationId, `Alert Journey Project ${Date.now()}`);
    const projectId = project.project.id;
    const key = await api.createApiKey(projectId, 'Alert Journey Key');

    const service = `checkout-${Date.now()}`;
    const ruleName = `Checkout errors ${Date.now()}`;
    const channelName = `Journey email ${Date.now()}`;
    const recipient = `alert-journey-${Date.now()}@e2e.logtide.dev`;
    await api.createNotificationChannel(organizationId, channelName, 'email', { recipients: [recipient] }, { enabled: true });

    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'alert@test.com', name: 'Alerter', token }, token);
    await page.evaluate((orgId) => localStorage.setItem('currentOrganizationId', orgId), organizationId);

    // One matching log so the search has something to show
    await api.ingestLogs(key.apiKey, [createTestLog({ service, level: 'error', message: 'payment gateway timeout' })]);

    // 1. Search, then create an alert from it
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs?project=${projectId}`);
    const query = page.getByRole('combobox', { name: 'Log query' });
    await query.fill(`level:error service:${service}`);
    await query.press('Enter');
    await expect(page.getByRole('region', { name: 'Results' }).getByText('payment gateway timeout')).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('button', { name: 'Create alert' }).click();

    // 2. The builder opens pre-filled with the project and the query
    await expect(page).toHaveURL(/\/dashboard\/alerts/);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.locator('#alert-query')).toHaveValue(`level:error service:${service}`);

    await dialog.locator('#alert-name').fill(ruleName);
    await dialog.locator('#alert-threshold').fill('2');
    await dialog.locator('#alert-window').fill('5');

    // A rule needs a destination: pick the email channel created above
    await dialog.getByRole('button', { name: 'Select channels...' }).click();
    await page.getByRole('button', { name: new RegExp(channelName) }).click();
    await page.keyboard.press('Escape');
    await dialog.locator('button[type="submit"]').click();

    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole('link', { name: ruleName }).or(page.getByText(ruleName)).first()).toBeVisible({ timeout: 15000 });

    // 3. Push the matching logs over the threshold
    await api.ingestLogs(key.apiKey, [
      createTestLog({ service, level: 'error', message: 'payment gateway timeout again' }),
      createTestLog({ service, level: 'error', message: 'payment gateway refused card' }),
    ]);

    // 4. The worker evaluates the rule every minute: an incident shows up in the inbox
    const incidentRow = page.getByRole('link', { name: new RegExp(ruleName) }).first();
    await expect
      .poll(
        async () => {
          await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents`);
          // isVisible() does not wait; give the inbox request time to fill the table
          return incidentRow
            .waitFor({ state: 'visible', timeout: 8000 })
            .then(() => true)
            .catch(() => false);
        },
        { timeout: 150_000, intervals: [10_000] }
      )
      .toBe(true);

    // 5. Open it, acknowledge, resolve
    await incidentRow.click();
    await expect(page).toHaveURL(/\/dashboard\/incidents\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: new RegExp(ruleName) }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Acknowledged').first()).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Resolve' }).click();
    // Resolving may ask for confirmation
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirm.getByRole('button', { name: /^Resolve/ }).click();
    }
    await expect(page.getByText('Resolved').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0);

    // The firing notification went to the email channel (mailhog API)
    const mail = await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(recipient)}`);
    expect(mail.ok).toBe(true);
    expect((await mail.json()).total).toBeGreaterThan(0);
  });
});
