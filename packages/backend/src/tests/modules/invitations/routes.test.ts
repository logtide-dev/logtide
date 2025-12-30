import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { invitationsRoutes } from '../../../modules/invitations/routes.js';
import { createTestUser, createTestOrganization } from '../../helpers/factories.js';
import crypto from 'crypto';

// Mock the config module for SMTP check
vi.mock('../../../config/index.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../config/index.js')>();
    return {
        ...original,
        isSmtpConfigured: vi.fn(() => true),
    };
});

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

// Helper to create a session for a user
async function createTestSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db
        .insertInto('sessions')
        .values({
            user_id: userId,
            token,
            expires_at: expiresAt,
        })
        .execute();

    return { token, expiresAt };
}

// Helper to create an invitation directly in DB
async function createTestInvitation(
    organizationId: string,
    email: string,
    invitedBy: string,
    options?: { expired?: boolean; accepted?: boolean }
) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = options?.expired
        ? new Date(Date.now() - 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await db
        .insertInto('organization_invitations')
        .values({
            organization_id: organizationId,
            email: email.toLowerCase(),
            role: 'member',
            token,
            invited_by: invitedBy,
            expires_at: expiresAt,
            accepted_at: options?.accepted ? new Date() : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return { ...result, token };
}

describe('Invitations Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(invitationsRoutes, { prefix: '/api/v1/invitations' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        vi.clearAllMocks();

        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('organization_invitations').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();

        // Create test user and organization
        testUser = await createTestUser();
        testOrganization = await createTestOrganization({ ownerId: testUser.id });

        // Create session for auth
        const session = await createTestSession(testUser.id);
        authToken = session.token;
    });

    // ==========================================================================
    // GET /token/:token - Public invitation preview
    // ==========================================================================

    describe('GET /api/v1/invitations/token/:token', () => {
        it('should return invitation details for valid token', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'invited@test.com',
                testUser.id
            );

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/token/${invitation.token}`,
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.email).toBe('invited@test.com');
            expect(body.role).toBe('member');
            expect(body.organizationName).toBe(testOrganization.name);
        });

        it('should return 404 for invalid token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/invitations/token/invalid-token',
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.error).toBe('Invitation not found or expired');
        });

        it('should return invitation details even if expired (frontend shows expiry)', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'expired@test.com',
                testUser.id,
                { expired: true }
            );

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/token/${invitation.token}`,
            });

            // The API returns the invitation even if expired, so frontend can show appropriate message
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.email).toBe('expired@test.com');
            // The expiresAt date should be in the past
            expect(new Date(body.expiresAt).getTime()).toBeLessThan(Date.now());
        });

        it('should return 404 for already accepted invitation', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'accepted@test.com',
                testUser.id,
                { accepted: true }
            );

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/token/${invitation.token}`,
            });

            expect(response.statusCode).toBe(404);
        });
    });

    // ==========================================================================
    // POST /accept - Accept invitation
    // ==========================================================================

    describe('POST /api/v1/invitations/accept', () => {
        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/invitations/accept',
                payload: {
                    token: 'some-token',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should accept valid invitation and add user to org', async () => {
            // Create another user to accept the invitation
            const invitee = await createTestUser({ email: 'invitee@test.com' });
            const inviteeSession = await createTestSession(invitee.id);

            const invitation = await createTestInvitation(
                testOrganization.id,
                'invitee@test.com',
                testUser.id
            );

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/invitations/accept',
                headers: {
                    Authorization: `Bearer ${inviteeSession.token}`,
                },
                payload: {
                    token: invitation.token,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.organizationId).toBe(testOrganization.id);
            expect(body.role).toBe('member');

            // Verify user was added to organization
            const membership = await db
                .selectFrom('organization_members')
                .select(['role'])
                .where('user_id', '=', invitee.id)
                .where('organization_id', '=', testOrganization.id)
                .executeTakeFirst();

            expect(membership?.role).toBe('member');
        });

        it('should return 404 for invalid token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/invitations/accept',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    token: 'invalid-token',
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 410 for expired invitation', async () => {
            const invitee = await createTestUser({ email: 'expiredinvitee@test.com' });
            const inviteeSession = await createTestSession(invitee.id);

            const invitation = await createTestInvitation(
                testOrganization.id,
                'expiredinvitee@test.com',
                testUser.id,
                { expired: true }
            );

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/invitations/accept',
                headers: {
                    Authorization: `Bearer ${inviteeSession.token}`,
                },
                payload: {
                    token: invitation.token,
                },
            });

            expect(response.statusCode).toBe(410);
        });

        it('should return 403 when email does not match', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'someone@test.com',
                testUser.id
            );

            // Try to accept with a different user
            const wrongUser = await createTestUser({ email: 'wrong@test.com' });
            const wrongSession = await createTestSession(wrongUser.id);

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/invitations/accept',
                headers: {
                    Authorization: `Bearer ${wrongSession.token}`,
                },
                payload: {
                    token: invitation.token,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    // ==========================================================================
    // POST /:organizationId/invite - Invite user
    // ==========================================================================

    describe('POST /api/v1/invitations/:organizationId/invite', () => {
        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                payload: {
                    email: 'newinvite@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should invite a new user as owner', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    email: 'newinvite@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.type).toBe('email_sent');
            expect(body.invitation).toBeDefined();
            expect(body.invitation.email).toBe('newinvite@test.com');
        });

        it('should invite a new user as admin', async () => {
            // Create admin user
            const admin = await createTestUser({ email: 'admin@test.com' });
            await db
                .insertInto('organization_members')
                .values({
                    user_id: admin.id,
                    organization_id: testOrganization.id,
                    role: 'admin',
                })
                .execute();

            const adminSession = await createTestSession(admin.id);

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${adminSession.token}`,
                },
                payload: {
                    email: 'adminsinvite@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(201);
        });

        it('should return 403 for regular member', async () => {
            // Create regular member
            const member = await createTestUser({ email: 'member@test.com' });
            await db
                .insertInto('organization_members')
                .values({
                    user_id: member.id,
                    organization_id: testOrganization.id,
                    role: 'member',
                })
                .execute();

            const memberSession = await createTestSession(member.id);

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${memberSession.token}`,
                },
                payload: {
                    email: 'shouldfail@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 409 if user is already a member', async () => {
            // Create a user who is already a member
            const existingMember = await createTestUser({ email: 'existing@test.com' });
            await db
                .insertInto('organization_members')
                .values({
                    user_id: existingMember.id,
                    organization_id: testOrganization.id,
                    role: 'member',
                })
                .execute();

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    email: 'existing@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(409);
        });

        it('should return 409 if invitation already pending', async () => {
            // Create first invitation
            await createTestInvitation(testOrganization.id, 'pending@test.com', testUser.id);

            // Try to invite again
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    email: 'pending@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(409);
        });

        it('should normalize email to lowercase', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    email: 'UPPERCASE@TEST.COM',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.invitation.email).toBe('uppercase@test.com');
        });

        it('should return 400 for invalid email', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    email: 'not-an-email',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 503 when email server is not configured', async () => {
            // Mock the invitations service to throw email not configured error
            const { invitationsService } = await import(
                '../../../modules/invitations/service.js'
            );
            const originalInviteUser = invitationsService.inviteUser;
            invitationsService.inviteUser = vi.fn().mockRejectedValueOnce(
                new Error('Email server is not configured')
            );

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invite`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    email: 'newuser@test.com',
                    role: 'member',
                },
            });

            expect(response.statusCode).toBe(503);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Email server is not configured');

            // Restore original
            invitationsService.inviteUser = originalInviteUser;
        });
    });

    // ==========================================================================
    // GET /:organizationId/invitations - List pending invitations
    // ==========================================================================

    describe('GET /api/v1/invitations/:organizationId/invitations', () => {
        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/${testOrganization.id}/invitations`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('should list pending invitations for owner', async () => {
            await createTestInvitation(testOrganization.id, 'invite1@test.com', testUser.id);
            await createTestInvitation(testOrganization.id, 'invite2@test.com', testUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/${testOrganization.id}/invitations`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.invitations).toHaveLength(2);
        });

        it('should not include expired invitations', async () => {
            await createTestInvitation(testOrganization.id, 'valid@test.com', testUser.id);
            await createTestInvitation(testOrganization.id, 'expired@test.com', testUser.id, {
                expired: true,
            });

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/${testOrganization.id}/invitations`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.invitations).toHaveLength(1);
            expect(body.invitations[0].email).toBe('valid@test.com');
        });

        it('should not include accepted invitations', async () => {
            await createTestInvitation(testOrganization.id, 'pending@test.com', testUser.id);
            await createTestInvitation(testOrganization.id, 'accepted@test.com', testUser.id, {
                accepted: true,
            });

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/${testOrganization.id}/invitations`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.invitations).toHaveLength(1);
            expect(body.invitations[0].email).toBe('pending@test.com');
        });

        it('should return 403 for regular member', async () => {
            const member = await createTestUser({ email: 'regularmember@test.com' });
            await db
                .insertInto('organization_members')
                .values({
                    user_id: member.id,
                    organization_id: testOrganization.id,
                    role: 'member',
                })
                .execute();

            const memberSession = await createTestSession(member.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/invitations/${testOrganization.id}/invitations`,
                headers: {
                    Authorization: `Bearer ${memberSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    // ==========================================================================
    // DELETE /:organizationId/invitations/:invitationId - Revoke invitation
    // ==========================================================================

    describe('DELETE /api/v1/invitations/:organizationId/invitations/:invitationId', () => {
        it('should return 401 without auth token', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'torevoke@test.com',
                testUser.id
            );

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('should revoke invitation as owner', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'torevoke@test.com',
                testUser.id
            );

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(204);

            // Verify invitation was deleted
            const check = await db
                .selectFrom('organization_invitations')
                .select('id')
                .where('id', '=', invitation.id)
                .executeTakeFirst();

            expect(check).toBeUndefined();
        });

        it('should return 403 for regular member', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'cantrevoke@test.com',
                testUser.id
            );

            const member = await createTestUser({ email: 'normalmember@test.com' });
            await db
                .insertInto('organization_members')
                .values({
                    user_id: member.id,
                    organization_id: testOrganization.id,
                    role: 'member',
                })
                .execute();

            const memberSession = await createTestSession(member.id);

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}`,
                headers: {
                    Authorization: `Bearer ${memberSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 404 for non-existent invitation', async () => {
            const fakeId = '00000000-0000-0000-0000-000000000000';

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${fakeId}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    // ==========================================================================
    // POST /:organizationId/invitations/:invitationId/resend - Resend invitation
    // ==========================================================================

    describe('POST /api/v1/invitations/:organizationId/invitations/:invitationId/resend', () => {
        it('should return 401 without auth token', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'toresend@test.com',
                testUser.id
            );

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}/resend`,
            });

            expect(response.statusCode).toBe(401);
        });

        it('should resend invitation as owner', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'toresend@test.com',
                testUser.id
            );

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}/resend`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.success).toBe(true);
            expect(body.message).toContain('toresend@test.com');
        });

        it('should return 403 for regular member', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'cantresend@test.com',
                testUser.id
            );

            const member = await createTestUser({ email: 'regularmember2@test.com' });
            await db
                .insertInto('organization_members')
                .values({
                    user_id: member.id,
                    organization_id: testOrganization.id,
                    role: 'member',
                })
                .execute();

            const memberSession = await createTestSession(member.id);

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}/resend`,
                headers: {
                    Authorization: `Bearer ${memberSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
        });

        it('should return 404 for non-existent invitation', async () => {
            const fakeId = '00000000-0000-0000-0000-000000000000';

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${fakeId}/resend`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 503 when email server is not configured', async () => {
            const invitation = await createTestInvitation(
                testOrganization.id,
                'resend503@test.com',
                testUser.id
            );

            // Mock the invitations service to throw email not configured error
            const { invitationsService } = await import(
                '../../../modules/invitations/service.js'
            );
            const originalResendInvitation = invitationsService.resendInvitation;
            invitationsService.resendInvitation = vi.fn().mockRejectedValueOnce(
                new Error('Email server is not configured')
            );

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/invitations/${testOrganization.id}/invitations/${invitation.id}/resend`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(503);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('Email server is not configured');

            // Restore original
            invitationsService.resendInvitation = originalResendInvitation;
        });
    });
});
