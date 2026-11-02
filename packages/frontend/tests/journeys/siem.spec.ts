import { test, expect, TestApiClient, registerUser, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import type { Page } from '@playwright/test';
import { createTestLog } from '../helpers/factories';
import {
  openAsUser,
  matchAnyLogSigmaYaml,
  waitForDetection,
  createIncidentFromDetections,
} from '../helpers/siem';

const INCIDENTS_URL = /\/dashboard\/incidents(\?.*)?$/;

test.describe('SIEM Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let organizationId: string;
  let projectId: string;

  // Seeded once: a manual incident, and a sigma incident built from a real detection.
  let manualTitle: string;
  let manualIncidentId: string;
  let sigmaRuleTitle: string;
  let sigmaLogMessage: string;
  let sigmaIncidentTitle: string;
  let sigmaIncidentId: string;

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  async function createIncident(
    title: string,
    severity: 'critical' | 'high' | 'medium' | 'low' | 'informational',
    status: 'open' | 'investigating' | 'resolved' | 'false_positive' = 'open',
    description = `Description of ${title}`
  ): Promise<string> {
    const incident = await apiClient.createSiemIncident({ organizationId, title, description, severity, status });
    return incident.id;
  }

  const rowOf = (page: Page, title: string) =>
    page.getByRole('row').filter({ has: page.getByRole('link', { name: title, exact: true }) });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const { token } = await registerUser(generateTestName('SIEM'), generateTestEmail(), 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    organizationId = (await apiClient.createOrganization(`SIEM Test Org ${uniq()}`)).organization.id;
    projectId = (await apiClient.createProject(organizationId, `SIEM Project ${uniq()}`)).project.id;
    const apiKey = (await apiClient.createApiKey(projectId, 'SIEM Key')).apiKey;

    manualTitle = `Test Incident ${uniq()}`;
    manualIncidentId = await createIncident(manualTitle, 'high', 'open', 'Incident created for E2E testing');

    // A real detection: import a rule, ingest a matching log, wait for the worker.
    const keyword = `siemkw${Date.now()}`;
    sigmaRuleTitle = `SIEM rule ${keyword}`;
    sigmaLogMessage = `login failure for ${keyword}`;
    await apiClient.importSigmaRule(organizationId, matchAnyLogSigmaYaml(sigmaRuleTitle, keyword, 'high'));
    await apiClient.ingestLogs(apiKey, [
      createTestLog({ level: 'error', message: sigmaLogMessage, service: 'siem-service' }),
    ]);
    const detection = await waitForDetection(userToken, organizationId, sigmaRuleTitle);

    sigmaIncidentTitle = `Detection incident ${uniq()}`;
    sigmaIncidentId = (
      await createIncidentFromDetections(userToken, {
        organizationId,
        projectId,
        title: sigmaIncidentTitle,
        severity: 'high',
        detectionEventIds: [detection.id],
      })
    ).id;
  });

  test.beforeEach(async ({ page }) => {
    await openAsUser(page, userToken, organizationId);
  });

  test('1. Security overview shows the seeded detection and incident counts', async ({ page }) => {
    const stats = await apiClient.getSiemDashboard(organizationId, '24h');
    expect(stats.totalDetections).toBe(1);
    expect(stats.totalIncidents).toBeGreaterThanOrEqual(2);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await expect(page.getByRole('heading', { name: 'Security overview', level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('No detections yet')).toHaveCount(0);

    // Stats bar: numbers come from the API response for this org
    await expect(page.getByText(/^\s*1\s+detections\s*$/)).toBeVisible();
    await expect(page.getByText(new RegExp(`^\\s*${stats.totalIncidents}\\s+incidents\\s*$`))).toBeVisible();

    // The detection we caused is listed in the recent events and in the top threats
    await expect(page.getByText('Recent security events')).toBeVisible();
    await expect(page.getByRole('button', { name: sigmaRuleTitle })).toBeVisible();
    await expect(page.getByRole('table').getByText(sigmaRuleTitle, { exact: true })).toBeVisible();
  });

  test('2. Incidents list shows a seeded incident with its severity, status and source', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents`);
    await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible({ timeout: 30000 });

    const row = rowOf(page, manualTitle);
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await expect(row).toContainText('High');
    await expect(row).toContainText('Open');
    await expect(row).toContainText('Manual');
    await expect(page.getByText('No incidents', { exact: true })).toHaveCount(0);

    // The sigma incident is listed with its own source
    await expect(rowOf(page, sigmaIncidentTitle)).toContainText('Security');
  });

  test('3. User can filter incidents by status', async ({ page }) => {
    const openTitle = `Filter open ${uniq()}`;
    const ackTitle = `Filter ack ${uniq()}`;
    const resolvedTitle = `Filter resolved ${uniq()}`;
    await createIncident(openTitle, 'medium', 'open');
    await createIncident(ackTitle, 'medium', 'investigating');
    await createIncident(resolvedTitle, 'medium', 'resolved');

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents`);
    // Default view: open and acknowledged incidents, resolved ones are hidden
    await expect(rowOf(page, openTitle)).toHaveCount(1, { timeout: 15000 });
    await expect(rowOf(page, ackTitle)).toHaveCount(1);
    await expect(rowOf(page, resolvedTitle)).toHaveCount(0);

    // Narrow to Acknowledged only
    await page.getByRole('button', { name: /Status:/ }).click();
    await page.getByRole('checkbox', { name: 'Open', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/[?&]status=investigating(&|$)/);
    await expect(rowOf(page, ackTitle)).toHaveCount(1);
    await expect(rowOf(page, openTitle)).toHaveCount(0);
    await expect(rowOf(page, resolvedTitle)).toHaveCount(0);

    // Add Resolved
    await page.getByRole('button', { name: /Status:/ }).click();
    await page.getByRole('checkbox', { name: 'Resolved', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/status=investigating(%2C|,)resolved/);
    await expect(rowOf(page, resolvedTitle)).toHaveCount(1);
    await expect(rowOf(page, ackTitle)).toHaveCount(1);
    await expect(rowOf(page, openTitle)).toHaveCount(0);
  });

  test('4. User can filter incidents by severity', async ({ page }) => {
    const lowTitle = `Filter low ${uniq()}`;
    await createIncident(lowTitle, 'low');

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents`);
    await expect(rowOf(page, lowTitle)).toHaveCount(1, { timeout: 15000 });
    await expect(rowOf(page, manualTitle)).toHaveCount(1);

    await page.getByRole('button', { name: /Severity:/ }).click();
    await page.getByRole('checkbox', { name: 'Low', exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/[?&]severity=low(&|$)/);
    await expect(rowOf(page, lowTitle)).toHaveCount(1);
    await expect(rowOf(page, manualTitle)).toHaveCount(0);
    await expect(rowOf(page, sigmaIncidentTitle)).toHaveCount(0);
  });

  test('5. User can view incident details', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${manualIncidentId}`);

    await expect(page.getByRole('heading', { name: manualTitle, level: 1 })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Incident created for E2E testing', { exact: true })).toBeVisible();
    await expect(page.getByText('High', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Manual', { exact: true }).first()).toBeVisible();
  });

  test('6. User can acknowledge and resolve an incident', async ({ page }) => {
    const title = `Status change ${uniq()}`;
    const id = await createIncident(title, 'low');

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${id}`);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Acknowledge' }).click();
    // The UI calls the "investigating" status Acknowledged
    await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
    expect((await apiClient.getSiemIncident(id, organizationId)).incident.status).toBe('investigating');

    await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.locator('span.rounded-full').filter({ hasText: /^\s*Resolved\s*$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
    expect((await apiClient.getSiemIncident(id, organizationId)).incident.status).toBe('resolved');
  });

  test('7. User can add a comment to an incident', async ({ page }) => {
    const title = `Comment ${uniq()}`;
    const id = await createIncident(title, 'medium');
    const comment = `E2E comment ${uniq()}`;

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${id}`);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 30000 });

    const textarea = page.getByLabel('Add a comment');
    await textarea.fill(comment);
    await page.getByRole('button', { name: 'Add comment' }).click();

    const timeline = page.getByRole('region', { name: 'Incident timeline' });
    await expect(timeline.getByText(comment, { exact: true })).toBeVisible();
    await expect(textarea).toHaveValue('');

    const detail = await apiClient.getSiemIncident(id, organizationId);
    expect(detail.comments.map((c: { comment: string }) => c.comment)).toEqual([comment]);
  });

  test('8. Incident timeline shows the status change history', async ({ page }) => {
    const title = `History ${uniq()}`;
    const id = await createIncident(title, 'high');
    await apiClient.updateSiemIncident(id, { organizationId, status: 'investigating' });

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${id}`);
    const timeline = page.getByRole('region', { name: 'Incident timeline' });
    await expect(timeline.getByText('Status changed from Open to Acknowledged', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(timeline.getByText('Status changed from Acknowledged to Resolved', { exact: true })).toHaveCount(0);
  });

  test('9. Incident built from a detection lists the detection in its timeline', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${sigmaIncidentId}`);
    await expect(page.getByRole('heading', { name: sigmaIncidentTitle, level: 1 })).toBeVisible({ timeout: 30000 });

    const timeline = page.getByRole('region', { name: 'Incident timeline' });
    await expect(timeline.getByText(sigmaRuleTitle, { exact: true })).toBeVisible();
    await expect(timeline.getByText('siem-service', { exact: true })).toBeVisible();

    await timeline.getByRole('button', { name: 'Show details' }).click();
    await expect(timeline.getByText(sigmaLogMessage, { exact: true })).toBeVisible();
    await expect(timeline.getByRole('link', { name: 'Open log' })).toBeVisible();

    const detail = await apiClient.getSiemIncident(sigmaIncidentId, organizationId);
    expect(detail.detections.map((d: { ruleTitle: string }) => d.ruleTitle)).toEqual([sigmaRuleTitle]);
  });

  test('10. User can delete an incident', async ({ page }) => {
    const title = `Delete ${uniq()}`;
    const id = await createIncident(title, 'low');

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${id}`);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete incident' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page).toHaveURL(INCIDENTS_URL);
    await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();
    await expect(rowOf(page, manualTitle)).toHaveCount(1, { timeout: 15000 });
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
    await expect(apiClient.getSiemIncident(id, organizationId)).rejects.toThrow();
  });

  test('11. Security overview time range switches the dashboard query', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await expect(page.getByRole('heading', { name: 'Security overview', level: 1 })).toBeVisible({ timeout: 30000 });

    const request = page.waitForRequest(
      (r) => r.url().includes('/api/v1/siem/dashboard') && new URL(r.url()).searchParams.get('timeRange') === '7d'
    );
    await page.getByRole('button', { name: 'Last 24 hours' }).click();
    await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
    await request;

    await expect(page.getByRole('button', { name: 'Last 7 days' })).toBeVisible();
    await expect(page.getByText(/^\s*1\s+detections\s*$/)).toBeVisible();
  });

  test('12. "View incidents" on the overview opens the Sigma incidents inbox', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await page.getByRole('link', { name: 'View incidents' }).click();

    // The overview link is scoped to Sigma incidents
    await expect(page).toHaveURL(/\/dashboard\/incidents\?.*source=sigma/);
    await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();
    await expect(rowOf(page, sigmaIncidentTitle)).toHaveCount(1, { timeout: 15000 });
    await expect(rowOf(page, manualTitle)).toHaveCount(0);
  });

  test('13. Breadcrumb leads back from an incident to the incidents list', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/incidents/${manualIncidentId}`);
    await expect(page.getByRole('heading', { name: manualTitle, level: 1 })).toBeVisible({ timeout: 30000 });

    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Incidents' }).click();

    await expect(page).toHaveURL(INCIDENTS_URL);
    await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();
    await expect(rowOf(page, manualTitle)).toHaveCount(1, { timeout: 15000 });
  });

  test('14. Security section in the sidebar leads to the overview', async ({ page }) => {
    const nav = page.getByRole('navigation').first();
    await nav.getByRole('link', { name: 'Overview', exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard\/security(\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Security overview', level: 1 })).toBeVisible();
  });
});
