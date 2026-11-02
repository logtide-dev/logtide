import { test, expect, type Page } from '@playwright/test';
import {
  registerUser,
  setAuthState,
  TestApiClient,
  generateTestEmail,
  generateTestName,
  TEST_FRONTEND_URL,
  type TestUser,
} from '../fixtures/auth';
import { generateId } from '../helpers/factories';

const PASSWORD = 'TestPassword123!';

/** Authenticate the browser as the given user with the given organization selected. */
async function loginBrowserAs(page: Page, user: TestUser, organizationId?: string) {
  await page.goto(TEST_FRONTEND_URL);
  await setAuthState(page, user, user.token);
  if (organizationId) {
    await page.evaluate((orgId) => localStorage.setItem('currentOrganizationId', orgId), organizationId);
  }
}

/** Invite an email through the API and return the pending invitation (the list never exposes tokens). */
async function seedInvitation(
  api: TestApiClient,
  organizationId: string,
  email: string,
  role: 'admin' | 'member' = 'member'
) {
  await api.inviteUser(organizationId, email, role);
  const { invitations } = await api.getPendingInvitations(organizationId);
  const invitation = invitations.find((i) => i.email === email);
  expect(invitation, `invitation for ${email} should exist after seeding`).toBeTruthy();
  return invitation;
}

/**
 * Register a user, invite them and return the invite token. Existing users get an in-app
 * notification carrying the invite link, which is the only way to obtain the token.
 */
async function seedInvitedUser(
  ownerApi: TestApiClient,
  organizationId: string,
  role: 'admin' | 'member' = 'member',
  nameSeed = 'Invitee'
) {
  const email = generateTestEmail();
  const name = `${nameSeed} ${generateId()}`;
  const { user } = await registerUser(name, email, PASSWORD);
  const api = new TestApiClient(user.token);
  await seedInvitation(ownerApi, organizationId, email, role);
  const { notifications } = await api.getNotifications();
  const note = notifications.find((n) => n.type === 'organization_invite' && n.organizationId === organizationId);
  expect(note, 'invited user should get an organization_invite notification').toBeTruthy();
  const token = String(note.metadata.link).replace('/invite/', '');
  expect(token).toBeTruthy();
  return { email, name, user, api, token };
}

async function openMembersPage(page: Page) {
  await page.goto(`${TEST_FRONTEND_URL}/dashboard/settings/members`);
  await expect(page).toHaveURL(/\/dashboard\/settings\/members/);
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
}

async function openPendingInvitations(page: Page) {
  await page.getByRole('tab', { name: /Pending invitations/ }).click();
}

