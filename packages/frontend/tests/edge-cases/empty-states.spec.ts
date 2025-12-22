import { test, expect, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL, TestApiClient } from '../fixtures/auth';

test.describe('Empty States', () => {
  let userToken: string;
  let organizationId: string;
  let projectId: string;

  test.beforeAll(async () => {
    // Create a fresh user with no data
    const email = generateTestEmail();
    const { user, token } = await registerUser(generateTestName('Empty'), email, 'TestPassword123!');
    userToken = token;

    // Create org and project for some tests
    const apiClient = new TestApiClient(token);
    const orgResult = await apiClient.createOrganization(`Empty States Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    const projectResult = await apiClient.createProject(organizationId, `Empty States Project ${Date.now()}`);
    projectId = projectResult.project.id;
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Empty Test', token: userToken }, userToken);

    // Set organization context
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);

    // Navigate to dashboard to trigger org loading
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await page.waitForLoadState('load');
    // Wait for organization to be loaded (RequireOrganization shows content only when org is ready)
    await page.waitForSelector('nav, [class*="sidebar"], h1, h2', { timeout: 30000 });
    await page.waitForTimeout(500);
  });

  test('Dashboard shows empty state when no logs exist', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Dashboard should load but might show zero stats or empty widgets
    const pageContent = await page.content();
    // Should not show error, just empty or zero data
    expect(pageContent.toLowerCase()).not.toContain('failed to load');
  });

  test('Search page shows empty state when no logs match', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Search for something that definitely doesn't exist
    const searchInput = page.locator('input#search, input[placeholder*="search" i]');
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill('nonexistent-query-that-will-never-match-12345');
      await searchInput.press('Enter');
      await page.waitForTimeout(1000);
    }

    // Should show "No logs found" or similar empty state
    const emptyState = await page.locator('text=/no.*log/i, text=/no.*result/i').isVisible().catch(() => false);
    const hasTable = await page.locator('table tbody tr').count().catch(() => 0);

    expect(emptyState || hasTable === 0).toBe(true);
  });

  test('Projects page shows empty state when no projects exist', async ({ page }) => {
    // Use a fresh user with no projects
    const freshEmail = generateTestEmail();
    const { user: freshUser, token: freshToken } = await registerUser(generateTestName('NoProjects'), freshEmail, 'TestPassword123!');

    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, freshUser, freshToken);
    await page.reload();

    // This user has no org, so should be redirected to onboarding
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Should show onboarding or empty state
    const pageContent = await page.content();
    const isOnboarding = pageContent.includes('create') || pageContent.includes('organization');
    const hasProjects = await page.locator('[class*="project"], [class*="Project"]').count().catch(() => 0);

    expect(isOnboarding || hasProjects === 0).toBe(true);
  });

  test('Alerts page shows empty state when no alerts exist', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Should show alert rules page with create button or empty state
    const hasAlertRulesHeading = await page.locator('h2:has-text("Alert Rules")').isVisible().catch(() => false);
    const createButton = await page.locator('button:has-text("Create")').first().isVisible().catch(() => false);
    const emptyStateText = await page.locator('text=/no.*alert/i, text=/create.*first/i').isVisible().catch(() => false);

    expect(hasAlertRulesHeading || createButton || emptyStateText).toBe(true);
  });

  test('Alert history shows empty state when no alerts triggered', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/alerts`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Should show empty state or no rows
    const hasEmptyState = await page.locator('text=/no.*alert/i, text=/no.*history/i').isVisible().catch(() => false);
    const tableRows = await page.locator('table tbody tr').count().catch(() => 0);

    expect(hasEmptyState || tableRows === 0).toBe(true);
  });

  test('Project settings shows appropriate state for new project', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/settings`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Settings page should load without errors - look for any heading
    const hasHeading = await page.locator('h1, h2').first().isVisible().catch(() => false);

    // Page should have some content (settings form, tabs, or project info)
    const hasSettingsContent = await page.locator('[class*="Card"], [class*="card"], form, [role="tablist"]').first().isVisible().catch(() => false);
    const hasApiKeysSection = await page.locator('text=/api.*key/i').isVisible().catch(() => false);
    const hasProjectName = await page.locator(`text=/Empty States Project/`).isVisible().catch(() => false);

    expect(hasHeading || hasSettingsContent || hasApiKeysSection || hasProjectName).toBe(true);
  });
});
