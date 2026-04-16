import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { OrganizationsService } from '../../../modules/organizations/service.js';
import { createTestUser, createTestOrganization, createTestContext } from '../../helpers/factories.js';

// Mock the notifications service
vi.mock('../../../modules/notifications/service.js', () => ({
    notificationsService: {
        createNotification: vi.fn(() => Promise.resolve({ id: 'test-notification-id' })),
    },
}));

describe('OrganizationsService', () => {
    let orgService: OrganizationsService;

    beforeEach(async () => {
        orgService = new OrganizationsService();

        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('alert_history').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('alert_rules').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('notifications').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('users').execute();
    });

    describe('createOrganization', () => {
        it('should create an organization with valid input', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Test Organization',
            });

            expect(org.id).toBeDefined();
            expect(org.name).toBe('Test Organization');
            expect(org.slug).toBeDefined();
            expect(org.ownerId).toBe(user.id);
        });

        it('should generate slug from name', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'My Cool Company',
            });

            expect(org.slug).toBe('my-cool-company');
        });

        it('should handle special characters in name', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Test@Company! #123',
            });

            expect(org.slug).toMatch(/^testcompany-123/);
        });

        it('should generate unique slug for duplicate names', async () => {
            const user = await createTestUser();

            const org1 = await orgService.createOrganization({
                userId: user.id,
                name: 'Duplicate Name',
            });

            const org2 = await orgService.createOrganization({
                userId: user.id,
                name: 'Duplicate Name',
            });

            expect(org1.slug).not.toBe(org2.slug);
            expect(org2.slug).toMatch(/duplicate-name-\d+/);
        });

        it('should set creator as owner member', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Member Test Org',
            });

            // Check member was added
            const member = await db
                .selectFrom('organization_members')
                .selectAll()
                .where('organization_id', '=', org.id)
                .where('user_id', '=', user.id)
                .executeTakeFirst();

            expect(member).toBeDefined();
            expect(member?.role).toBe('owner');
        });

        it('should include optional description', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Described Org',
                description: 'A great organization',
            });

            expect(org.description).toBe('A great organization');
        });
    });

    describe('getUserOrganizations', () => {
        it('should return empty array for user with no organizations', async () => {
            const user = await createTestUser();

            const orgs = await orgService.getUserOrganizations(user.id);

            expect(orgs).toEqual([]);
        });

        it('should return organizations user is member of', async () => {
            const user = await createTestUser();

            await orgService.createOrganization({
                userId: user.id,
                name: 'Org 1',
            });

            await orgService.createOrganization({
                userId: user.id,
                name: 'Org 2',
            });

            const orgs = await orgService.getUserOrganizations(user.id);

            expect(orgs).toHaveLength(2);
        });

        it('should include user role in results', async () => {
            const user = await createTestUser();

            await orgService.createOrganization({
                userId: user.id,
                name: 'My Org',
            });

            const orgs = await orgService.getUserOrganizations(user.id);

            expect(orgs[0].role).toBe('owner');
        });

        it('should not return organizations user is not member of', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            await orgService.createOrganization({
                userId: user1.id,
                name: 'User 1 Org',
            });

            const orgs = await orgService.getUserOrganizations(user2.id);

            expect(orgs).toEqual([]);
        });

        it('should order by created_at descending', async () => {
            const user = await createTestUser();

            await orgService.createOrganization({
                userId: user.id,
                name: 'First Org',
            });

            await new Promise((resolve) => setTimeout(resolve, 10));

            await orgService.createOrganization({
                userId: user.id,
                name: 'Second Org',
            });

            const orgs = await orgService.getUserOrganizations(user.id);

            expect(orgs[0].name).toBe('Second Org');
            expect(orgs[1].name).toBe('First Org');
        });
    });

    describe('getOrganizationById', () => {
        it('should return null for non-existent organization', async () => {
            const user = await createTestUser();

            const org = await orgService.getOrganizationById(
                '00000000-0000-0000-0000-000000000000',
                user.id
            );

            expect(org).toBeNull();
        });

        it('should return null if user is not a member', async () => {
            const user1 = await createTestUser({ email: 'user1@test.com' });
            const user2 = await createTestUser({ email: 'user2@test.com' });

            const org = await orgService.createOrganization({
                userId: user1.id,
                name: 'Private Org',
            });

            const result = await orgService.getOrganizationById(org.id, user2.id);

            expect(result).toBeNull();
        });

        it('should return organization for valid member', async () => {
            const user = await createTestUser();

            const createdOrg = await orgService.createOrganization({
                userId: user.id,
                name: 'My Org',
            });

            const org = await orgService.getOrganizationById(createdOrg.id, user.id);

            expect(org).not.toBeNull();
            expect(org?.name).toBe('My Org');
            expect(org?.role).toBe('owner');
        });
    });

    describe('updateOrganization', () => {
        it('should update organization name', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Old Name',
            });

            const updated = await orgService.updateOrganization(org.id, user.id, {
                name: 'New Name',
            });

            expect(updated?.name).toBe('New Name');
        });

        it('should update organization description', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Org',
            });

            const updated = await orgService.updateOrganization(org.id, user.id, {
                description: 'New description',
            });

            expect(updated?.description).toBe('New description');
        });

        it('should throw error for non-existent organization', async () => {
            const user = await createTestUser();

            await expect(
                orgService.updateOrganization(
                    '00000000-0000-0000-0000-000000000000',
                    user.id,
                    { name: 'Test' }
                )
            ).rejects.toThrow('Organization not found');
        });

        it('should throw error if user is not owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Org',
            });

            // Add member to organization
            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .execute();

            // Member trying to update should fail
            await expect(
                orgService.updateOrganization(org.id, member.id, {
                    name: 'Hacked Name',
                })
            ).rejects.toThrow('Only the organization owner can update it');
        });
    });

    describe('getOrganizationMembers', () => {
        it('should return members of organization', async () => {
            const { organization, user } = await createTestContext();

            const members = await orgService.getOrganizationMembers(
                organization.id,
                user.id
            );

            expect(members).toBeDefined();
            expect(members.length).toBeGreaterThan(0);
        });

        it('should throw error if user is not a member', async () => {
            const { organization } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            await expect(
                orgService.getOrganizationMembers(organization.id, outsider.id)
            ).rejects.toThrow('You do not have access to this organization');
        });
    });

    describe('getOrganizationBySlug', () => {
        it('should return organization by slug', async () => {
            const user = await createTestUser();

            const created = await orgService.createOrganization({
                userId: user.id,
                name: 'Slug Test Org',
            });

            const result = await orgService.getOrganizationBySlug(created.slug, user.id);

            expect(result).not.toBeNull();
            expect(result?.id).toBe(created.id);
            expect(result?.name).toBe('Slug Test Org');
        });

        it('should return null for non-existent slug', async () => {
            const user = await createTestUser();

            const result = await orgService.getOrganizationBySlug('non-existent-slug', user.id);

            expect(result).toBeNull();
        });

        it('should return null if user is not a member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Private Org',
            });

            const result = await orgService.getOrganizationBySlug(org.slug, outsider.id);

            expect(result).toBeNull();
        });
    });

    describe('deleteOrganization', () => {
        it('should delete organization as owner', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'To Delete',
            });

            await orgService.deleteOrganization(org.id, user.id);

            const result = await orgService.getOrganizationById(org.id, user.id);
            expect(result).toBeNull();
        });

        it('should throw error for non-existent organization', async () => {
            const user = await createTestUser();

            await expect(
                orgService.deleteOrganization('00000000-0000-0000-0000-000000000000', user.id)
            ).rejects.toThrow('Organization not found');
        });

        it('should throw error if user is not owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Protected Org',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .execute();

            await expect(
                orgService.deleteOrganization(org.id, member.id)
            ).rejects.toThrow('Only the organization owner can delete it');
        });
    });

    describe('getOrganizationMembersWithDetails', () => {
        it('should return members with user details', async () => {
            const { organization, user } = await createTestContext();

            const members = await orgService.getOrganizationMembersWithDetails(
                organization.id,
                user.id
            );

            expect(members).toHaveLength(1);
            expect(members[0].user).toBeDefined();
            expect(members[0].user.email).toBe(user.email);
            expect(members[0].user.name).toBe(user.name);
        });

        it('should throw error if user is not a member', async () => {
            const { organization } = await createTestContext();
            const outsider = await createTestUser({ email: 'outsider2@test.com' });

            await expect(
                orgService.getOrganizationMembersWithDetails(organization.id, outsider.id)
            ).rejects.toThrow('You do not have access to this organization');
        });
    });

    describe('isOwnerOrAdmin', () => {
        it('should return true for owner', async () => {
            const user = await createTestUser();

            const org = await orgService.createOrganization({
                userId: user.id,
                name: 'Owner Test',
            });

            const result = await orgService.isOwnerOrAdmin(org.id, user.id);
            expect(result).toBe(true);
        });

        it('should return true for admin', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const admin = await createTestUser({ email: 'admin@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Admin Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: admin.id,
                    role: 'admin',
                })
                .execute();

            const result = await orgService.isOwnerOrAdmin(org.id, admin.id);
            expect(result).toBe(true);
        });

        it('should return false for member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Member Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .execute();

            const result = await orgService.isOwnerOrAdmin(org.id, member.id);
            expect(result).toBe(false);
        });

        it('should return false for non-member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Non-Member Test',
            });

            const result = await orgService.isOwnerOrAdmin(org.id, outsider.id);
            expect(result).toBe(false);
        });
    });

    describe('updateMemberRole', () => {
        it('should update member role as owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Role Update Test',
            });

            const membership = await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await orgService.updateMemberRole(org.id, membership.id, 'admin', owner.id);

            const updated = await db
                .selectFrom('organization_members')
                .select('role')
                .where('id', '=', membership.id)
                .executeTakeFirst();

            expect(updated?.role).toBe('admin');
        });

        it('should throw error if non-owner/admin tries to change role', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member1 = await createTestUser({ email: 'member1@test.com' });
            const member2 = await createTestUser({ email: 'member2@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Role Perm Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member1.id,
                    role: 'member',
                })
                .execute();

            const membership2 = await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member2.id,
                    role: 'member',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await expect(
                orgService.updateMemberRole(org.id, membership2.id, 'admin', member1.id)
            ).rejects.toThrow('Only owners and admins can change member roles');
        });

        it('should throw error when trying to change owner role as non-owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const admin = await createTestUser({ email: 'admin@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Owner Role Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: admin.id,
                    role: 'admin',
                })
                .execute();

            const ownerMembership = await db
                .selectFrom('organization_members')
                .select('id')
                .where('user_id', '=', owner.id)
                .where('organization_id', '=', org.id)
                .executeTakeFirstOrThrow();

            await expect(
                orgService.updateMemberRole(org.id, ownerMembership.id, 'admin', admin.id)
            ).rejects.toThrow('Only the owner can change the owner role');
        });

        it('should throw error when trying to promote to owner as non-owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const admin = await createTestUser({ email: 'admin@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Promote Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: admin.id,
                    role: 'admin',
                })
                .execute();

            const memberMembership = await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await expect(
                orgService.updateMemberRole(org.id, memberMembership.id, 'owner', admin.id)
            ).rejects.toThrow('Only the owner can promote someone to owner');
        });

        it('should prevent owner from self-demotion', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Self Demotion Test',
            });

            const ownerMembership = await db
                .selectFrom('organization_members')
                .select('id')
                .where('user_id', '=', owner.id)
                .where('organization_id', '=', org.id)
                .executeTakeFirstOrThrow();

            await expect(
                orgService.updateMemberRole(org.id, ownerMembership.id, 'admin', owner.id)
            ).rejects.toThrow('Cannot demote yourself from owner');
        });

        it('should throw error for non-existent member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Non-Existent Member Test',
            });

            await expect(
                orgService.updateMemberRole(org.id, '00000000-0000-0000-0000-000000000000', 'admin', owner.id)
            ).rejects.toThrow('Member not found');
        });
    });

    describe('removeMember', () => {
        it('should remove member as owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Remove Member Test',
            });

            const membership = await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await orgService.removeMember(org.id, membership.id, owner.id);

            const check = await db
                .selectFrom('organization_members')
                .select('id')
                .where('id', '=', membership.id)
                .executeTakeFirst();

            expect(check).toBeUndefined();
        });

        it('should throw error if not a member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Not Member Test',
            });

            await expect(
                orgService.removeMember(org.id, '00000000-0000-0000-0000-000000000000', outsider.id)
            ).rejects.toThrow('You are not a member of this organization');
        });

        it('should throw error for non-owner/admin', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member1 = await createTestUser({ email: 'member1@test.com' });
            const member2 = await createTestUser({ email: 'member2@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Permission Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member1.id,
                    role: 'member',
                })
                .execute();

            const membership2 = await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member2.id,
                    role: 'member',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await expect(
                orgService.removeMember(org.id, membership2.id, member1.id)
            ).rejects.toThrow('Only owners and admins can remove members');
        });

        it('should not allow removing yourself', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Self Remove Test',
            });

            const ownerMembership = await db
                .selectFrom('organization_members')
                .select('id')
                .where('user_id', '=', owner.id)
                .where('organization_id', '=', org.id)
                .executeTakeFirstOrThrow();

            await expect(
                orgService.removeMember(org.id, ownerMembership.id, owner.id)
            ).rejects.toThrow('Cannot remove yourself');
        });

        it('should not allow removing owner', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const admin = await createTestUser({ email: 'admin@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Remove Owner Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: admin.id,
                    role: 'admin',
                })
                .execute();

            const ownerMembership = await db
                .selectFrom('organization_members')
                .select('id')
                .where('user_id', '=', owner.id)
                .where('organization_id', '=', org.id)
                .executeTakeFirstOrThrow();

            await expect(
                orgService.removeMember(org.id, ownerMembership.id, admin.id)
            ).rejects.toThrow('Cannot remove the organization owner');
        });

        it('should not allow admin to remove other admin', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const admin1 = await createTestUser({ email: 'admin1@test.com' });
            const admin2 = await createTestUser({ email: 'admin2@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Admin Remove Admin Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: admin1.id,
                    role: 'admin',
                })
                .execute();

            const admin2Membership = await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: admin2.id,
                    role: 'admin',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await expect(
                orgService.removeMember(org.id, admin2Membership.id, admin1.id)
            ).rejects.toThrow('Admins can only remove members');
        });

        it('should throw error for non-existent member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Non-Existent Remove Test',
            });

            await expect(
                orgService.removeMember(org.id, '00000000-0000-0000-0000-000000000000', owner.id)
            ).rejects.toThrow('Member not found');
        });
    });

    describe('leaveOrganization', () => {
        it('should allow member to leave', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const member = await createTestUser({ email: 'member@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Leave Test',
            });

            await db
                .insertInto('organization_members')
                .values({
                    organization_id: org.id,
                    user_id: member.id,
                    role: 'member',
                })
                .execute();

            await orgService.leaveOrganization(org.id, member.id);

            const check = await db
                .selectFrom('organization_members')
                .select('id')
                .where('user_id', '=', member.id)
                .where('organization_id', '=', org.id)
                .executeTakeFirst();

            expect(check).toBeUndefined();
        });

        it('should throw error for non-member', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const outsider = await createTestUser({ email: 'outsider@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Leave Non-Member Test',
            });

            await expect(
                orgService.leaveOrganization(org.id, outsider.id)
            ).rejects.toThrow('You are not a member of this organization');
        });

        it('should not allow owner to leave', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });

            const org = await orgService.createOrganization({
                userId: owner.id,
                name: 'Owner Leave Test',
            });

            await expect(
                orgService.leaveOrganization(org.id, owner.id)
            ).rejects.toThrow('Cannot leave as owner');
        });
    });
});
