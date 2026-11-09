import { test, expect, type Page } from '@playwright/test';
import {
  generateTestEmail,
  generateTestName,
  loginUser,
  setAuthState,
  TestApiClient,
  TEST_FRONTEND_URL,
  TEST_API_URL,
  waitForAuthForm,
} from '../fixtures/auth';
import { createTestLog, generateId } from '../helpers/factories';

test.describe('New User Journey', () => {
  test.describe.configure({ mode: 'serial' });

  // Shared state across tests in this describe block
  let userEmail: string;
  let userPassword: string;
  let userName: string;
  let orgName: string;
  let onboardingProjectName: string;
  let api: TestApiClient;
  let session: Awaited<ReturnType<typeof loginUser>>;
  let organizationId: string;
  let projectId: string;
  let apiKey: string;

  test.beforeAll(() => {
    userEmail = generateTestEmail();
    userPassword = 'tidal-Orbit-Granite-57';
    userName = generateTestName('New');
    orgName = `New User Org ${generateId()}`;
    onboardingProjectName = `Onboarding Project ${generateId()}`;
  });

  /** Authenticate the browser as the journey user (the login form is covered by login.spec.ts). */
  async function authenticate(page: Page) {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, session.user, session.token);
    await page.evaluate((orgId) => localStorage.setItem('currentOrganizationId', orgId), organizationId);
  }

  test('1. User can register a new account', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/register`);
    await waitForAuthForm(page);

    await page.locator('input#name').fill(userName);
    await page.locator('input#email').fill(userEmail);
    await page.locator('input#password').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    // A brand new user has no organization yet, so onboarding starts
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();

    // The account really exists: the API accepts the credentials
    const created = await loginUser(userEmail, userPassword);
    expect(created.user.email).toBe(userEmail);
    expect(created.user.name).toBe(userName);
  });

  test('2. User can create an organization and a project through onboarding', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await waitForAuthForm(page);
    await page.locator('input#email').fill(userEmail);
    await page.locator('input#password').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();

    // Workspace step creates the organization and the first project together
    await page.locator('input#org-name').fill(orgName);
    await page.locator('input#project-name').fill(onboardingProjectName);
    await page.getByRole('button', { name: 'Create workspace' }).click();

    // Connect step: skip the first signal wait to reach the end of onboarding
    await expect(page.getByRole('heading', { name: 'Connect your first app' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible({ timeout: 10000 });

    // The names typed in the UI are what the API now holds
    session = await loginUser(userEmail, userPassword);
    api = new TestApiClient(session.token);
    const { organizations } = await api.getOrganizations();
    const org = organizations.find((o) => o.name === orgName);
    expect(org, `organization "${orgName}" should exist`).toBeTruthy();
    organizationId = org.id;

    const { projects } = await api.getProjects(organizationId);
    expect(projects.map((p) => p.name)).toContain(onboardingProjectName);
  });

  test('3. User can create a project from the Projects page', async ({ page }) => {
    const projectName = `Second Project ${generateId()}`;
    await authenticate(page);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page.getByText(onboardingProjectName).first()).toBeVisible();

    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create project' })).toBeVisible();
    await dialog.locator('input#project-name').fill(projectName);
    await dialog.getByRole('button', { name: 'Create project' }).click();

    // Creating a project opens its page
    await expect(page).toHaveURL(/\/dashboard\/projects\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();

    const { projects } = await api.getProjects(organizationId);
    expect(projects).toHaveLength(2);
    const created = projects.find((p) => p.name === projectName);
    expect(created, `project "${projectName}" should exist in the API`).toBeTruthy();
    projectId = created.id;
    expect(page.url()).toContain(projectId);
  });

  test('4. User can create an API key', async ({ page }) => {
    const keyName = `E2E Key ${generateId()}`;
    await authenticate(page);

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/settings`);
    await page.getByRole('button', { name: 'Create API key' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.locator('input#api-key-name').fill(keyName);
    await dialog.getByRole('button', { name: 'Create API key' }).click();

    // The key is shown once, in full, and starts with the platform prefix
    await expect(dialog.getByRole('heading', { name: 'API key created' })).toBeVisible();
    const keyBox = dialog.locator('div.font-mono.select-all').first();
    await expect(keyBox).toHaveText(/^\s*lp_\S+\s*$/);
    apiKey = (await keyBox.innerText()).trim();

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    // The key is now listed by name and can be deleted from the list
    await expect(page.getByText(keyName, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Delete API key ${keyName}` })).toBeVisible();
  });

  test('5. User can send a first log with the API key and see it in Logs', async ({ page }) => {
    const message = `first log from the new user journey ${generateId()}`;
    const service = `e2e-newuser-${generateId()}`;

    const response = await fetch(`${TEST_API_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ logs: [createTestLog({ level: 'info', message, service })] }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).received).toBe(1);

    await authenticate(page);
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/logs`);
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible();

    const results = page.getByRole('region', { name: 'Results' });
    await expect(results.getByText(message)).toBeVisible({ timeout: 20000 });
    await expect(results.getByRole('button', { name: `Filter by service ${service}` })).toBeVisible();
  });
});
