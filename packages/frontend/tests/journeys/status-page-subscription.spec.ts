import { test, expect, TestApiClient, registerUser, generateTestEmail, generateTestName, TEST_API_URL, TEST_FRONTEND_URL } from '../fixtures/auth';

const MAILHOG_API = process.env.TEST_MAILHOG_URL || 'http://localhost:8025';

/**
 * Public status page subscription, double opt-in: a visitor subscribes with
 * an email, gets a confirmation mail (read through the mailhog API), follows
 * the link, and shows up as a confirmed subscriber for the project admins.
 */
test.describe('Status page subscription journey', () => {
  test('a visitor subscribes, confirms by email and is listed as a subscriber', async ({ page }) => {
    // Owner setup: a project with a public status page
    const { token } = await registerUser(generateTestName('Status'), generateTestEmail(), 'TestPassword123!');
    const api = new TestApiClient(token);
    const { organization } = await api.createOrganization(`Status Org ${Date.now()}`);
    const { project } = await api.createProject(organization.id, `Status Project ${Date.now()}`);

    const visibility = await fetch(`${TEST_API_URL}/api/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ statusPageVisibility: 'public' }),
    });
    expect(visibility.ok).toBe(true);

    const orgSlug: string = organization.slug;
    const projectSlug: string = project.slug;
    expect(orgSlug).toBeTruthy();
    expect(projectSlug).toBeTruthy();

    // 1. The public page needs no login and offers the subscribe form
    const subscriber = `visitor-${Date.now()}@e2e.logtide.dev`;
    await page.goto(`${TEST_FRONTEND_URL}/status/${orgSlug}/${projectSlug}`);
    await expect(page.getByRole('heading', { name: 'Subscribe to updates' })).toBeVisible({ timeout: 30000 });

    // 2. A malformed address is rejected before any request
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address');

    // 3. A valid address asks for confirmation
    await page.getByLabel('Email address').fill(subscriber);
    await page.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByText('Check your inbox to confirm')).toBeVisible({ timeout: 15000 });

    // 4. Not confirmed yet: the admin list is still empty
    const listed = async () => {
      const res = await fetch(
        `${TEST_API_URL}/api/v1/status-page/subscribers?organizationId=${organization.id}&projectId=${project.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      expect(res.ok).toBe(true);
      return JSON.stringify(await res.json());
    };
    expect(await listed()).not.toContain(subscriber);

    // 5. The confirmation mail arrives in mailhog
    let confirmPath = '';
    await expect
      .poll(
        async () => {
          const res = await fetch(`${MAILHOG_API}/api/v2/search?kind=to&query=${encodeURIComponent(subscriber)}`);
          const data = await res.json();
          if (!data.total) return '';
          const item = data.items[0];
          const body: string = String(item.Content?.Body ?? '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
          const match = body.match(/https?:\/\/[^\s"<>]+\/status\/[^\s"<>]+\/confirm\?token=[A-Za-z0-9%_.~-]+/);
          if (!match) return '';
          const url = new URL(match[0]);
          confirmPath = `${url.pathname}${url.search}`;
          return confirmPath;
        },
        { timeout: 30000, intervals: [1000] }
      )
      .toContain('/confirm?token=');
    expect(confirmPath).toContain(`/status/${orgSlug}/${projectSlug}/confirm`);

    // 6. Following the link confirms the subscription
    await page.goto(`${TEST_FRONTEND_URL}${confirmPath}`);
    await expect(page.getByRole('heading', { name: 'Subscription confirmed' })).toBeVisible({ timeout: 15000 });

    // 7. The link is single use
    await page.goto(`${TEST_FRONTEND_URL}${confirmPath}`);
    await expect(page.getByRole('heading', { name: 'This link is invalid or has expired' })).toBeVisible({ timeout: 15000 });

    // 8. Now the admin list shows the confirmed subscriber
    expect(await listed()).toContain(subscriber);
  });
});
