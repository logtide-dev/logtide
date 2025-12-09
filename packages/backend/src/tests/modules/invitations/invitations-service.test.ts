import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../../database/index.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';
import { InvitationsService } from '../../../modules/invitations/service.js';

// Mock the config module for SMTP check
vi.mock('../../../config/index.js', () => ({
  isSmtpConfigured: vi.fn(() => true),
  config: {
    smtp: {
      host: 'localhost',
      port: 1025,
      user: '',
      pass: '',
      from: 'test@example.com',
    },
  },
}));

// Mock the invitation email queue
vi.mock('../../../queue/jobs/invitation-email.js', () => ({
  invitationEmailQueue: {
    add: vi.fn(() => Promise.resolve()),
  },
}));

// Mock the notifications service
vi.mock('../../../modules/notifications/service.js', () => ({
  notificationsService: {
    createNotification: vi.fn(() => Promise.resolve({ id: 'test-notification-id' })),
  },
}));

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(async () => {
    service = new InvitationsService();
    // Reset mocks
    vi.clearAllMocks();
  });

  describe('canInvite', () => {
    it('should return true for owner', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      const result = await service.canInvite(owner.id, org.id);

      expect(result).toBe(true);
    });

    it('should return true for admin', async () => {
      const owner = await createTestUser();
      const admin = await createTestUser({ email: 'admin@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Add admin to organization
      await db
        .insertInto('organization_members')
        .values({
          user_id: admin.id,
          organization_id: org.id,
          role: 'admin',
        })
        .execute();

      const result = await service.canInvite(admin.id, org.id);

      expect(result).toBe(true);
    });

    it('should return false for member', async () => {
      const owner = await createTestUser();
      const member = await createTestUser({ email: 'member@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Add member to organization
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      const result = await service.canInvite(member.id, org.id);

      expect(result).toBe(false);
    });

    it('should return false for non-member', async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser({ email: 'nonmember@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      const result = await service.canInvite(nonMember.id, org.id);

      expect(result).toBe(false);
    });
  });

  describe('inviteUser', () => {
    it('should throw error when inviter lacks permission', async () => {
      const owner = await createTestUser();
      const member = await createTestUser({ email: 'member@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Add member with member role (not admin)
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      await expect(
        service.inviteUser({
          organizationId: org.id,
          email: 'newuser@test.com',
          role: 'member',
          invitedBy: member.id,
        })
      ).rejects.toThrow('Only owners and admins can invite members');
    });

    it('should throw error when user is already a member', async () => {
      const owner = await createTestUser();
      const existingMember = await createTestUser({ email: 'existing@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Add existing member to org
      await db
        .insertInto('organization_members')
        .values({
          user_id: existingMember.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      await expect(
        service.inviteUser({
          organizationId: org.id,
          email: 'existing@test.com',
          role: 'member',
          invitedBy: owner.id,
        })
      ).rejects.toThrow('User is already a member of this organization');
    });

    it('should throw error when pending invitation already exists', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      // Create first invitation
      await service.inviteUser({
        organizationId: org.id,
        email: 'newuser@test.com',
        role: 'member',
        invitedBy: owner.id,
      });

      // Try to create second invitation for same email
      await expect(
        service.inviteUser({
          organizationId: org.id,
          email: 'newuser@test.com',
          role: 'member',
          invitedBy: owner.id,
        })
      ).rejects.toThrow('An invitation has already been sent to this email');
    });

    it('should create invitation for non-existing user (external)', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      const result = await service.inviteUser({
        organizationId: org.id,
        email: 'newexternal@test.com',
        role: 'member',
        invitedBy: owner.id,
      });

      expect(result.type).toBe('email_sent');
      expect(result.message).toContain('newexternal@test.com');
      expect(result.invitation).toBeDefined();
      expect(result.invitation?.email).toBe('newexternal@test.com');
      expect(result.invitation?.role).toBe('member');
    });

    it('should create invitation for existing user (internal)', async () => {
      const owner = await createTestUser();
      const existingUser = await createTestUser({ email: 'internal@test.com', name: 'Internal User' });
      const org = await createTestOrganization({ ownerId: owner.id });

      const result = await service.inviteUser({
        organizationId: org.id,
        email: 'internal@test.com',
        role: 'member',
        invitedBy: owner.id,
      });

      expect(result.type).toBe('email_sent'); // When SMTP is configured, email is also sent
      expect(result.message).toContain('Internal User');
      expect(result.invitation).toBeDefined();
      expect(result.invitation?.email).toBe('internal@test.com');
    });

    it('should normalize email to lowercase', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      const result = await service.inviteUser({
        organizationId: org.id,
        email: 'NewUser@Test.COM',
        role: 'member',
        invitedBy: owner.id,
      });

      expect(result.invitation?.email).toBe('newuser@test.com');
    });
  });

  describe('getPendingInvitations', () => {
    it('should throw error when user lacks permission', async () => {
      const owner = await createTestUser();
      const member = await createTestUser({ email: 'member@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Add member with member role (not admin)
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      await expect(
        service.getPendingInvitations(org.id, member.id)
      ).rejects.toThrow('Only owners and admins can view invitations');
    });

    it('should return empty array when no invitations', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      const result = await service.getPendingInvitations(org.id, owner.id);

      expect(result).toEqual([]);
    });

    it('should return pending invitations', async () => {
      const owner = await createTestUser({ name: 'Test Owner' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Create an invitation
      await service.inviteUser({
        organizationId: org.id,
        email: 'invited@test.com',
        role: 'member',
        invitedBy: owner.id,
      });

      const result = await service.getPendingInvitations(org.id, owner.id);

      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('invited@test.com');
      expect(result[0].role).toBe('member');
      expect(result[0].invitedBy).toBe(owner.id);
      expect(result[0].inviterName).toBe('Test Owner');
    });

    it('should not return expired invitations', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      // Create invitation with past expiry
      await db
        .insertInto('organization_invitations')
        .values({
          organization_id: org.id,
          email: 'expired@test.com',
          role: 'member',
          token: 'expired-token',
          invited_by: owner.id,
          expires_at: new Date(Date.now() - 1000), // Expired 1 second ago
        })
        .execute();

      const result = await service.getPendingInvitations(org.id, owner.id);

      expect(result).toEqual([]);
    });

    it('should not return accepted invitations', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      // Create accepted invitation
      await db
        .insertInto('organization_invitations')
        .values({
          organization_id: org.id,
          email: 'accepted@test.com',
          role: 'member',
          token: 'accepted-token',
          invited_by: owner.id,
          expires_at: new Date(Date.now() + 86400000), // 1 day in future
          accepted_at: new Date(),
        })
        .execute();

      const result = await service.getPendingInvitations(org.id, owner.id);

      expect(result).toEqual([]);
    });
  });

  describe('getInvitationByToken', () => {
    it('should return null for invalid token', async () => {
      const result = await service.getInvitationByToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should return invitation details for valid token', async () => {
      const owner = await createTestUser({ name: 'Test Owner' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      const invitation = await service.inviteUser({
        organizationId: org.id,
        email: 'invited@test.com',
        role: 'admin',
        invitedBy: owner.id,
      });

      const token = invitation.invitation?.id; // Get token from invitation
      // We need to get the token from the DB since the service doesn't expose it directly
      const dbInvitation = await db
        .selectFrom('organization_invitations')
        .select('token')
        .where('email', '=', 'invited@test.com')
        .executeTakeFirst();

      const result = await service.getInvitationByToken(dbInvitation!.token);

      expect(result).not.toBeNull();
      expect(result?.invitation.email).toBe('invited@test.com');
      expect(result?.invitation.role).toBe('admin');
      expect(result?.organizationName).toBe('Test Org');
      expect(result?.inviterName).toBe('Test Owner');
    });

    it('should return null for accepted invitation', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      const token = 'test-token-accepted';
      await db
        .insertInto('organization_invitations')
        .values({
          organization_id: org.id,
          email: 'accepted@test.com',
          role: 'member',
          token,
          invited_by: owner.id,
          expires_at: new Date(Date.now() + 86400000),
          accepted_at: new Date(),
        })
        .execute();

      const result = await service.getInvitationByToken(token);

      expect(result).toBeNull();
    });
  });

  describe('acceptInvitation', () => {
    it('should throw error for invalid token', async () => {
      const user = await createTestUser();

      await expect(
        service.acceptInvitation({
          token: 'invalid-token',
          userId: user.id,
        })
      ).rejects.toThrow('Invalid or already accepted invitation');
    });

    it('should throw error for expired invitation', async () => {
      const owner = await createTestUser();
      const invitee = await createTestUser({ email: 'invitee@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      const token = 'expired-token';
      await db
        .insertInto('organization_invitations')
        .values({
          organization_id: org.id,
          email: 'invitee@test.com',
          role: 'member',
          token,
          invited_by: owner.id,
          expires_at: new Date(Date.now() - 1000), // Expired
        })
        .execute();

      await expect(
        service.acceptInvitation({
          token,
          userId: invitee.id,
        })
      ).rejects.toThrow('Invitation has expired');
    });

    it('should throw error when email does not match', async () => {
      const owner = await createTestUser();
      const wrongUser = await createTestUser({ email: 'wrong@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      const token = 'mismatched-email-token';
      await db
        .insertInto('organization_invitations')
        .values({
          organization_id: org.id,
          email: 'invitee@test.com',
          role: 'member',
          token,
          invited_by: owner.id,
          expires_at: new Date(Date.now() + 86400000),
        })
        .execute();

      await expect(
        service.acceptInvitation({
          token,
          userId: wrongUser.id,
        })
      ).rejects.toThrow('This invitation was sent to a different email address');
    });

    it('should successfully accept invitation and add user to organization', async () => {
      const owner = await createTestUser();
      const invitee = await createTestUser({ email: 'invitee@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id, name: 'Test Org' });

      const token = 'valid-token';
      await db
        .insertInto('organization_invitations')
        .values({
          organization_id: org.id,
          email: 'invitee@test.com',
          role: 'admin',
          token,
          invited_by: owner.id,
          expires_at: new Date(Date.now() + 86400000),
        })
        .execute();

      const result = await service.acceptInvitation({
        token,
        userId: invitee.id,
      });

      expect(result.organizationId).toBe(org.id);
      expect(result.role).toBe('admin');

      // Verify user was added to organization
      const membership = await db
        .selectFrom('organization_members')
        .select(['role'])
        .where('user_id', '=', invitee.id)
        .where('organization_id', '=', org.id)
        .executeTakeFirst();

      expect(membership?.role).toBe('admin');

      // Verify invitation was marked as accepted
      const invitation = await db
        .selectFrom('organization_invitations')
        .select(['accepted_at'])
        .where('token', '=', token)
        .executeTakeFirst();

      expect(invitation?.accepted_at).not.toBeNull();
    });
  });

  describe('revokeInvitation', () => {
    it('should throw error when user lacks permission', async () => {
      const owner = await createTestUser();
      const member = await createTestUser({ email: 'member@test.com' });
      const org = await createTestOrganization({ ownerId: owner.id });

      // Add member with member role
      await db
        .insertInto('organization_members')
        .values({
          user_id: member.id,
          organization_id: org.id,
          role: 'member',
        })
        .execute();

      await expect(
        service.revokeInvitation('some-id', member.id, org.id)
      ).rejects.toThrow('Only owners and admins can revoke invitations');
    });

    it('should throw error when invitation not found', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      // Use a valid UUID that doesn't exist in the database
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        service.revokeInvitation(nonExistentId, owner.id, org.id)
      ).rejects.toThrow('Invitation not found or already accepted');
    });

    it('should successfully revoke invitation', async () => {
      const owner = await createTestUser();
      const org = await createTestOrganization({ ownerId: owner.id });

      // Create an invitation
      const result = await service.inviteUser({
        organizationId: org.id,
        email: 'torevoke@test.com',
        role: 'member',
        invitedBy: owner.id,
      });

      await service.revokeInvitation(result.invitation!.id, owner.id, org.id);

      // Verify invitation was deleted
      const invitation = await db
        .selectFrom('organization_invitations')
        .select('id')
        .where('id', '=', result.invitation!.id)
        .executeTakeFirst();

      expect(invitation).toBeUndefined();
    });
  });
});
