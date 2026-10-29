import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../../database/index.js';
import { AdminService, escapeLikeTerm } from '../../../modules/admin/service.js';
import {
    createTestUser,
    createTestOrganization,
    createTestProject,
    createTestLog,
    createTestAlertRule,
} from '../../helpers/factories.js';

async function cleanDb() {
    await db.deleteFrom('metering_events').execute();
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
}

async function softDelete(projectId: string) {
    await db.updateTable('projects').set({ deleted_at: new Date() }).where('id', '=', projectId).execute();
}

describe('admin listing correctness', () => {
    let service: AdminService;

    beforeEach(async () => {
        service = new AdminService();
        await cleanDb();
    });

    describe('search', () => {
        it('escapes LIKE wildcards and the escape char', () => {
            expect(escapeLikeTerm('100%_a\\b')).toBe('100\\%\\_a\\\\b');
        });

        it('treats % and _ in user search literally', async () => {
            await createTestUser({ email: 'percent%user@test.com', name: 'P' });
            await createTestUser({ email: 'plain@test.com', name: 'Q' });
            await createTestUser({ email: 'under_score@test.com', name: 'R' });
            await createTestUser({ email: 'underxscore@test.com', name: 'S' });

            const pct = await service.getUsers(1, 50, '%');
            expect(pct.users.map((u) => u.email)).toEqual(['percent%user@test.com']);
            expect(pct.total).toBe(1);

            const und = await service.getUsers(1, 50, 'under_');
            expect(und.users.map((u) => u.email)).toEqual(['under_score@test.com']);
        });

        it('trims the term and ignores a blank search', async () => {
            await createTestUser({ email: 'alice@test.com', name: 'Alice' });
            await createTestUser({ email: 'bob@test.com', name: 'Bob' });
            expect((await service.getUsers(1, 50, '  alice  ')).total).toBe(1);
            expect((await service.getUsers(1, 50, '   ')).total).toBe(2);
        });

        it('escapes org and project searches too', async () => {
            const owner = await createTestUser({ email: 'o@test.com' });
            const org = await createTestOrganization({ name: 'Acme_1', ownerId: owner.id });
            await createTestOrganization({ name: 'AcmeX1', ownerId: owner.id });
            await createTestProject({ organizationId: org.id, name: 'proj 50%' });
            await createTestProject({ organizationId: org.id, name: 'proj 500' });

            const orgs = await service.getOrganizations(1, 50, 'acme_');
            expect(orgs.organizations.map((o) => o.name)).toEqual(['Acme_1']);

            const projects = await service.getProjects(1, 50, '50%');
            expect(projects.projects.map((p) => p.name)).toEqual(['proj 50%']);
        });
    });

    describe('soft-deleted projects', () => {
        it('are excluded from lists, counts and stats', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const org = await createTestOrganization({ ownerId: owner.id });
            const live = await createTestProject({ organizationId: org.id, name: 'live' });
            const gone = await createTestProject({ organizationId: org.id, name: 'gone' });
            await createTestAlertRule({ organizationId: org.id, projectId: live.id });
            await createTestAlertRule({ organizationId: org.id, projectId: gone.id });
            await softDelete(gone.id);

            const list = await service.getProjects();
            expect(list.projects.map((p) => p.id)).toEqual([live.id]);
            expect(list.total).toBe(1);

            const stats = await service.getSystemStats();
            expect(stats.projects.total).toBe(1);

            const orgs = await service.getOrganizations();
            expect(orgs.organizations[0].projectCount).toBe(1);

            const details = await service.getOrganizationDetails(org.id);
            expect(details.projects.map((p) => p.id)).toEqual([live.id]);

            const alerts = await service.getAlertsStats();
            expect(alerts.rules.total).toBe(1);
            expect(alerts.perOrganization[0].rulesCount).toBe(1);
        });

        it('keeps soft-deleted logs out of top projects', async () => {
            const owner = await createTestUser({ email: 'owner@test.com' });
            const org = await createTestOrganization({ ownerId: owner.id });
            const live = await createTestProject({ organizationId: org.id, name: 'live' });
            const gone = await createTestProject({ organizationId: org.id, name: 'gone' });
            await createTestLog({ projectId: live.id });
            await createTestLog({ projectId: gone.id });
            await softDelete(gone.id);

            const stats = await service.getLogsStats();
            expect(stats.topProjects.map((p) => p.projectId)).not.toContain(gone.id);
        });

        it('are still returned by project details, flagged with deletedAt', async () => {
            const project = await createTestProject();
            await softDelete(project.id);
            const details = await service.getProjectDetails(project.id);
            expect(details.id).toBe(project.id);
            expect(details.deletedAt).not.toBeNull();
        });
    });

    describe('user details', () => {
        it('counts only non-expired sessions as active', async () => {
            const user = await createTestUser({ email: 's@test.com' });
            const mk = (ms: number) =>
                db
                    .insertInto('sessions')
                    .values({
                        user_id: user.id,
                        token: crypto.randomBytes(16).toString('hex'),
                        expires_at: new Date(Date.now() + ms),
                    })
                    .execute();
            await mk(60 * 60 * 1000);
            await mk(-60 * 60 * 1000);
            await mk(-24 * 60 * 60 * 1000);

            const details = await service.getUserDetails(user.id);
            expect(details!.activeSessions).toBe(1);
        });
    });

    describe('project log window', () => {
        it('counts only the last 30 days and reports the newest log', async () => {
            const project = await createTestProject();
            const recent = new Date(Date.now() - 60 * 60 * 1000);
            await createTestLog({ projectId: project.id, time: new Date(Date.now() - 2 * 60 * 60 * 1000) });
            await createTestLog({ projectId: project.id, time: recent });
            await createTestLog({ projectId: project.id, time: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) });

            const details = await service.getProjectDetails(project.id);
            expect(details.logs30d).toBe(2);
            expect(details.logsCount).toBe(2);
            expect(details.logsWindowDays).toBe(30);
            expect(new Date(details.lastLogTime as any).getTime()).toBe(recent.getTime());
        });

        it('falls back to has_logs_at when nothing is in the window', async () => {
            const project = await createTestProject();
            const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            await db.updateTable('projects').set({ has_logs_at: old }).where('id', '=', project.id).execute();
            const details = await service.getProjectDetails(project.id);
            expect(details.logs30d).toBe(0);
            expect(new Date(details.lastLogTime as any).getTime()).toBe(old.getTime());
        });

        it('lists logs30d per project', async () => {
            const project = await createTestProject();
            await createTestLog({ projectId: project.id });
            const list = await service.getProjects();
            expect(list.projects[0].logs30d).toBe(1);
        });
    });
});
