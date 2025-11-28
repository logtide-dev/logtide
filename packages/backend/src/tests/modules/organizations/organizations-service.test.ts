import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { OrganizationsService } from '../../../modules/organizations/service.js';
import { createTestUser, createTestOrganization, createTestContext } from '../../helpers/factories.js';

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
});
