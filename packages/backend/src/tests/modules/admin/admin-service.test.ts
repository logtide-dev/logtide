import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'kysely';
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

            // Update pg statistics so approximate_row_count returns correct value
            await sql`ANALYZE logs`.execute(db);

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

    describe('updateUserRole', () => {
        it('should update user to admin', async () => {
            const user = await createTestUser();

            const result = await adminService.updateUserRole(user.id, true);

            expect(result.is_admin).toBe(true);
        });

        it('should remove admin role from user', async () => {
            // Another active admin must remain (last-admin guard)
            const other = await createTestUser({ email: 'other-admin@test.com' });
            await db.updateTable('users').set({ is_admin: true }).where('id', '=', other.id).execute();
            const user = await createTestUser();
            await db.updateTable('users').set({ is_admin: true }).where('id', '=', user.id).execute();

            const result = await adminService.updateUserRole(user.id, false);

            expect(result.is_admin).toBe(false);
        });

        it('should throw error for non-existent user', async () => {
            await expect(
                adminService.updateUserRole('00000000-0000-0000-0000-000000000000', true)
            ).rejects.toThrow('User not found');
        });
    });

    describe('updateUserStatus edge cases', () => {
        it('should throw error for non-existent user', async () => {
            await expect(
                adminService.updateUserStatus('00000000-0000-0000-0000-000000000000', true)
            ).rejects.toThrow('User not found');
        });
    });

    describe('resetUserPassword edge cases', () => {
        it('should throw error for non-existent user', async () => {
            await expect(
                adminService.resetUserPassword('00000000-0000-0000-0000-000000000000', 'newpass')
            ).rejects.toThrow('User not found');
        });
    });

    describe('getCompressionStats', () => {
        it('should return compression statistics array', async () => {
            const stats = await adminService.getCompressionStats();

            expect(Array.isArray(stats)).toBe(true);
            // Each item should have the expected structure
            for (const stat of stats) {
                expect(stat).toHaveProperty('hypertable');
                expect(stat).toHaveProperty('totalChunks');
                expect(stat).toHaveProperty('compressedChunks');
                expect(stat).toHaveProperty('uncompressedSizeBytes');
                expect(stat).toHaveProperty('compressedSizeBytes');
                expect(stat).toHaveProperty('compressionRatio');
                expect(stat).toHaveProperty('spaceSavedBytes');
                expect(stat).toHaveProperty('spaceSavedPretty');
            }
        });

        it('should return empty array when no hypertables have compression', async () => {
            // In test environment, there may be no compressed chunks yet
            const stats = await adminService.getCompressionStats();

            // Should not throw, should return array (possibly empty)
            expect(Array.isArray(stats)).toBe(true);
        });
    });

    describe('getAggregateStats', () => {
        it('should return aggregate statistics array', async () => {
            const stats = await adminService.getAggregateStats();

            expect(Array.isArray(stats)).toBe(true);
            // Each item should have the expected structure
            for (const stat of stats) {
                expect(stat).toHaveProperty('viewName');
                expect(stat).toHaveProperty('hypertableName');
                expect(stat).toHaveProperty('lastRefresh');
                expect(stat).toHaveProperty('refreshInterval');
                expect(stat).toHaveProperty('totalRows');
            }
        });

        it('should return empty array when no continuous aggregates exist', async () => {
            // In test environment, aggregates may or may not exist
            const stats = await adminService.getAggregateStats();

            // Should not throw, should return array
            expect(Array.isArray(stats)).toBe(true);
        });
    });

    describe('getOrganizations with member/project counts', () => {
        it('should return organizations with memberCount and projectCount', async () => {
            const { organization, user } = await createTestContext();

            const result = await adminService.getOrganizations(1, 10);

            expect(result.organizations.length).toBeGreaterThan(0);
            const org = result.organizations.find((o) => o.id === organization.id);
            expect(org).toBeDefined();
            expect(org).toHaveProperty('memberCount');
            expect(org).toHaveProperty('projectCount');
            expect(org?.memberCount).toBeGreaterThanOrEqual(1); // At least the owner
            expect(org?.projectCount).toBeGreaterThanOrEqual(1); // At least one project from createTestContext
        });
    });

    describe('getProjects with counts', () => {
        it('should return projects with logsCount, apiKeysCount, alertRulesCount', async () => {
            const { project } = await createTestContext();
            await createTestLog({ projectId: project.id });

            const result = await adminService.getProjects(1, 10);

            expect(result.projects.length).toBeGreaterThan(0);
            const proj = result.projects.find((p) => p.id === project.id);
            expect(proj).toBeDefined();
            expect(proj).toHaveProperty('logsCount');
            expect(proj).toHaveProperty('apiKeysCount');
            expect(proj).toHaveProperty('alertRulesCount');
        });
    });

    describe('getHealthStats edge cases', () => {
        it('should handle degraded database latency', async () => {
            // This test ensures the latency thresholds are applied correctly
            const stats = await adminService.getHealthStats();

            // Database status should be one of the valid values
            expect(['healthy', 'degraded', 'down']).toContain(stats.database.status);
            expect(['healthy', 'degraded', 'down', 'not_configured']).toContain(stats.redis.status);
            expect(['healthy', 'degraded', 'down']).toContain(stats.overall);
        });

        it('should include all required fields', async () => {
            const stats = await adminService.getHealthStats();

            expect(stats.database).toHaveProperty('status');
            expect(stats.database).toHaveProperty('latency');
            expect(stats.database).toHaveProperty('connections');
            expect(stats.redis).toHaveProperty('status');
            expect(stats.redis).toHaveProperty('latency');
            expect(stats.pool).toHaveProperty('totalConnections');
            expect(stats.pool).toHaveProperty('idleConnections');
            expect(stats.pool).toHaveProperty('waitingRequests');
        });
    });

    describe('getSystemStats with growth metrics', () => {
        it('should return growth metrics for users, orgs, and projects', async () => {
            const stats = await adminService.getSystemStats();

            expect(stats.users.growth).toHaveProperty('today');
            expect(stats.users.growth).toHaveProperty('week');
            expect(stats.users.growth).toHaveProperty('month');
            expect(stats.organizations.growth).toHaveProperty('today');
            expect(stats.organizations.growth).toHaveProperty('week');
            expect(stats.organizations.growth).toHaveProperty('month');
            expect(stats.projects.growth).toHaveProperty('today');
            expect(stats.projects.growth).toHaveProperty('week');
            expect(stats.projects.growth).toHaveProperty('month');
        });

        it('should count active users', async () => {
            // Create a user with recent login
            const user = await createTestUser();
            await db.updateTable('users').set({ last_login: new Date() }).where('id', '=', user.id).execute();

            const stats = await adminService.getSystemStats();

            expect(stats.users).toHaveProperty('active');
            expect(stats.users.active).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getLogsStats with top organizations and projects', () => {
        it('should return top organizations by log count', async () => {
            const { project } = await createTestContext();
            await createTestLog({ projectId: project.id });

            const stats = await adminService.getLogsStats();

            expect(Array.isArray(stats.topOrganizations)).toBe(true);
            expect(Array.isArray(stats.topProjects)).toBe(true);
        });

        it('should return growth metrics', async () => {
            const stats = await adminService.getLogsStats();

            expect(stats.growth).toHaveProperty('logsPerHour');
            expect(stats.growth).toHaveProperty('logsPerDay');
        });
    });

    describe('getPerformanceStats', () => {
        it('should return ingestion throughput and latency', async () => {
            const stats = await adminService.getPerformanceStats();

            expect(stats.ingestion).toHaveProperty('throughput');
            expect(stats.ingestion).toHaveProperty('avgLatency');
            expect(typeof stats.ingestion.throughput).toBe('number');
            expect(typeof stats.ingestion.avgLatency).toBe('number');
        });

        it('should return storage stats with compression ratio', async () => {
            const stats = await adminService.getPerformanceStats();

            expect(stats.storage).toHaveProperty('logsSize');
            expect(stats.storage).toHaveProperty('compressionRatio');
            expect(typeof stats.storage.compressionRatio).toBe('number');
        });
    });

    describe('getAlertsStats with notifications', () => {
        it('should return notification success/failed counts', async () => {
            const stats = await adminService.getAlertsStats();

            expect(stats.notifications).toHaveProperty('success');
            expect(stats.notifications).toHaveProperty('failed');
            expect(typeof stats.notifications.success).toBe('number');
            expect(typeof stats.notifications.failed).toBe('number');
        });
    });

    describe('getPlatformTimeline', () => {
        it('should return timeline structure', async () => {
            const result = await adminService.getPlatformTimeline(24);

            expect(result).toHaveProperty('timeline');
            expect(Array.isArray(result.timeline)).toBe(true);
        });

        it('should accept custom hours parameter', async () => {
            const result = await adminService.getPlatformTimeline(48);

            expect(result).toHaveProperty('timeline');
            expect(Array.isArray(result.timeline)).toBe(true);
        });

        it('should use default 24 hours when no parameter given', async () => {
            const result = await adminService.getPlatformTimeline();

            expect(result).toHaveProperty('timeline');
        });

        it('should return timeline items with correct shape', async () => {
            const result = await adminService.getPlatformTimeline(24);

            for (const item of result.timeline) {
                expect(item).toHaveProperty('bucket');
                expect(item).toHaveProperty('logsCount');
                expect(item).toHaveProperty('detectionsCount');
                expect(item).toHaveProperty('spansCount');
                expect(typeof item.logsCount).toBe('number');
                expect(typeof item.detectionsCount).toBe('number');
                expect(typeof item.spansCount).toBe('number');
            }
        });

        it('should return sorted timeline by bucket', async () => {
            const result = await adminService.getPlatformTimeline(24);

            if (result.timeline.length > 1) {
                for (let i = 1; i < result.timeline.length; i++) {
                    const prev = new Date(result.timeline[i - 1].bucket).getTime();
                    const curr = new Date(result.timeline[i].bucket).getTime();
                    expect(curr).toBeGreaterThanOrEqual(prev);
                }
            }
        });
    });

    describe('getActiveIssues', () => {
        it('should return active issues structure', async () => {
            const result = await adminService.getActiveIssues();

            expect(result).toHaveProperty('openIncidents');
            expect(result).toHaveProperty('criticalDetections24h');
            expect(result).toHaveProperty('failedNotifications24h');
            expect(result).toHaveProperty('openErrorGroups');
        });

        it('should return numeric values', async () => {
            const result = await adminService.getActiveIssues();

            expect(typeof result.openIncidents).toBe('number');
            expect(typeof result.criticalDetections24h).toBe('number');
            expect(typeof result.failedNotifications24h).toBe('number');
            expect(typeof result.openErrorGroups).toBe('number');
        });

        it('should return zero counts when no issues exist', async () => {
            const result = await adminService.getActiveIssues();

            expect(result.openIncidents).toBeGreaterThanOrEqual(0);
            expect(result.criticalDetections24h).toBeGreaterThanOrEqual(0);
            expect(result.failedNotifications24h).toBeGreaterThanOrEqual(0);
            expect(result.openErrorGroups).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getActiveIssues incident sources', () => {
        it('counts open and investigating incidents of every source, not resolved ones', async () => {
            const { organization } = await createTestContext();
            await db.deleteFrom('incidents').execute();
            const base = { organization_id: organization.id, severity: 'high' as const, title: 'Incident' };
            await db.insertInto('incidents').values([
                { ...base, source: 'sigma', status: 'open' },
                { ...base, source: 'alert', status: 'open' },
                { ...base, source: 'monitor', status: 'investigating' },
                { ...base, source: 'manual', status: 'open' },
                { ...base, source: 'alert', status: 'resolved' },
            ]).execute();

            const result = await adminService.getActiveIssues();

            expect(result.openIncidents).toBe(4);
        });
    });

    describe('checkVersion', () => {
        it('should return version check result structure', async () => {
            const result = await adminService.checkVersion();

            expect(result).toHaveProperty('currentVersion');
            expect(result).toHaveProperty('channel');
            expect(result).toHaveProperty('latestStable');
            expect(result).toHaveProperty('latestBeta');
            expect(result).toHaveProperty('updateAvailable');
            expect(result).toHaveProperty('checkedAt');
        });

        it('should return current version as string', async () => {
            const result = await adminService.checkVersion();

            expect(typeof result.currentVersion).toBe('string');
            expect(result.currentVersion).toMatch(/^\d+\.\d+\.\d+/);
        });

        it('should return boolean for updateAvailable', async () => {
            const result = await adminService.checkVersion();

            expect(typeof result.updateAvailable).toBe('boolean');
        });

        it('should return ISO string for checkedAt', async () => {
            const result = await adminService.checkVersion();

            expect(typeof result.checkedAt).toBe('string');
            expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
        });

        it('should return valid channel value', async () => {
            const result = await adminService.checkVersion();

            expect(['stable', 'beta']).toContain(result.channel);
        });
    });

    describe('getSlowQueries', () => {
        it('should return slow queries structure', async () => {
            const result = await adminService.getSlowQueries();

            expect(result).toHaveProperty('activeQueries');
            expect(result).toHaveProperty('topSlowQueries');
            expect(result).toHaveProperty('pgStatStatementsAvailable');
        });

        it('should return arrays for queries', async () => {
            const result = await adminService.getSlowQueries();

            expect(Array.isArray(result.activeQueries)).toBe(true);
            expect(Array.isArray(result.topSlowQueries)).toBe(true);
        });

        it('should return boolean for pgStatStatementsAvailable', async () => {
            const result = await adminService.getSlowQueries();

            expect(typeof result.pgStatStatementsAvailable).toBe('boolean');
        });

        it('should return active queries with correct shape', async () => {
            const result = await adminService.getSlowQueries();

            for (const q of result.activeQueries) {
                expect(q).toHaveProperty('pid');
                expect(q).toHaveProperty('durationMs');
                expect(q).toHaveProperty('state');
                expect(q).toHaveProperty('query');
                expect(q).toHaveProperty('applicationName');
                expect(q).toHaveProperty('startedAt');
            }
        });
    });
});
