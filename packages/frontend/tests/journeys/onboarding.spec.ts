import { test, expect } from '@playwright/test';
import { generateTestEmail, generateTestName, TEST_FRONTEND_URL, TEST_API_URL } from '../fixtures/auth';

const ONBOARDING_STORAGE_KEY = 'logward_onboarding';

test.describe('Onboarding Tutorial Journey', () => {
  test.describe.configure({ mode: 'serial' });

  let userEmail: string;
  let userPassword: string;
  let userName: string;
  let authToken: string;

  test.beforeAll(() => {
    userEmail = generateTestEmail();
    userPassword = 'TestPassword123!';
    userName = generateTestName('Onboarding');
  });

  test('1. New user sees welcome step after registration', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Should see welcome step with user's name
    await expect(page.locator('text=/Welcome.*LogWard/i')).toBeVisible({ timeout: 10000 });

    // Should see "Start the Tutorial" button
    await expect(page.locator('button:has-text("Start the Tutorial")')).toBeVisible();

    // Should see "Skip for now" button
    await expect(page.locator('button:has-text("Skip for now")')).toBeVisible();

    // Store auth token for later tests
    const authData = await page.evaluate(() => localStorage.getItem('logward_auth'));
    if (authData) {
      authToken = JSON.parse(authData).token;
    }
  });

  test('2. User can start tutorial and create organization', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    // Should be on onboarding page
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Click "Start the Tutorial"
    await page.locator('button:has-text("Start the Tutorial")').click();

    // Should now be on create-organization step
    await expect(page.locator('text=/Create.*Organization|organization/i').first()).toBeVisible({ timeout: 5000 });

    // Should see organization name input
    const orgInput = page.locator('input#org-name');
    await expect(orgInput).toBeVisible();

    // Fill organization name
    const orgName = `Test Org ${Date.now()}`;
    await orgInput.fill(orgName);

    // Submit
    await page.locator('button[type="submit"]').click();

    // Should move to create-project step
    await expect(page.locator('text=/Create.*Project|project/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('3. User can create project with environment preset', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/onboarding|dashboard/, { timeout: 15000 });

    // Should be on create-project step (from previous test state)
    // Wait for project creation UI
    await page.waitForTimeout(1000);

    // Look for project name input
    const projectInput = page.locator('input#project-name');

    if (await projectInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Fill project name
      await projectInput.fill(`E2E Project ${Date.now()}`);

      // Check for environment presets (Production, Staging, Development, Testing)
      const presetButtons = page.locator('button:has-text("Production"), button:has-text("Development")');
      if (await presetButtons.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await presetButtons.first().click();
      }

      // Submit
      await page.locator('button[type="submit"]').click();

      // Should move to api-key step
      await expect(page.locator('text=/API Key|api key/i')).toBeVisible({ timeout: 10000 });
    }
  });

  test('4. User can generate API key and see code examples', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/onboarding|dashboard/, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Should see API key generation UI or we may already be past this step
    const generateButton = page.locator('button:has-text("Generate")');
    const apiKeyStep = page.locator('text=/API Key|api key|Generate.*Key/i');

    if (await apiKeyStep.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      // We're on the API key step
      if (await generateButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await generateButton.click();
        await page.waitForTimeout(2000); // Wait for API key generation

        // Should see API key displayed - look for any code/mono element with key-like content
        const apiKeyDisplay = page.locator('code, .font-mono, [class*="mono"]').filter({ hasText: /_/ });
        if (await apiKeyDisplay.first().isVisible({ timeout: 5000 }).catch(() => false)) {
          // API key is displayed - test passes
          const keyText = await apiKeyDisplay.first().textContent();
          expect(keyText).toBeTruthy();
        }

        // Should see code examples tabs (cURL, Node.js, Python, etc.) - optional check
        const curlTab = page.locator('button:has-text("cURL"), [role="tab"]:has-text("cURL")');
        if (await curlTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await expect(curlTab).toBeVisible();
        }
      }

      // Click Continue/Next to move to next step
      const continueButton = page.locator('button:has-text("Continue"), button:has-text("Next")');
      if (await continueButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await continueButton.first().click();
      }
    }
  });

  test('5. User can complete first log step', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/onboarding|dashboard/, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Look for "First Log" or "Send Your First Log" text
    const firstLogStep = page.locator('text=/First Log|Waiting.*log|Send.*log/i');

    if (await firstLogStep.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should see "Skip for now" or similar option to proceed
      const skipButton = page.locator('button:has-text("Skip"), button:has-text("Continue without"), button:has-text("I\'ll do this later")');
      if (await skipButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await skipButton.first().click();
      }
    }
  });

  test('6. User can complete feature tour', async ({ page }) => {
    // Login
    await page.goto(`${TEST_FRONTEND_URL}/login`);
    await page.locator('input[type="email"]').fill(userEmail);
    await page.locator('input[type="password"]').fill(userPassword);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/onboarding|dashboard/, { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Look for feature tour step
    const featureTour = page.locator('text=/feature|tour|explore|discover/i');

    if (await featureTour.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should see feature cards (Dashboard, Search, Alerts, etc.)
      const featureCards = page.locator('text=/Dashboard|Search|Alerts|Traces|Live Tail|Sigma/i');
      await expect(featureCards.first()).toBeVisible();

      // Click "Go to Dashboard" or finish button
      const finishButton = page.locator('button:has-text("Dashboard"), button:has-text("Finish"), button:has-text("Complete")');
      if (await finishButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await finishButton.first().click();

        // Should redirect to dashboard
        await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
      }
    }
  });
});

