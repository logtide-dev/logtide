import crypto from 'crypto';
import { db } from '../../database/connection.js';
import { notificationsService } from '../notifications/service.js';
import { invitationEmailQueue } from '../../queue/jobs/invitation-email.js';
import { isSmtpConfigured } from '../../config/index.js';
import type { OrganizationInvitation, PendingInvitation, OrgRole } from '@logtide/shared';

const INVITATION_EXPIRY_DAYS = 7;

export interface InviteUserInput {
  organizationId: string;
  email: string;
  role: OrgRole;
  invitedBy: string;
}

export interface AcceptInvitationInput {
  token: string;
  userId: string;
}

export interface InviteResult {
  type: 'notification_sent' | 'email_sent';
  message: string;
  invitation?: OrganizationInvitation;
}

export class InvitationsService {
  /**
   * Generate secure random token for invitation
   */
  private generateInviteToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Check if user has permission to invite (owner or admin)
   */
  async canInvite(userId: string, organizationId: string): Promise<boolean> {
    const member = await db
      .selectFrom('organization_members')
      .select(['role'])
      .where('user_id', '=', userId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    return member?.role === 'owner' || member?.role === 'admin';
  }

  /**
   * Invite a user to organization
   * - All users must accept the invitation (no direct add)
   * - If user exists: create invitation + in-app notification
   * - If not: create invitation + send email (requires SMTP)
   */
  async inviteUser(input: InviteUserInput): Promise<InviteResult> {
    const { organizationId, email, role, invitedBy } = input;

    // Check if inviter has permission
    const canInvite = await this.canInvite(invitedBy, organizationId);
    if (!canInvite) {
      throw new Error('Only owners and admins can invite members');
    }

    // Check if user exists
    const existingUser = await db
      .selectFrom('users')
      .select(['id', 'email', 'name'])
      .where('email', '=', email.toLowerCase())
      .executeTakeFirst();

    // Check if already a member (for existing users)
    if (existingUser) {
      const existingMember = await db
        .selectFrom('organization_members')
        .select(['id'])
        .where('user_id', '=', existingUser.id)
        .where('organization_id', '=', organizationId)
        .executeTakeFirst();

      if (existingMember) {
        throw new Error('User is already a member of this organization');
      }
    }

    // For new users (no account), require SMTP to send email invitation
    if (!existingUser && !isSmtpConfigured()) {
      throw new Error(
        'Email server is not configured. To invite new users, please configure SMTP settings or ask them to sign up first.'
      );
    }

    // Check if there's a pending invitation
    const pendingInvite = await db
      .selectFrom('organization_invitations')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('email', '=', email.toLowerCase())
      .where('accepted_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    if (pendingInvite) {
      throw new Error('An invitation has already been sent to this email');
    }

    // Create new invitation
    const token = this.generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Get organization and inviter details for the email
    const [org, inviter] = await Promise.all([
      db
        .selectFrom('organizations')
        .select(['name'])
        .where('id', '=', organizationId)
        .executeTakeFirst(),
      db
        .selectFrom('users')
        .select(['name'])
        .where('id', '=', invitedBy)
        .executeTakeFirst(),
    ]);

    const invitation = await db
      .insertInto('organization_invitations')
      .values({
        organization_id: organizationId,
        email: email.toLowerCase(),
        role,
        token,
        invited_by: invitedBy,
        expires_at: expiresAt,
      })
      .returning([
        'id',
        'organization_id',
        'email',
        'role',
        'token',
        'invited_by',
        'expires_at',
        'accepted_at',
        'created_at',
      ])
      .executeTakeFirstOrThrow();

    if (existingUser) {
      // Existing user: send in-app notification
      this.createInvitationNotification(
        existingUser.id,
        organizationId,
        org?.name || 'Unknown Organization',
        inviter?.name || 'A team member',
        token
      ).catch((err) => console.error('Failed to create invitation notification:', err));

      // Also send email if SMTP is configured
      if (isSmtpConfigured()) {
        await invitationEmailQueue.add('send-invitation', {
          email: email.toLowerCase(),
          token,
          organizationId,
          organizationName: org?.name || 'Unknown Organization',
          inviterName: inviter?.name || 'A team member',
          role,
        });

        return {
          type: 'email_sent',
          message: `Invitation sent to ${existingUser.name} (${email}). They will receive both an email and an in-app notification.`,
          invitation: this.mapInvitation(invitation),
        };
      }

      return {
        type: 'notification_sent',
        message: `Invitation sent to ${existingUser.name} (${email}). They will see it in their notifications.`,
        invitation: this.mapInvitation(invitation),
      };
    } else {
      // New user: queue email for sending (SMTP required - checked earlier)
      await invitationEmailQueue.add('send-invitation', {
        email: email.toLowerCase(),
        token,
        organizationId,
        organizationName: org?.name || 'Unknown Organization',
        inviterName: inviter?.name || 'A team member',
        role,
      });

      return {
        type: 'email_sent',
        message: `Invitation email will be sent to ${email}`,
        invitation: this.mapInvitation(invitation),
      };
    }
  }

  /**
   * Create in-app notification for invitation (existing users)
   */
  private async createInvitationNotification(
    userId: string,
    organizationId: string,
    organizationName: string,
    inviterName: string,
    token: string
  ): Promise<void> {
    await notificationsService.createNotification({
      userId,
      title: 'Organization Invitation',
      message: `${inviterName} has invited you to join ${organizationName}`,
      type: 'organization_invite',
      organizationId,
      metadata: { inviteToken: token, link: `/invite/${token}` },
    });
  }

  /**
   * Get pending invitations for an organization
   */
  async getPendingInvitations(organizationId: string, userId: string): Promise<PendingInvitation[]> {
    // Check if user has permission
    const canInvite = await this.canInvite(userId, organizationId);
    if (!canInvite) {
      throw new Error('Only owners and admins can view invitations');
    }

    const invitations = await db
      .selectFrom('organization_invitations')
      .innerJoin('users', 'organization_invitations.invited_by', 'users.id')
      .select([
        'organization_invitations.id',
        'organization_invitations.email',
        'organization_invitations.role',
        'organization_invitations.invited_by',
        'organization_invitations.expires_at',
        'organization_invitations.created_at',
        'users.name as inviter_name',
      ])
      .where('organization_invitations.organization_id', '=', organizationId)
      .where('organization_invitations.accepted_at', 'is', null)
      .where('organization_invitations.expires_at', '>', new Date())
      .orderBy('organization_invitations.created_at', 'desc')
      .execute();

    return invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role as OrgRole,
      invitedBy: inv.invited_by,
      inviterName: inv.inviter_name,
      expiresAt: new Date(inv.expires_at),
      createdAt: new Date(inv.created_at),
    }));
  }

  /**
   * Get invitation by token (for accept flow)
   */
  async getInvitationByToken(token: string): Promise<{
    invitation: OrganizationInvitation;
    organizationName: string;
    inviterName: string;
  } | null> {
    const result = await db
      .selectFrom('organization_invitations')
      .innerJoin('organizations', 'organization_invitations.organization_id', 'organizations.id')
      .innerJoin('users', 'organization_invitations.invited_by', 'users.id')
      .select([
        'organization_invitations.id',
        'organization_invitations.organization_id',
        'organization_invitations.email',
        'organization_invitations.role',
        'organization_invitations.token',
        'organization_invitations.invited_by',
        'organization_invitations.expires_at',
        'organization_invitations.accepted_at',
        'organization_invitations.created_at',
        'organizations.name as organization_name',
        'users.name as inviter_name',
      ])
      .where('organization_invitations.token', '=', token)
      .where('organization_invitations.accepted_at', 'is', null)
      .executeTakeFirst();

    if (!result) {
      return null;
    }

    return {
      invitation: this.mapInvitation(result),
      organizationName: result.organization_name,
      inviterName: result.inviter_name,
    };
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(input: AcceptInvitationInput): Promise<{
    organizationId: string;
    role: OrgRole;
  }> {
    const { token, userId } = input;

    // Find valid invitation
    const invitation = await db
      .selectFrom('organization_invitations')
      .select(['id', 'organization_id', 'email', 'role', 'expires_at'])
      .where('token', '=', token)
      .where('accepted_at', 'is', null)
      .executeTakeFirst();

    if (!invitation) {
      throw new Error('Invalid or already accepted invitation');
    }

    // Check expiry
    if (new Date(invitation.expires_at) < new Date()) {
      throw new Error('Invitation has expired');
    }

    // Verify user email matches invitation
    const user = await db
      .selectFrom('users')
      .select(['email'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error('This invitation was sent to a different email address');
    }

    // Check if already a member (race condition protection)
    const existingMember = await db
      .selectFrom('organization_members')
      .select(['id'])
      .where('user_id', '=', userId)
      .where('organization_id', '=', invitation.organization_id)
      .executeTakeFirst();

    if (existingMember) {
      // Already a member - just mark invitation as accepted
      await db
        .updateTable('organization_invitations')
        .set({ accepted_at: new Date() })
        .where('id', '=', invitation.id)
        .execute();

      throw new Error('You are already a member of this organization');
    }

    // Add to organization
    await db
      .insertInto('organization_members')
      .values({
        organization_id: invitation.organization_id,
        user_id: userId,
        role: invitation.role as OrgRole,
      })
      .execute();

    // Mark invitation as accepted
    await db
      .updateTable('organization_invitations')
      .set({ accepted_at: new Date() })
      .where('id', '=', invitation.id)
      .execute();

    // Create welcome notification
    const org = await db
      .selectFrom('organizations')
      .select(['name'])
      .where('id', '=', invitation.organization_id)
      .executeTakeFirst();

    if (org) {
      await notificationsService.createNotification({
        userId,
        type: 'system',
        title: `Welcome to ${org.name}`,
        message: `You are now a ${invitation.role} of ${org.name}`,
        organizationId: invitation.organization_id,
      });
    }

    return {
      organizationId: invitation.organization_id,
      role: invitation.role as OrgRole,
    };
  }

  /**
   * Revoke a pending invitation
   */
  async revokeInvitation(invitationId: string, userId: string, organizationId: string): Promise<void> {
    // Check permission
    const canInvite = await this.canInvite(userId, organizationId);
    if (!canInvite) {
      throw new Error('Only owners and admins can revoke invitations');
    }

    const result = await db
      .deleteFrom('organization_invitations')
      .where('id', '=', invitationId)
      .where('organization_id', '=', organizationId)
      .where('accepted_at', 'is', null)
      .executeTakeFirst();

    if (result.numDeletedRows === 0n) {
      throw new Error('Invitation not found or already accepted');
    }
  }

  /**
   * Resend invitation (extends expiry)
   */
  async resendInvitation(invitationId: string, userId: string, organizationId: string): Promise<{
    email: string;
    token: string;
  }> {
    // Check if SMTP is configured
    if (!isSmtpConfigured()) {
      throw new Error(
        'Email server is not configured. Cannot resend invitation emails.'
      );
    }

    // Check permission
    const canInvite = await this.canInvite(userId, organizationId);
    if (!canInvite) {
      throw new Error('Only owners and admins can resend invitations');
    }

    const invitation = await db
      .selectFrom('organization_invitations')
      .select(['id', 'email', 'token', 'role'])
      .where('id', '=', invitationId)
      .where('organization_id', '=', organizationId)
      .where('accepted_at', 'is', null)
      .executeTakeFirst();

    if (!invitation) {
      throw new Error('Invitation not found or already accepted');
    }

    // Extend expiry
    const newExpiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db
      .updateTable('organization_invitations')
      .set({ expires_at: newExpiresAt })
      .where('id', '=', invitationId)
      .execute();

    // Get organization and inviter details for the email
    const [org, inviter] = await Promise.all([
      db
        .selectFrom('organizations')
        .select(['name'])
        .where('id', '=', organizationId)
        .executeTakeFirst(),
      db
        .selectFrom('users')
        .select(['name'])
        .where('id', '=', userId)
        .executeTakeFirst(),
    ]);

    // Queue email for sending
    await invitationEmailQueue.add('resend-invitation', {
      email: invitation.email,
      token: invitation.token,
      organizationId,
      organizationName: org?.name || 'Unknown Organization',
      inviterName: inviter?.name || 'A team member',
      role: invitation.role,
    });

    return {
      email: invitation.email,
      token: invitation.token,
    };
  }

  private mapInvitation(row: any): OrganizationInvitation {
    return {
      id: row.id,
      organizationId: row.organization_id,
      email: row.email,
      role: row.role as OrgRole,
      invitedBy: row.invited_by,
      expiresAt: new Date(row.expires_at),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  }
}

export const invitationsService = new InvitationsService();
