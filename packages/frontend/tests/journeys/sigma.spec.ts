import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { createTestLog, createDetectionSigmaRule } from '../helpers/factories';
import { openAsUser, matchAnyLogSigmaYaml, waitForDetection, listDetections } from '../helpers/siem';

function sigmaRuleYaml(title: string, keyword: string, level: string): string {
  return `
title: ${title}
id: ${keyword}-${Date.now()}
status: test
level: ${level}
description: ${title}
author: E2E Test
logsource:
    category: application
    product: logtide
detection:
    selection:
        message|contains: '${keyword}'
    condition: selection
falsepositives:
    - Testing
`.trim();
}

test.describe('Sigma Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let projectId: string;
  let projectName: string;
  let apiKey: string;
  let organizationId: string;

  test.beforeAll(async () => {
    // Create test user and setup
    const email = generateTestEmail();
    const { token } = await registerUser(generateTestName('Sigma'), email, 'tidal-Orbit-Granite-57');
    userToken = token;
    apiClient = new TestApiClient(token);

    // Create organization
    const orgResult = await apiClient.createOrganization(`Sigma Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    // Create project
    projectName = `Sigma Test Project ${Date.now()}`;
    const projectResult = await apiClient.createProject(organizationId, projectName);
    projectId = projectResult.project.id;

    // Create API key
    const apiKeyResult = await apiClient.createApiKey(projectId, 'Sigma Test Key');
    apiKey = apiKeyResult.apiKey;
  });

  test.beforeEach(async ({ page }) => {
    await openAsUser(page, userToken, organizationId);
  });

  test('1. User can navigate to project settings', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/settings`);
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Project name')).toHaveValue(projectName);
  });

  test('2. User can import a Sigma rule via the Detection rules page', async ({ page }) => {
    const keyword = `sigma-test-${Date.now()}`;
    const sigmaRule = createDetectionSigmaRule(keyword);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/rules`);
    await expect(page.getByRole('heading', { name: 'Detection rules', exact: true })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Import rule' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Rule YAML').fill(sigmaRule);
    await expect(dialog.getByText(/Valid rule/)).toBeVisible({ timeout: 15000 });

    await dialog.getByRole('button', { name: 'Import rule' }).click();

    // A successful import opens the new rule
    await expect(page).toHaveURL(/\/dashboard\/security\/rules\/[0-9a-f-]{36}/, { timeout: 20000 });

    const { rules } = await apiClient.getSigmaRules(organizationId);
    expect(rules.filter((r: { title: string }) => r.title === `Detect ${keyword} in logs`)).toHaveLength(1);
  });

  test('3. User can view Sigma rules list', async ({ page }) => {
    const title = `List Test Rule ${Date.now()}`;
    await apiClient.importSigmaRule(organizationId, sigmaRuleYaml(title, 'list-test', 'medium'));

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/rules`);
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 30000 });
  });

  test('4. User can view Sigma rule details', async ({ page }) => {
    const title = `Details Test Rule ${Date.now()}`;
    await apiClient.importSigmaRule(organizationId, sigmaRuleYaml(title, 'details-test', 'high'));

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/rules`);
    await page.getByRole('link', { name: title }).click();

    await expect(page).toHaveURL(/\/dashboard\/security\/rules\/[0-9a-f-]{36}/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({ timeout: 15000 });
  });

  test('5. User can enable/disable Sigma rule', async ({ page }) => {
    const title = `Toggle Test Rule ${Date.now()}`;
    await apiClient.importSigmaRule(organizationId, sigmaRuleYaml(title, 'toggle-test', 'medium'));

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/rules`);
    const toggle = page.getByRole('switch', { name: `Enable ${title}` });
    await expect(toggle).toBeVisible({ timeout: 30000 });

    const enabledInApi = async () =>
      (await apiClient.getSigmaRules(organizationId)).rules.find((r: { title: string }) => r.title === title)?.enabled;

    // Imported rules start enabled
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await enabledInApi()).toBe(true);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect.poll(enabledInApi).toBe(false);

    // The state survives a reload
    await page.reload();
    await expect(page.getByRole('switch', { name: `Enable ${title}` })).toHaveAttribute('aria-checked', 'false', { timeout: 30000 });

    // Toggle back on
    await page.getByRole('switch', { name: `Enable ${title}` }).click();
    await expect(page.getByRole('switch', { name: `Enable ${title}` })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(enabledInApi).toBe(true);
  });

  test('6. User can delete Sigma rule', async ({ page }) => {
    const title = `Delete Test Rule ${Date.now()}`;
    await apiClient.importSigmaRule(organizationId, sigmaRuleYaml(title, 'delete-test', 'low'));

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/rules`);
    await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 30000 });
    expect((await apiClient.getSigmaRules(organizationId)).rules.some((r: { title: string }) => r.title === title)).toBe(true);

    await page.getByRole('button', { name: `Actions for ${title}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete rule' }).click();

    await expect(page.getByRole('link', { name: title })).toHaveCount(0, { timeout: 15000 });

    // The API agrees
    const { rules } = await apiClient.getSigmaRules(organizationId);
    expect(rules.some((r: { title: string }) => r.title === title)).toBe(false);
  });

  test('7. Sigma rule detects matching logs', async ({ page }) => {
    const keyword = `sigma-detect-${Date.now()}`;
    const ruleTitle = `Detect ${keyword}`;
    const matchingMessage = `Error with ${keyword} detected`;

    await apiClient.importSigmaRule(organizationId, matchAnyLogSigmaYaml(ruleTitle, keyword, 'high'));

    await apiClient.ingestLogs(apiKey, [
      createTestLog({ level: 'info', message: 'unrelated message without the keyword', service: 'sigma-test-service' }),
      createTestLog({ level: 'error', message: matchingMessage, service: 'sigma-test-service' }),
    ]);

    // The worker evaluates the batch asynchronously
    const detection = await waitForDetection(userToken, organizationId, ruleTitle);
    expect(detection.logMessage).toBe(matchingMessage);
    expect(detection.severity).toBe('high');
    const forRule = (await listDetections(userToken, organizationId)).filter((d) => d.ruleTitle === ruleTitle);
    expect(forRule).toHaveLength(1);

    // And the detection is visible on the security overview
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await expect(page.getByRole('button', { name: ruleTitle })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('table').getByText(ruleTitle, { exact: true })).toBeVisible();
  });

  test('8. Sigma rule validation shows errors for invalid YAML', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/rules`);
    await expect(page.getByRole('heading', { name: 'Detection rules', exact: true })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Import rule' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Rule YAML').fill('this is not valid yaml: [[[');

    // The rule is checked as you type: an error shows and Import stays disabled
    await expect(dialog.locator('.text-destructive-text').first()).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByRole('button', { name: 'Import rule' })).toBeDisabled();
    await expect(dialog.locator('.text-destructive-text').first()).toHaveText(/\S/);

    // Well-formed YAML that is not a rule names the missing field
    await dialog.getByLabel('Rule YAML').fill('title: Only a title');
    await expect(dialog.getByText('Missing or invalid "logsource" field')).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByRole('button', { name: 'Import rule' })).toBeDisabled();
    await expect(dialog).toBeVisible();
  });
});
