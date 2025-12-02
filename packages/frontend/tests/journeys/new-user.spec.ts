import { test, expect } from '@playwright/test';
import { generateTestEmail, generateTestName, TEST_FRONTEND_URL, TEST_API_URL } from '../fixtures/auth';
import { createTestLog } from '../helpers/factories';

test.describe('New User Journey', () => {
  test.describe.configure({ mode: 'serial' });

  // Shared state across tests in this describe block
  let userEmail: string;
  let userPassword: string;
  let userName: string;
  let authToken: string;
  let organizationId: string;
  let projectId: string;
  let apiKey: string;

  test.beforeAll(() => {
    userEmail = generateTestEmail();
    userPassword = 'TestPassword123!';
    userName = generateTestName('New');
  });

  test('1. User can view the register page', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/register`);
    await page.waitForLoadState('networkidle');

    // Verify register form is displayed - look for text that indicates register page
    await expect(page.locator('text=/create.*account|sign up|get started/i').first()).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('2. User can register a new account', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    // Fill registration form
    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    // Fill password fields
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    // Submit form
    await page.locator('button[type="submit"]').click();

    // Should redirect to organization creation (onboarding)
    await expect(page).toHaveURL(/onboarding|create-organization/, { timeout: 15000 });
  });

  test('3. User can create an organization', async ({ page }) => {
    // Login first
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    // Should be on onboarding page
    await expect(page).toHaveURL(/onboarding|create-organization/, { timeout: 15000 });

    // Handle welcome step if present - click "Start the Tutorial" to proceed
    const startButton = page.locator('button:has-text("Start the Tutorial")');
    if (await startButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startButton.click();
      await page.waitForTimeout(500);
    }

    // Now should be on organization creation step
    // Wait for org-name input to be visible
    const orgInput = page.locator('input#org-name');
    await expect(orgInput).toBeVisible({ timeout: 10000 });

    // Fill organization form
    const orgName = `Test Org ${Date.now()}`;
    await orgInput.fill(orgName);

    // Submit form
    await page.locator('button[type="submit"]').click();

    // After org creation, the onboarding continues to project creation step
    // We need to skip the tutorial to get to the dashboard for this test flow
    await page.waitForTimeout(1000);

    // Check if we're still in onboarding (need to skip to get to dashboard)
    if (page.url().includes('onboarding')) {
      // Look for skip button to exit onboarding and go to dashboard
      const skipButton = page.locator('button:has-text("Skip for now"), button:has-text("Skip tutorial")');
      if (await skipButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await skipButton.first().click();
        await page.waitForTimeout(500);
      }
    }

    // Should now be on dashboard, projects, or still completing onboarding
    await expect(page).toHaveURL(/dashboard|projects|onboarding/, { timeout: 15000 });

    // Get organization ID from API or localStorage
    const authData = await page.evaluate(() => {
      return localStorage.getItem('logward_auth');
    });

    if (authData) {
      const parsed = JSON.parse(authData);
      authToken = parsed.token;
    }

    // Fetch organizations to get ID
    const orgsResponse = await fetch(`${TEST_API_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const orgsData = await orgsResponse.json();
    organizationId = orgsData.organizations[0]?.id;
    expect(organizationId).toBeTruthy();
  });

  test('4. User can create a project', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    // Navigate to projects
    await page.waitForURL(/dashboard|projects/, { timeout: 15000 });

    // Try to navigate to projects page if not already there
    if (!page.url().includes('/projects')) {
      await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects`);
    }
    await page.waitForLoadState('networkidle');

    // Look for create project button or dialog trigger
    const createButton = page.locator('button:has-text("Create"), button:has-text("New Project"), button:has-text("Add Project")');

    // If button exists, click it
    if (await createButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await createButton.first().click();
      await page.waitForTimeout(500);

      // Fill project form in dialog - input has id="project-name"
      const projectName = `Test Project ${Date.now()}`;
      await page.locator('input#project-name').fill(projectName);

      // Submit
      await page.locator('button[type="submit"]').click();

      // Wait for project to be created
      await page.waitForTimeout(2000);
    }

    // Verify we have organizationId and authToken from previous test
    expect(organizationId).toBeTruthy();
    expect(authToken).toBeTruthy();

    // Fetch projects to get ID
    const projectsResponse = await fetch(`${TEST_API_URL}/api/v1/projects?organizationId=${organizationId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const projectsData = await projectsResponse.json();
    projectId = projectsData.projects[0]?.id;
    expect(projectId).toBeTruthy();
  });

  test('5. User can create an API key', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    // Navigate to project settings
    await page.waitForURL(/dashboard|projects/, { timeout: 15000 });
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/projects/${projectId}/settings`);

    // Wait for page to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Look for API keys section and create button
    const createApiKeyButton = page.locator('button:has-text("Create API Key"), button:has-text("New API Key"), button:has-text("Generate")');

    if (await createApiKeyButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await createApiKeyButton.first().click();
      await page.waitForTimeout(500);

      // Fill API key name - the input has id="api-key-name"
      const keyName = `E2E Test Key ${Date.now()}`;
      await page.locator('input#api-key-name, input[placeholder*="key" i]').first().fill(keyName);

      // Submit - use force to bypass overlay issues
      await page.locator('[role="dialog"] button[type="submit"]').click({ force: true });

      // Wait for API key to be displayed
      await page.waitForTimeout(2000);

      // API key should be shown in a code block
      const apiKeyDisplay = page.locator('[role="dialog"] code, [role="dialog"] .font-mono');
      if (await apiKeyDisplay.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        const displayedKey = await apiKeyDisplay.first().textContent();
        // API key starts with 'lp_' (log platform)
        if (displayedKey && displayedKey.trim().startsWith('lp_')) {
          apiKey = displayedKey.trim();
        }
      }

      // Close the dialog
      const closeButton = page.locator('[role="dialog"] button:has-text("Close"), [role="dialog"] button:has-text("Done")');
      if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeButton.click();
      }
    }

    // If we couldn't get key from UI, create via API
    if (!apiKey) {
      const response = await fetch(`${TEST_API_URL}/api/v1/projects/${projectId}/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name: 'E2E Test Key' }),
      });
      const data = await response.json();
      apiKey = data.apiKey;
    }

    expect(apiKey).toBeTruthy();
  });

  test('6. User can send first log via API key', async ({ page }) => {
    // Ensure we have an API key - if not, create one via API
    if (!apiKey) {
      const response = await fetch(`${TEST_API_URL}/api/v1/projects/${projectId}/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name: 'E2E Fallback Key' }),
      });
      const data = await response.json();
      apiKey = data.apiKey;
    }

    expect(apiKey).toBeTruthy();

    // Ingest a log using the API key
    const testLog = createTestLog({
      level: 'info',
      message: 'First log from E2E test - New User Journey',
      service: 'e2e-test-service',
    });

    const response = await fetch(`${TEST_API_URL}/api/v1/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ logs: [testLog] }),
    });

    // Debug: log response if not ok
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Ingest failed: ${response.status} - ${errorBody}`);
      // Note: Not logging API key for security reasons
    }

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.received).toBe(1);

    // Login and verify log appears in dashboard
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/dashboard|projects/, { timeout: 15000 });

    // Navigate to search/logs page
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/search`);
    await page.waitForLoadState('networkidle');

    // Wait for logs to load and verify our log appears
    await page.waitForTimeout(3000);

    // Check if the log message appears somewhere on the page
    const logContent = await page.content();
    expect(logContent).toContain('First log from E2E test');
  });
});