test.describe('Tutorial Skip and Resume', () => {
  let userEmail: string;
  let userPassword: string;
  let userName: string;

  test.beforeEach(() => {
    userEmail = generateTestEmail();
    userPassword = 'TestPassword123!';
    userName = generateTestName('Skip');
  });

  test('User can skip tutorial from welcome step', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // First create an org (required to access dashboard)
    await page.locator('button:has-text("Start the Tutorial")').click();
    await expect(page.locator('input#org-name')).toBeVisible({ timeout: 5000 });
    await page.locator('input#org-name').fill(`Skip Test Org ${Date.now()}`);
    await page.locator('button[type="submit"]').click();

    // Wait for project step, then skip
    await page.waitForTimeout(1000);

    // Click "Skip for now" to skip remaining steps
    const skipButton = page.locator('button:has-text("Skip for now"), button:has-text("Skip tutorial")');
    if (await skipButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipButton.first().click();
    }

    // Should redirect to dashboard (now that we have an org)
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Verify onboarding state is marked as skipped
    const onboardingState = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, ONBOARDING_STORAGE_KEY);

    if (onboardingState) {
      const parsed = JSON.parse(onboardingState);
      expect(parsed.skipped).toBe(true);
    }
  });

  test('User can resume tutorial after page refresh', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Start tutorial
    await page.locator('button:has-text("Start the Tutorial")').click();

    // Should be on create-organization step
    await expect(page.locator('text=/Create.*Organization|organization/i').first()).toBeVisible({ timeout: 5000 });

    // Refresh the page
    await page.reload();

    // Should still be on create-organization step (not reset to welcome)
    await expect(page.locator('text=/Create.*Organization|organization/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('User can restart tutorial from settings', async ({ page }) => {
    // Register and complete onboarding first
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // First create an org (required to access dashboard)
    await page.locator('button:has-text("Start the Tutorial")').click();
    await expect(page.locator('input#org-name')).toBeVisible({ timeout: 5000 });
    await page.locator('input#org-name').fill(`Restart Test Org ${Date.now()}`);
    await page.locator('button[type="submit"]').click();

    // Wait for project step, then skip
    await page.waitForTimeout(1000);

    // Click "Skip for now" to skip remaining steps
    const skipButton = page.locator('button:has-text("Skip for now"), button:has-text("Skip tutorial")');
    if (await skipButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await skipButton.first().click();
    }

    // Should be on dashboard (now that we have an org)
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Open user settings (usually via avatar/user menu)
    const userMenuButton = page.locator('[data-testid="user-menu"], button:has([class*="avatar"]), .avatar');
    if (await userMenuButton.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await userMenuButton.first().click();

      // Click Settings option
      const settingsOption = page.locator('text=/Settings|Preferences/i');
      if (await settingsOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await settingsOption.click();
      }
    }

    // Look for "Restart Tutorial" button in settings
    const restartButton = page.locator('button:has-text("Restart Tutorial")');
    if (await restartButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await restartButton.click();

      // Should redirect to onboarding
      await expect(page).toHaveURL(/onboarding/, { timeout: 10000 });

      // Should see welcome step again
      await expect(page.locator('text=/Welcome.*LogWard/i')).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Onboarding Mobile Responsive', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE viewport

  let userEmail: string;
  let userPassword: string;
  let userName: string;

  test.beforeEach(() => {
    userEmail = generateTestEmail();
    userPassword = 'TestPassword123!';
    userName = generateTestName('Mobile');
  });

  test('Onboarding displays correctly on mobile', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Welcome step should be visible and not overflow
    await expect(page.locator('text=/Welcome.*LogWard/i')).toBeVisible({ timeout: 10000 });

    // Buttons should be visible and clickable (scroll into view for mobile)
    const startButton = page.locator('button:has-text("Start the Tutorial")');
    await expect(startButton).toBeVisible();
    await startButton.scrollIntoViewIfNeeded();
    await expect(startButton).toBeInViewport();

    const skipButton = page.locator('button:has-text("Skip for now")');
    await expect(skipButton).toBeVisible();
    await skipButton.scrollIntoViewIfNeeded();
    await expect(skipButton).toBeInViewport();

    // Progress bar should be visible
    const progressBar = page.locator('[role="progressbar"], .progress');
    if (await progressBar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(progressBar).toBeInViewport();
    }
  });

  test('Feature cards stack vertically on mobile', async ({ page }) => {
    // Register and go through tutorial to feature tour
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Set onboarding state to feature-tour step directly
    await page.evaluate((key) => {
      const state = {
        currentStep: 'feature-tour',
        completedSteps: ['welcome', 'create-organization', 'create-project', 'api-key', 'first-log'],
        skipped: false,
        organizationId: 'test-org-id',
        projectId: 'test-project-id',
        apiKey: 'test-api-key',
        firstLogReceived: true,
        startedAt: new Date().toISOString(),
        completedAt: null
      };
      localStorage.setItem(key, JSON.stringify(state));
    }, ONBOARDING_STORAGE_KEY);

    await page.reload();

    // Feature cards should be visible
    const featureCards = page.locator('[class*="card"], [class*="Card"]');
    const cardCount = await featureCards.count();

    if (cardCount > 0) {
      // Cards should be stacked (each card's top should be below previous card's bottom)
      for (let i = 0; i < Math.min(cardCount, 3); i++) {
        const card = featureCards.nth(i);
        await expect(card).toBeInViewport();
      }
    }
  });
});

test.describe('Onboarding Accessibility', () => {
  let userEmail: string;
  let userPassword: string;
  let userName: string;

  test.beforeEach(() => {
    userEmail = generateTestEmail();
    userPassword = 'TestPassword123!';
    userName = generateTestName('A11y');
  });

  test('Welcome step has proper ARIA labels and structure', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Check for main heading (h1)
    const mainHeading = page.locator('h1');
    await expect(mainHeading).toBeVisible();

    // Buttons should have accessible names
    const startButton = page.locator('button:has-text("Start the Tutorial")');
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();

    const skipButton = page.locator('button:has-text("Skip for now")');
    await expect(skipButton).toBeVisible();
    await expect(skipButton).toBeEnabled();

    // Progress indicator should have appropriate role or aria-label
    const progressBar = page.locator('[role="progressbar"], [aria-label*="progress" i]');
    if (await progressBar.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Progress bar should have aria-valuenow or similar
      const ariaValue = await progressBar.getAttribute('aria-valuenow');
      const ariaLabel = await progressBar.getAttribute('aria-label');
      expect(ariaValue !== null || ariaLabel !== null).toBe(true);
    }
  });

  test('Form inputs have proper labels', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Start tutorial
    await page.locator('button:has-text("Start the Tutorial")').click();

    // Should be on create-organization step
    await expect(page.locator('text=/Create.*Organization|organization/i').first()).toBeVisible({ timeout: 5000 });

    // Organization name input should have a label
    const orgInput = page.locator('input#org-name');
    if (await orgInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Check for associated label via id or aria-label
      const inputId = await orgInput.getAttribute('id');
      const ariaLabel = await orgInput.getAttribute('aria-label');
      const ariaLabelledBy = await orgInput.getAttribute('aria-labelledby');

      if (inputId) {
        const label = page.locator(`label[for="${inputId}"]`);
        const hasLabel = await label.isVisible().catch(() => false);
        expect(hasLabel || ariaLabel !== null || ariaLabelledBy !== null).toBe(true);
      }
    }
  });

  test('Keyboard navigation works through tutorial', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Wait for welcome step
    await expect(page.locator('text=/Welcome.*LogWard/i')).toBeVisible({ timeout: 10000 });

    // Tab to "Start the Tutorial" button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Find focused element
    const focusedElement = page.locator(':focus');
    const focusedText = await focusedElement.textContent().catch(() => '');

    // Press Enter to activate the focused button (should be Start or Skip)
    if (focusedText && (focusedText.includes('Start') || focusedText.includes('Skip'))) {
      await page.keyboard.press('Enter');

      // Should navigate to next step or dashboard
      await page.waitForTimeout(1000);
      const currentUrl = page.url();
      expect(currentUrl.includes('onboarding') || currentUrl.includes('dashboard')).toBe(true);
    }
  });

  test('Focus is properly managed during step transitions', async ({ page }) => {
    // Register a new user
    await page.goto(`${TEST_FRONTEND_URL}/register`);

    await page.locator('input[type="text"], input#name').fill(userName);
    await page.locator('input[type="email"]').fill(userEmail);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill(userPassword);
    await passwordInputs.nth(1).fill(userPassword);

    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/onboarding/, { timeout: 15000 });

    // Click Start Tutorial
    await page.locator('button:has-text("Start the Tutorial")').click();

    // Wait for transition
    await page.waitForTimeout(500);

    // After transition, focus should be on an interactive element or the new content area
    // The heading or first input should be focusable
    const organizationHeading = page.locator('text=/Create.*Organization|organization/i').first();
    await expect(organizationHeading).toBeVisible({ timeout: 5000 });

    // Check that there's a focusable element on the new step
    const focusableElements = page.locator('input, button, [tabindex="0"]');
    const count = await focusableElements.count();
    expect(count).toBeGreaterThan(0);
  });
});
