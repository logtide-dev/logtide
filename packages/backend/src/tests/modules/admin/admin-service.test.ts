import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { AdminService } from '../../../modules/admin/service.js';
import { createTestContext, createTestUser, createTestOrganization, createTestProject, createTestLog } from '../../helpers/factories.js';

describe('AdminService', () => {
    let adminService: AdminService;

    beforeEach(async () => {
        adminService = new AdminService();

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

    describe('getUsers', () => {
        it('should return empty list when no users exist', async () => {
            const result = await adminService.getUsers();

            expect(result.users).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('should return all users with pagination info', async () => {
            await createTestUser({ email: 'user1@test.com', name: 'User 1' });
            await createTestUser({ email: 'user2@test.com', name: 'User 2' });
            await createTestUser({ email: 'user3@test.com', name: 'User 3' });

            const result = await adminService.getUsers(1, 10);

            expect(result.users).toHaveLength(3);
            expect(result.total).toBe(3);
            expect(result.page).toBe(1);
        });

        it('should respect limit parameter', async () => {
            for (let i = 0; i < 5; i++) {
                await createTestUser({ email: `user${i}@test.com` });
            }

            const result = await adminService.getUsers(1, 2);

            expect(result.users).toHaveLength(2);
            expect(result.total).toBe(5);
            expect(result.totalPages).toBe(3);
        });

        it('should search by email', async () => {
            await createTestUser({ email: 'john@example.com', name: 'John' });
            await createTestUser({ email: 'jane@example.com', name: 'Jane' });
            await createTestUser({ email: 'bob@other.com', name: 'Bob' });

            const result = await adminService.getUsers(1, 10, 'example');

            expect(result.users).toHaveLength(2);
            expect(result.users.every((u) => u.email.includes('example'))).toBe(true);
        });

        it('should search by name', async () => {
            await createTestUser({ email: 'john@test.com', name: 'John Smith' });
            await createTestUser({ email: 'jane@test.com', name: 'Jane Doe' });

            const result = await adminService.getUsers(1, 10, 'John');

            expect(result.users).toHaveLength(1);
            expect(result.users[0].name).toBe('John Smith');
        });
    });

    describe('getUserDetails', () => {
        it('should return null for non-existent user', async () => {
            const result = await adminService.getUserDetails('00000000-0000-0000-0000-000000000000');

            expect(result).toBeNull();
        });

        it('should return user details', async () => {
            const user = await createTestUser({ email: 'test@test.com', name: 'Test User' });

            const result = await adminService.getUserDetails(user.id);

            expect(result).not.toBeNull();
            expect(result?.email).toBe('test@test.com');
            expect(result?.name).toBe('Test User');
        });

        it('should include organization memberships', async () => {
            const { user, organization } = await createTestContext();

            const result = await adminService.getUserDetails(user.id);

            expect(result?.organizations).toBeDefined();
            expect(result?.organizations.length).toBeGreaterThan(0);
        });
    });

    describe('getOrganizations', () => {
        it('should return empty list when no organizations exist', async () => {
            const result = await adminService.getOrganizations();

            expect(result.organizations).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('should return all organizations', async () => {
            await createTestOrganization({ name: 'Org 1' });
            await createTestOrganization({ name: 'Org 2' });
            await createTestOrganization({ name: 'Org 3' });

            const result = await adminService.getOrganizations(1, 10);

            expect(result.organizations).toHaveLength(3);
            expect(result.total).toBe(3);
        });

        it('should search by organization name', async () => {
            await createTestOrganization({ name: 'Acme Corp' });
            await createTestOrganization({ name: 'Acme Inc' });
            await createTestOrganization({ name: 'Other Company' });

            const result = await adminService.getOrganizations(1, 10, 'Acme');

            expect(result.organizations).toHaveLength(2);
        });
    });

    describe('getOrganizationDetails', () => {
        it('should throw error for non-existent organization', async () => {
            await expect(
                adminService.getOrganizationDetails('00000000-0000-0000-0000-000000000000')
            ).rejects.toThrow('Organization not found');
        });

        it('should return organization details', async () => {
            const org = await createTestOrganization({ name: 'My Org' });

            const result = await adminService.getOrganizationDetails(org.id);

            expect(result).not.toBeNull();
            expect(result?.name).toBe('My Org');
        });

        it('should include members list', async () => {
            const { organization, user } = await createTestContext();

            const result = await adminService.getOrganizationDetails(organization.id);

            expect(result?.members).toBeDefined();
            expect(result?.members.length).toBeGreaterThan(0);
        });
    });

    describe('getProjects', () => {
        it('should return empty list when no projects exist', async () => {
            const result = await adminService.getProjects();

            expect(result.projects).toEqual([]);
            expect(result.total).toBe(0);
        });

        it('should return all projects', async () => {
            await createTestProject({ name: 'Project 1' });
            await createTestProject({ name: 'Project 2' });
            await createTestProject({ name: 'Project 3' });

            const result = await adminService.getProjects(1, 10);

            expect(result.projects).toHaveLength(3);
            expect(result.total).toBe(3);
        });

        it('should search by project name', async () => {
            await createTestProject({ name: 'Backend API' });
            await createTestProject({ name: 'Backend Worker' });
            await createTestProject({ name: 'Frontend App' });

            const result = await adminService.getProjects(1, 10, 'Backend');

            expect(result.projects).toHaveLength(2);
        });
    });

    describe('getProjectDetails', () => {
        it('should throw error for non-existent project', async () => {
            await expect(
                adminService.getProjectDetails('00000000-0000-0000-0000-000000000000')
            ).rejects.toThrow('Project not found');
        });

        it('should return project details', async () => {
            const { project } = await createTestContext();

            const result = await adminService.getProjectDetails(project.id);

            expect(result).not.toBeNull();
            expect(result?.name).toBe(project.name);
        });

        it('should include API keys array', async () => {
            const { project } = await createTestContext();

            const result = await adminService.getProjectDetails(project.id);

            expect(result?.apiKeys).toBeDefined();
            expect(result?.apiKeys.length).toBeGreaterThanOrEqual(1);
        });

        it('should include logs count', async () => {
            const { project } = await createTestContext();
            await createTestLog({ projectId: project.id });
            await createTestLog({ projectId: project.id });

            const result = await adminService.getProjectDetails(project.id);

            expect(result?.logsCount).toBe(2);
        });
    });

    describe('getSystemStats', () => {
        it('should return stats structure', async () => {
            const stats = await adminService.getSystemStats();

            expect(stats.users).toBeDefined();
            expect(stats.organizations).toBeDefined();
            expect(stats.projects).toBeDefined();
        });

        it('should count total users', async () => {
            await createTestUser();
            await createTestUser();
            await createTestUser();

            const stats = await adminService.getSystemStats();

            expect(stats.users.total).toBe(3);
        });
    });

    describe('getHealthStats', () => {
        it('should return health status structure', async () => {
            const stats = await adminService.getHealthStats();

            expect(stats.database).toBeDefined();
            expect(stats.redis).toBeDefined();
            expect(stats.overall).toBeDefined();
        });

        it('should return healthy status for database', async () => {
            const stats = await adminService.getHealthStats();

            expect(stats.database.status).toBe('healthy');
            expect(stats.database.latency).toBeGreaterThanOrEqual(0);
        });
    });
});