test.describe('Invitations Journey', () => {
  let owner: TestUser;
  let ownerApiClient: TestApiClient;
  let organizationId: string;
  let organizationName: string;

  test.beforeAll(async () => {
    const registered = await registerUser(generateTestName('Owner'), generateTestEmail(), PASSWORD);
    owner = registered.user;
    ownerApiClient = new TestApiClient(registered.token);

    organizationName = `Invite Test Org ${generateId()}`;
    const orgResult = await ownerApiClient.createOrganization(organizationName);
    organizationId = orgResult.organization.id;
  });

  test.beforeEach(async ({ page }) => {
    await loginBrowserAs(page, owner, organizationId);
  });

  test('1. /dashboard/settings opens the General page of the organization', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/settings`);

    await expect(page).toHaveURL(/\/dashboard\/settings\/general/);
    await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  });

  test('2. Owner can invite a new member via the UI', async ({ page }) => {
    const inviteEmail = generateTestEmail();
    await openMembersPage(page);

    await page.getByRole('button', { name: 'Invite member', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Invite member' })).toBeVisible();
    await dialog.getByLabel('Email address').fill(inviteEmail);
    await dialog.getByLabel('Role').selectOption('admin');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();

    // The dialog reports success, then closes on its own
    await expect(dialog.getByText(/invitation|sent|notified/i).first()).toBeVisible();
    await expect(dialog).toBeHidden();

    // The invitation is listed with the chosen role
    await openPendingInvitations(page);
    const row = page.getByRole('row').filter({ hasText: inviteEmail });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Admin');

    // And it exists on the server
    const { invitations } = await ownerApiClient.getPendingInvitations(organizationId);
    const created = invitations.find((i) => i.email === inviteEmail);
    expect(created, 'invitation should exist in the API').toBeTruthy();
    expect(created.role).toBe('admin');
  });

  test('3. Owner sees a seeded pending invitation with its role', async ({ page }) => {
    const inviteEmail = generateTestEmail();
    await seedInvitation(ownerApiClient, organizationId, inviteEmail, 'member');

    await openMembersPage(page);
    await openPendingInvitations(page);

    const row = page.getByRole('row').filter({ hasText: inviteEmail });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Member');
    await expect(row.getByRole('button', { name: 'Revoke invitation' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Resend invitation' })).toBeVisible();
  });

  test('4. Owner can revoke a pending invitation', async ({ page }) => {
    const inviteEmail = generateTestEmail();
    const keepEmail = generateTestEmail();
    await seedInvitation(ownerApiClient, organizationId, inviteEmail, 'member');
    await seedInvitation(ownerApiClient, organizationId, keepEmail, 'member');

    await openMembersPage(page);
    await openPendingInvitations(page);
    const row = page.getByRole('row').filter({ hasText: inviteEmail });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Revoke invitation' }).click();

    await expect(page.getByText('Invitation revoked')).toBeVisible();
    await expect(row).toHaveCount(0);
    // Only the targeted invitation went away
    await expect(page.getByRole('row').filter({ hasText: keepEmail })).toHaveCount(1);

    const { invitations } = await ownerApiClient.getPendingInvitations(organizationId);
    expect(invitations.map((i) => i.email)).not.toContain(inviteEmail);
    expect(invitations.map((i) => i.email)).toContain(keepEmail);
  });

  test('5. Invitation page for a logged out visitor shows the invite and sends them to login', async ({ browser }) => {
    // Fresh context: nothing from the owner session can leak into the visitor's page
    const context = await browser.newContext();
    const page = await context.newPage();
    const invitation = await seedInvitedUser(ownerApiClient, organizationId, 'member');

    await page.goto(`${TEST_FRONTEND_URL}/invite/${invitation.token}`);

    await expect(page.getByText("You're invited")).toBeVisible();
    await expect(page.getByRole('heading', { name: organizationName })).toBeVisible();
    await expect(page.getByText('Your role')).toBeVisible();
    await expect(page.getByText('member', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Register here' })).toHaveAttribute(
      'href',
      `/register?redirect=/invite/${invitation.token}`
    );

    await page.getByRole('button', { name: 'Log in to accept' }).click();
    await expect(page).toHaveURL(/\/login\?redirect=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('redirect') as string)).toBe(
      `/invite/${invitation.token}`
    );
    await context.close();
  });

  test('6. Invitation page shows an error for an invalid token', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${TEST_FRONTEND_URL}/invite/invalid-token-${generateId()}`);

    await expect(page.getByText('Invitation not found')).toBeVisible();
    await expect(page.getByText('This invitation is invalid or has expired.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to login' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log in to accept' })).toHaveCount(0);
    await context.close();
  });

  test('7. Invited user can accept the invitation and becomes a member', async ({ page }) => {
    const invitation = await seedInvitedUser(ownerApiClient, organizationId, 'member', 'NewMember');
    const { user: newUser, api: newUserApi, email: newUserEmail } = invitation;

    await loginBrowserAs(page, newUser);
    await page.goto(`${TEST_FRONTEND_URL}/invite/${invitation.token}`);

    await expect(page.getByRole('heading', { name: organizationName })).toBeVisible();
    await page.getByRole('button', { name: 'Accept invitation' }).click();

    await expect(page.getByText(`Welcome to ${organizationName}`)).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // The user is now a member with the invited role, and the invitation is consumed
    const { members } = await ownerApiClient.getOrganizationMembers(organizationId);
    const membership = members.find((m) => m.user.email === newUserEmail);
    expect(membership, 'new user should be a member').toBeTruthy();
    expect(membership.role).toBe('member');

    const { organizations } = await newUserApi.getOrganizations();
    expect(organizations.map((o) => o.id)).toContain(organizationId);

    const { invitations } = await ownerApiClient.getPendingInvitations(organizationId);
    expect(invitations.map((i) => i.email)).not.toContain(newUserEmail);
  });

  test('8. Invitation page warns when logged in as a different user', async ({ page }) => {
    const invitation = await seedInvitedUser(ownerApiClient, organizationId, 'member');
    const invitedEmail = invitation.email;
    const { user: stranger } = await registerUser(generateTestName('Stranger'), generateTestEmail(), PASSWORD);

    await loginBrowserAs(page, stranger);
    await page.goto(`${TEST_FRONTEND_URL}/invite/${invitation.token}`);

    await expect(page.getByText('Email mismatch')).toBeVisible();
    await expect(page.getByText(invitedEmail)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log out and switch account' })).toBeVisible();
  });

  test('9. General settings show the organization name', async ({ page }) => {
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/settings/general`);

    await expect(page.getByLabel('Organization name')).toHaveValue(organizationName);
  });

  // Keep this last: it renames the shared organization.
  test('10. Owner can rename the organization and the change persists', async ({ page }) => {
    const newName = `Renamed Org ${generateId()}`;
    await page.goto(`${TEST_FRONTEND_URL}/dashboard/settings/general`);

    const nameInput = page.getByLabel('Organization name');
    await expect(nameInput).toHaveValue(organizationName);
    await nameInput.fill(newName);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Organization updated')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Organization name')).toHaveValue(newName);

    const { organizations } = await ownerApiClient.getOrganizations();
    expect(organizations.find((o) => o.id === organizationId)?.name).toBe(newName);
    organizationName = newName;
  });
});

test.describe('Member Management', () => {
  let owner: TestUser;
  let ownerApiClient: TestApiClient;
  let organizationId: string;

  test.beforeAll(async () => {
    const registered = await registerUser(generateTestName('MemberOwner'), generateTestEmail(), PASSWORD);
    owner = registered.user;
    ownerApiClient = new TestApiClient(registered.token);
    const orgResult = await ownerApiClient.createOrganization(`Member Test Org ${generateId()}`);
    organizationId = orgResult.organization.id;
  });

  test.beforeEach(async ({ page }) => {
    await loginBrowserAs(page, owner, organizationId);
  });

  /** Create a user and make them a member through the invitation API. */
  async function addMember(role: 'admin' | 'member' = 'member') {
    const invitee = await seedInvitedUser(ownerApiClient, organizationId, role, 'Member');
    await invitee.api.acceptInvitation(invitee.token);
    return { email: invitee.email, name: invitee.name, user: invitee.user };
  }

  test('1. Owner appears in the member list with the Owner role', async ({ page }) => {
    await openMembersPage(page);

    const ownerRow = page.getByRole('row').filter({ hasText: owner.email });
    await expect(ownerRow).toHaveCount(1);
    await expect(ownerRow).toContainText('Owner');
    await expect(ownerRow).toContainText('You');
    // Nobody can act on the owner row
    await expect(ownerRow.getByRole('button')).toHaveCount(0);
  });

  test('2. Owner can promote a member to admin from the actions menu', async ({ page }) => {
    const member = await addMember('member');

    await openMembersPage(page);
    const row = page.getByRole('row').filter({ hasText: member.email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Member');

    await row.getByRole('button', { name: `Member actions for ${member.name}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Transfer ownership' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Remove from organization' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Promote to admin' }).click();

    await expect(page.getByText('Member role updated')).toBeVisible();
    await expect(row).toContainText('Admin');

    const { members } = await ownerApiClient.getOrganizationMembers(organizationId);
    expect(members.find((m) => m.user.email === member.email)?.role).toBe('admin');
  });

  test('3. Owner can remove a member', async ({ page }) => {
    const member = await addMember('member');

    await openMembersPage(page);
    const row = page.getByRole('row').filter({ hasText: member.email });
    await row.getByRole('button', { name: `Member actions for ${member.name}` }).click();
    await page.getByRole('menuitem', { name: 'Remove from organization' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(member.name);
    await dialog.getByRole('button', { name: 'Remove member' }).click();

    await expect(row).toHaveCount(0);
    const { members } = await ownerApiClient.getOrganizationMembers(organizationId);
    expect(members.map((m) => m.user.email)).not.toContain(member.email);
  });
});
