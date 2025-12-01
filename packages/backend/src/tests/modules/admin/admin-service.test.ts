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

        it('should return pool stats', async () => {
            const stats = await adminService.getHealthStats();

            expect(stats.pool).toBeDefined();
            expect(stats.pool.totalConnections).toBeGreaterThanOrEqual(0);
            expect(stats.pool.idleConnections).toBeGreaterThanOrEqual(0);
            expect(stats.pool.waitingRequests).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getDatabaseStats', () => {
        it('should return database statistics', async () => {
            const stats = await adminService.getDatabaseStats();

            expect(stats).toHaveProperty('tables');
            expect(stats).toHaveProperty('totalSize');
            expect(stats).toHaveProperty('totalRows');
            expect(Array.isArray(stats.tables)).toBe(true);
        });
    });

    describe('getLogsStats', () => {
        it('should return log statistics', async () => {
            const stats = await adminService.getLogsStats();

            expect(stats).toHaveProperty('total');
            expect(stats).toHaveProperty('perDay');
            expect(stats).toHaveProperty('topOrganizations');
            expect(stats).toHaveProperty('topProjects');
            expect(stats).toHaveProperty('growth');
            expect(Array.isArray(stats.perDay)).toBe(true);
        });

        it('should count logs with projects', async () => {
            const { project } = await createTestContext();
            await createTestLog({ projectId: project.id });
            await createTestLog({ projectId: project.id });

            const stats = await adminService.getLogsStats();

            expect(stats.total).toBe(2);
        });
    });

    describe('getPerformanceStats', () => {
        it('should return performance statistics', async () => {
            const stats = await adminService.getPerformanceStats();

            expect(stats).toHaveProperty('ingestion');
            expect(stats).toHaveProperty('storage');
            expect(stats.ingestion).toHaveProperty('throughput');
            expect(stats.ingestion).toHaveProperty('avgLatency');
            expect(stats.storage).toHaveProperty('logsSize');
        });
    });

    describe('getAlertsStats', () => {
        it('should return alert system statistics', async () => {
            const stats = await adminService.getAlertsStats();

            expect(stats).toHaveProperty('rules');
            expect(stats).toHaveProperty('triggered');
            expect(stats).toHaveProperty('perOrganization');
            expect(stats).toHaveProperty('notifications');
            expect(stats.rules).toHaveProperty('total');
            expect(stats.rules).toHaveProperty('active');
            expect(stats.rules).toHaveProperty('disabled');
        });
    });

    describe('getRedisStats', () => {
        it('should return Redis statistics', async () => {
            const stats = await adminService.getRedisStats();

            expect(stats).toHaveProperty('memory');
            expect(stats).toHaveProperty('queues');
            expect(stats).toHaveProperty('connections');
            expect(stats.memory).toHaveProperty('used');
            expect(stats.memory).toHaveProperty('peak');
        });
    });

    describe('updateUserStatus', () => {
        it('should disable a user', async () => {
            const user = await createTestUser();

            const result = await adminService.updateUserStatus(user.id, true);

            expect(result.disabled).toBe(true);
        });

        it('should enable a user', async () => {
            const user = await createTestUser();
            await db.updateTable('users').set({ disabled: true }).where('id', '=', user.id).execute();

            const result = await adminService.updateUserStatus(user.id, false);

            expect(result.disabled).toBe(false);
        });

        it('should delete sessions when disabling user', async () => {
            const user = await createTestUser();
            // Create a session
            await db.insertInto('sessions').values({
                user_id: user.id,
                token: 'test-token',
                expires_at: new Date(Date.now() + 3600000),
            }).execute();

            await adminService.updateUserStatus(user.id, true);

            const sessions = await db.selectFrom('sessions').selectAll().where('user_id', '=', user.id).execute();
            expect(sessions.length).toBe(0);
        });
    });

    describe('resetUserPassword', () => {
        it('should reset user password', async () => {
            const user = await createTestUser();
            const oldHash = user.password_hash;

            const result = await adminService.resetUserPassword(user.id, 'newpassword123');

            expect(result.id).toBe(user.id);
            // Verify password was changed
            const updatedUser = await db.selectFrom('users').select('password_hash').where('id', '=', user.id).executeTakeFirst();
            expect(updatedUser?.password_hash).not.toBe(oldHash);
        });

        it('should delete sessions after password reset', async () => {
            const user = await createTestUser();
            await db.insertInto('sessions').values({
                user_id: user.id,
                token: 'test-token-2',
                expires_at: new Date(Date.now() + 3600000),
            }).execute();

            await adminService.resetUserPassword(user.id, 'newpassword456');

            const sessions = await db.selectFrom('sessions').selectAll().where('user_id', '=', user.id).execute();
            expect(sessions.length).toBe(0);
        });
    });

    describe('deleteOrganization', () => {
        it('should delete an organization', async () => {
            const org = await createTestOrganization();

            const result = await adminService.deleteOrganization(org.id);

            expect(result.message).toContain('deleted');

            const deletedOrg = await db.selectFrom('organizations').selectAll().where('id', '=', org.id).executeTakeFirst();
            expect(deletedOrg).toBeUndefined();
        });
    });

    describe('deleteProject', () => {
        it('should delete a project', async () => {
            const { project } = await createTestContext();

            const result = await adminService.deleteProject(project.id);

            expect(result.message).toContain('deleted');
        });

        it('should throw error for non-existent project', async () => {
            await expect(
                adminService.deleteProject('00000000-0000-0000-0000-000000000000')
            ).rejects.toThrow('Project not found');
        });
    });

    describe('getCacheStats', () => {
        it('should return cache statistics with enabled status', async () => {
            const stats = await adminService.getCacheStats();

            expect(stats).toHaveProperty('hits');
            expect(stats).toHaveProperty('misses');
            expect(stats).toHaveProperty('hitRate');
            expect(stats).toHaveProperty('keyCount');
            expect(stats).toHaveProperty('enabled');
        });
    });

    describe('clearCache', () => {
        it('should clear all caches', async () => {
            const result = await adminService.clearCache();

            expect(result).toHaveProperty('cleared');
            expect(typeof result.cleared).toBe('number');
        });
    });

    describe('invalidateProjectCache', () => {
        it('should invalidate project cache without error', async () => {
            const { project } = await createTestContext();

            // Should not throw
            await expect(adminService.invalidateProjectCache(project.id)).resolves.not.toThrow();
        });
    });
});
