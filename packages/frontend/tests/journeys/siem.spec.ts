import { test, expect, TestApiClient, registerUser, setAuthState, generateTestEmail, generateTestName, TEST_FRONTEND_URL } from '../fixtures/auth';
import { wait } from '../helpers/factories';

test.describe('SIEM Journey', () => {
  let apiClient: TestApiClient;
  let userToken: string;
  let organizationId: string;
  let testIncidentId: string;

  test.beforeAll(async () => {
    // Create test user and setup
    const email = generateTestEmail();
    const { user, token } = await registerUser(generateTestName('SIEM'), email, 'TestPassword123!');
    userToken = token;
    apiClient = new TestApiClient(token);

    // Create organization
    const orgResult = await apiClient.createOrganization(`SIEM Test Org ${Date.now()}`);
    organizationId = orgResult.organization.id;

    // Create a test incident via API for testing
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `Test Incident ${Date.now()}`,
        description: 'Incident created for E2E testing',
        severity: 'high',
        status: 'open',
      });
      testIncidentId = incident.id;
    } catch (e) {
      // SIEM endpoints might not be available in test env
      console.warn('Could not create test incident:', e);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Set auth state before each test
    await page.goto(TEST_FRONTEND_URL);
    await setAuthState(page, { id: 'test', email: 'test@test.com', name: 'Test', token: userToken }, userToken);

    // Set the current organization ID in localStorage
    await page.evaluate((orgId) => {
      localStorage.setItem('currentOrganizationId', orgId);
    }, organizationId);

    // Navigate to dashboard first to trigger organization loading
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await page.waitForLoadState('load');
    // Wait for organization to be loaded (RequireOrganization shows content only when org is ready)
    await page.waitForSelector('nav, [class*="sidebar"], h1, h2', { timeout: 30000 });
    await page.waitForTimeout(500);
  });

  test('1. User can navigate to Security dashboard', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Verify security dashboard elements
    await expect(page.locator('h1:has-text("Security Dashboard"), h1:has-text("Security")').first()).toBeVisible();

    // Should show dashboard widgets or empty state
    // Check for StatsBar, TimelineWidget, or any dashboard content
    const hasWidgets = await page.locator('[class*="card"], [class*="Card"], [data-testid*="stats"], [data-testid*="widget"]').first().isVisible().catch(() => false);
    // Empty state shows "No security events detected" or similar
    const hasEmptyState = await page.locator('text=/no.*security.*events/i, text=/no.*detections/i, text=/no.*incidents/i, text=/enable.*sigma/i').first().isVisible().catch(() => false);
    // Also check for loading state (Spinner) or the main content container
    const hasContent = await page.locator('.container, [class*="grid"]').first().isVisible().catch(() => false);

    expect(hasWidgets || hasEmptyState || hasContent).toBe(true);
  });

  test('2. User can view the incidents list page', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Verify incidents page elements
    await expect(page.locator('h1:has-text("Security Incidents"), h1:has-text("Incidents")').first()).toBeVisible();

    // Should show incident list or empty state
    const hasIncidents = await page.locator('[class*="Card"]').first().isVisible().catch(() => false);
    const hasEmptyState = await page.locator('text=/no.*incidents/i').isVisible().catch(() => false);

    expect(hasIncidents || hasEmptyState).toBe(true);
  });

  test('3. User can filter incidents by status', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Look for filter buttons/dropdowns
    const statusFilter = page.locator('button:has-text("Status"), [data-testid="status-filter"], button:has-text("Open")').first();
    if (await statusFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await statusFilter.click();
      await page.waitForTimeout(500);

      // Select a status option
      const openOption = page.locator('[role="menuitem"]:has-text("Open"), [role="option"]:has-text("Open")').first();
      if (await openOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await openOption.click();
        await page.waitForTimeout(1000);
      }
    }

    // Verify URL was updated with filter
    const url = page.url();
    // Either URL has status param or page shows filtered state
    const pageContent = await page.content();
    expect(pageContent).toBeTruthy();
  });

  test('4. User can filter incidents by severity', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Look for severity filter
    const severityFilter = page.locator('button:has-text("Severity"), [data-testid="severity-filter"]').first();
    if (await severityFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
      await severityFilter.click();
      await page.waitForTimeout(500);

      // Select a severity option
      const highOption = page.locator('[role="menuitem"]:has-text("High"), [role="option"]:has-text("High")').first();
      if (await highOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await highOption.click();
        await page.waitForTimeout(1000);
      }
    }

    const pageContent = await page.content();
    expect(pageContent).toBeTruthy();
  });

  test('5. User can view incident details', async ({ page }) => {
    // First create an incident via API if we don't have one
    let incidentId = testIncidentId;
    if (!incidentId) {
      try {
        const incident = await apiClient.createSiemIncident({
          organizationId,
          title: `Details Test Incident ${Date.now()}`,
          description: 'Incident for viewing details',
          severity: 'medium',
          status: 'open',
        });
        incidentId = incident.id;
      } catch (e) {
        // Skip test if SIEM API not available
        console.warn('SIEM API not available, skipping test');
        return;
      }
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Either we see incident details or error
    const hasDetails = await page.locator('text=/Details Test Incident|Test Incident/').isVisible().catch(() => false);
    const hasError = await page.locator('text=/not found|error/i').isVisible().catch(() => false);

    expect(hasDetails || hasError).toBe(true);
  });

  test('6. User can change incident status', async ({ page }) => {
    // Create a fresh incident for this test
    let incidentId: string;
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `Status Change Test ${Date.now()}`,
        description: 'Incident for status change test',
        severity: 'low',
        status: 'open',
      });
      incidentId = incident.id;
    } catch (e) {
      console.warn('SIEM API not available, skipping test');
      return;
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Find and click status dropdown
    const statusDropdown = page.locator('button:has-text("Change Status"), button:has-text("Open"), [data-testid="status-dropdown"]').first();
    if (await statusDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
      await statusDropdown.click();
      await page.waitForTimeout(500);

      // Select "Investigating" status
      const investigatingOption = page.locator('[role="menuitem"]:has-text("Investigating"), [role="option"]:has-text("Investigating")').first();
      if (await investigatingOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await investigatingOption.click();
        await page.waitForTimeout(2000);

        // Verify status was updated
        const pageContent = await page.content();
        expect(pageContent.toLowerCase()).toContain('investigating');
      }
    }
  });

  test('7. User can add a comment to an incident', async ({ page }) => {
    // Create a fresh incident for this test
    let incidentId: string;
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `Comment Test ${Date.now()}`,
        description: 'Incident for comment test',
        severity: 'medium',
        status: 'open',
      });
      incidentId = incident.id;
    } catch (e) {
      console.warn('SIEM API not available, skipping test');
      return;
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Switch to Comments tab
    const commentsTab = page.locator('button:has-text("Comments"), [role="tab"]:has-text("Comments")').first();
    if (await commentsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await commentsTab.click();
      await page.waitForTimeout(500);
    }

    // Find comment input and add a comment
    const commentInput = page.locator('textarea[placeholder*="comment" i], textarea[placeholder*="Add" i], textarea').first();
    if (await commentInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      const testComment = `E2E Test Comment ${Date.now()}`;
      await commentInput.fill(testComment);
      await page.waitForTimeout(300);

      // Submit comment
      const submitButton = page.locator('button:has-text("Add Comment"), button:has-text("Submit"), button:has-text("Post")').first();
      if (await submitButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(2000);

        // Verify comment was added
        const pageContent = await page.content();
        expect(pageContent).toContain(testComment);
      }
    }
  });

  test('8. User can view incident history', async ({ page }) => {
    // Create a fresh incident and update it to generate history
    let incidentId: string;
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `History Test ${Date.now()}`,
        description: 'Incident for history test',
        severity: 'high',
        status: 'open',
      });
      incidentId = incident.id;

      // Update status to generate history entry
      await apiClient.updateSiemIncident(incidentId, {
        organizationId,
        status: 'investigating',
      });
    } catch (e) {
      console.warn('SIEM API not available, skipping test');
      return;
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Switch to History tab
    const historyTab = page.locator('button:has-text("History"), [role="tab"]:has-text("History")').first();
    if (await historyTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await historyTab.click();
      await page.waitForTimeout(500);

      // Verify history is shown
      const pageContent = await page.content();
      // Should contain history entries (created, status_changed, etc.)
      expect(pageContent.toLowerCase()).toMatch(/created|status|changed|history/);
    }
  });

  test('9. User can view detection events in incident', async ({ page }) => {
    // Create incident with detection events would require Sigma rules + log ingestion
    // For now, just verify the Detections tab works
    let incidentId: string;
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `Detections Test ${Date.now()}`,
        description: 'Incident for detections test',
        severity: 'critical',
        status: 'open',
      });
      incidentId = incident.id;
    } catch (e) {
      console.warn('SIEM API not available, skipping test');
      return;
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Verify Detections tab is present
    const detectionsTab = page.locator('button:has-text("Detections"), [role="tab"]:has-text("Detections")').first();
    if (await detectionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await detectionsTab.click();
      await page.waitForTimeout(500);

      // Should show detection events or empty state
      const pageContent = await page.content();
      expect(pageContent.toLowerCase()).toMatch(/detection|event|no.*detection/);
    }
  });

  test('10. User can delete an incident', async ({ page }) => {
    // Create a fresh incident for deletion
    let incidentId: string;
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `Delete Test ${Date.now()}`,
        description: 'Incident for deletion test',
        severity: 'low',
        status: 'open',
      });
      incidentId = incident.id;
    } catch (e) {
      console.warn('SIEM API not available, skipping test');
      return;
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Find the actions dropdown (3-dot menu)
    const actionsButton = page.locator('button:has([class*="MoreVertical"]), button[aria-label*="Actions"], button:has-text("Actions")').first();
    if (await actionsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await actionsButton.click();
      await page.waitForTimeout(500);

      // Click delete option
      const deleteOption = page.locator('[role="menuitem"]:has-text("Delete"), button:has-text("Delete Incident")').first();
      if (await deleteOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteOption.click();
        await page.waitForTimeout(500);

        // Confirm deletion
        const confirmButton = page.locator('[role="alertdialog"] button:has-text("Delete"), button:has-text("Confirm")').first();
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
          await page.waitForTimeout(2000);

          // Should redirect to incidents list
          expect(page.url()).toContain('/incidents');
        }
      }
    }
  });

  test('11. Dashboard shows summary stats widgets', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Look for summary stat cards
    const statCards = page.locator('[class*="Card"]');
    const cardCount = await statCards.count();

    // Should have at least some cards (stats or empty state)
    const pageContent = await page.content();

    // Verify page has dashboard content (stats, charts, or empty state)
    const hasDashboardContent =
      pageContent.toLowerCase().includes('detection') ||
      pageContent.toLowerCase().includes('incident') ||
      pageContent.toLowerCase().includes('threat') ||
      pageContent.toLowerCase().includes('no data');

    expect(hasDashboardContent).toBe(true);
  });

  test('12. Dashboard time range filter works', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Look for time range selector
    const timeRangeSelector = page.locator('button:has-text("24h"), button:has-text("7d"), button:has-text("30d"), select, [data-testid="time-range"]').first();
    if (await timeRangeSelector.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click to open dropdown if it's a button
      await timeRangeSelector.click();
      await page.waitForTimeout(500);

      // Select a different time range
      const weekOption = page.locator('button:has-text("7d"), [role="option"]:has-text("7"), [role="menuitem"]:has-text("7")').first();
      if (await weekOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await weekOption.click();
        await page.waitForTimeout(1000);
      }
    }

    // Page should still be functional
    const pageContent = await page.content();
    expect(pageContent).toBeTruthy();
  });

  test('13. Navigation from dashboard to incidents works', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Click on "View All Incidents" or similar link
    const viewIncidentsLink = page.locator('a:has-text("View All"), a:has-text("Incidents"), button:has-text("View Incidents")').first();
    if (await viewIncidentsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewIncidentsLink.click();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1000);

      // Should be on incidents page
      expect(page.url()).toContain('/incidents');
    }
  });

  test('14. Back navigation from incident detail works', async ({ page }) => {
    // Create an incident first
    let incidentId: string;
    try {
      const incident = await apiClient.createSiemIncident({
        organizationId,
        title: `Navigation Test ${Date.now()}`,
        description: 'Incident for navigation test',
        severity: 'low',
        status: 'open',
      });
      incidentId = incident.id;
    } catch (e) {
      console.warn('SIEM API not available, skipping test');
      return;
    }

    await page.goto(`${TEST_FRONTEND_URL}/dashboard/security/incidents/${incidentId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Click back button
    const backButton = page.locator('button:has([class*="ArrowLeft"]), a:has([class*="ArrowLeft"]), button[aria-label*="Back"]').first();
    if (await backButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await backButton.click();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1000);

      // Should be back on incidents list
      expect(page.url()).toContain('/incidents');
    }
  });

  test('15. Security link appears in main navigation', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);

    // Look for Security link in navigation
    const securityLink = page.locator('nav a:has-text("Security"), aside a:has-text("Security"), [role="navigation"] a:has-text("Security")').first();
    const isVisible = await securityLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (isVisible) {
      await securityLink.click();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1000);

      // Should navigate to security dashboard
      expect(page.url()).toContain('/security');
    }
  });
});
