import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { projectsRoutes } from '../../../modules/projects/routes.js';
import { ingestionService } from '../../../modules/ingestion/service.js';
import { meteringRecorder } from '../../../modules/metering/index.js';
import { createTestContext, createTestUser, createTestProject, createTestOrganization } from '../../helpers/factories.js';
import crypto from 'crypto';

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

describe('Projects Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(projectsRoutes, { prefix: '/api/v1/projects' });
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
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

        // Create test context
        const context = await createTestContext();
        testUser = context.user;
        testOrganization = context.organization;
        testProject = context.project;

        // Create session for auth
        const session = await createTestSession(testUser.id);
        authToken = session.token;
    });

    describe('POST /api/v1/projects', () => {
        it('should create a project', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/projects',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    name: 'New Project',
                    description: 'A test project',
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.project).toBeDefined();
            expect(body.project.name).toBe('New Project');
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/projects',
                payload: {
                    organizationId: testOrganization.id,
                    name: 'Test Project',
                },
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return 400 for invalid payload', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/projects',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    // Missing organizationId and name
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 403 for non-member organization', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/projects',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    name: 'Unauthorized Project',
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/projects', () => {
        it('should get projects for organization', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.projects).toBeDefined();
            expect(body.projects.length).toBeGreaterThan(0);
        });

        it('should return 400 without organizationId', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/projects',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should exclude soft-deleted projects by default', async () => {
            // Soft-delete the test project
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects?organizationId=${testOrganization.id}`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            const ids = body.projects.map((p: any) => p.id);
            expect(ids).not.toContain(testProject.id);
        });

        it('should include soft-deleted projects when includeDeleted=true', async () => {
            // Soft-delete the test project
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects?organizationId=${testOrganization.id}&includeDeleted=true`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            const ids = body.projects.map((p: any) => p.id);
            expect(ids).toContain(testProject.id);
        });
    });

    describe('GET /api/v1/projects/:id', () => {
        it('should get project by ID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.project.id).toBe(testProject.id);
        });

        it('should return 404 for non-existent project', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 404 for a soft-deleted project', async () => {
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 404 for unauthorized access', async () => {
            const otherUser = await createTestUser({ email: 'other@test.com' });
            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('PUT /api/v1/projects/:id', () => {
        it('should update project', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: `/api/v1/projects/${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'Updated Project Name',
                    description: 'Updated description',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.project.name).toBe('Updated Project Name');
        });

        it('should return 404 for non-existent project', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    name: 'Updated',
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 409 when updating a soft-deleted project', async () => {
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            const response = await app.inject({
                method: 'PUT',
                url: `/api/v1/projects/${testProject.id}`,
                headers: { Authorization: `Bearer ${authToken}` },
                payload: { name: 'New Name' },
            });

            expect(response.statusCode).toBe(409);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('deleted');
        });
    });

    describe('DELETE /api/v1/projects/:id', () => {
        it('should delete project', async () => {
            // Create a separate project to delete
            const projectToDelete = await createTestProject({
                organizationId: testOrganization.id,
                userId: testUser.id,
                name: 'To Delete',
            });

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/projects/${projectToDelete.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(204);

            // Verify deleted
            const getResponse = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${projectToDelete.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });
            expect(getResponse.statusCode).toBe(404);
        });

        it('should return 404 for non-existent project', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/api/v1/projects/00000000-0000-0000-0000-000000000000',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 409 when project is already soft-deleted', async () => {
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/projects/${testProject.id}`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(409);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('already deleted');
        });

        it('should return 400 for invalid project ID format', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/api/v1/projects/not-a-uuid',
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('POST /api/v1/projects/:id/restore', () => {
        it('should restore a soft-deleted project', async () => {
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/projects/${testProject.id}/restore`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.project.id).toBe(testProject.id);
            expect(body.project.deletedAt).toBeNull();
        });

        it('should return 409 when project is not deleted', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/projects/${testProject.id}/restore`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(409);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('not deleted');
        });

        it('should return 409 when an active project has reused the name', async () => {
            // Soft-delete the test project, freeing its name and slug.
            await db.updateTable('projects')
                .set({ deleted_at: new Date() })
                .where('id', '=', testProject.id)
                .execute();

            // A new active project takes the freed name.
            await db.insertInto('projects')
                .values({
                    organization_id: testOrganization.id,
                    user_id: testUser.id,
                    name: testProject.name,
                    slug: `${testProject.slug}-new`,
                })
                .execute();

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/projects/${testProject.id}/restore`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(409);
            const body = JSON.parse(response.payload);
            expect(body.error).toContain('already exists');
        });

        it('should return 404 for non-existent project', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/projects/00000000-0000-0000-0000-000000000000/restore',
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(404);
        });

        it('should return 400 for invalid project ID format', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/projects/not-a-uuid/restore',
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(400);
        });

        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/projects/${testProject.id}/restore`,
            });

            expect(response.statusCode).toBe(401);
        });
    });

    describe('GET /:id/ingestion-health', () => {
        let otherOrgProjectId: string;

        beforeEach(async () => {
            // Second organization the test user is not a member of.
            const otherOrg = await createTestOrganization();
            const otherProject = await createTestProject({ organizationId: otherOrg.id });
            otherOrgProjectId = otherProject.id;
        });

        it('returns null skew when nothing was recorded', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}/ingestion-health`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ skew: null });
        });

        it('aggregates skew events from the last 24h', async () => {
            const olderEventTime = new Date(Date.now() - 60 * 60 * 1000);
            const newestEventTime = new Date(Date.now() - 30 * 60 * 1000);

            await db
                .insertInto('metering_events')
                .values([
                    {
                        organization_id: testOrganization.id,
                        project_id: testProject.id,
                        type: 'ingestion.timestamp_skew',
                        quantity: 4,
                        metadata: { maxPastMs: 97200000, maxFutureMs: 0 },
                        time: olderEventTime,
                    },
                    {
                        organization_id: testOrganization.id,
                        project_id: testProject.id,
                        type: 'ingestion.timestamp_skew',
                        quantity: 6,
                        metadata: { maxPastMs: 90000000, maxFutureMs: 600000 },
                        time: newestEventTime,
                    },
                ])
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}/ingestion-health`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            const { skew } = response.json();
            expect(skew.count24h).toBe(10);
            expect(skew.maxPastMs).toBe(97200000); // worst across events, not last
            expect(skew.maxFutureMs).toBe(600000);
            // Pins lastSeenAt to the newest fixture row's time (not "now"), with a
            // small tolerance for DB round-tripping.
            expect(Math.abs(new Date(skew.lastSeenAt).getTime() - newestEventTime.getTime())).toBeLessThan(
                5000,
            );
        });

        it('ignores skew events older than 24h', async () => {
            await db
                .insertInto('metering_events')
                .values({
                    organization_id: testOrganization.id,
                    project_id: testProject.id,
                    type: 'ingestion.timestamp_skew',
                    quantity: 99,
                    metadata: { maxPastMs: 97200000, maxFutureMs: 0 },
                    time: new Date(Date.now() - 25 * 60 * 60 * 1000),
                })
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}/ingestion-health`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.json()).toEqual({ skew: null });
        });

        it('does not leak skew from another organization', async () => {
            // otherOrgProjectId belongs to an org the test user is not a member of.
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${otherOrgProjectId}/ingestion-health`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(404);
        });

        it('reads the exact keys a real ingest writes (writer/reader contract)', async () => {
            // #279 repro: a log ~27h in the past, past the 24h skew threshold.
            const skewedTime = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();
            const ingestResult = await ingestionService.ingestLogs(
                [{ time: skewedTime, service: 'ubuntu', level: 'critical', message: 'skewed log' }],
                testProject.id,
            );
            expect(ingestResult.received).toBe(1);
            expect(ingestResult.rejected).toEqual([]);

            // Force the buffered metering event through to the DB rather than
            // waiting for the recorder's interval flush.
            await meteringRecorder.flush();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}/ingestion-health`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            const { skew } = response.json();
            expect(skew.count24h).toBe(1);
            expect(skew.maxPastMs).toBeGreaterThan(24 * 60 * 60 * 1000);

            // Required invariant: a skewed log is stored, never rejected.
            const storedLog = await db
                .selectFrom('logs')
                .selectAll()
                .where('project_id', '=', testProject.id)
                .where('message', '=', 'skewed log')
                .executeTakeFirst();
            expect(storedLog).toBeDefined();
        });

        it('takes the numeric max of maxPastMs, not the lexicographic (text) max', async () => {
            // "9500000" > "10000000" as text (compares '9' vs '1' first), but
            // 10000000 is the larger number. A MAX() over uncasted metadata->>'x'
            // text would wrongly report 9500000 here.
            await db
                .insertInto('metering_events')
                .values([
                    {
                        organization_id: testOrganization.id,
                        project_id: testProject.id,
                        type: 'ingestion.timestamp_skew',
                        quantity: 1,
                        metadata: { maxPastMs: 9500000, maxFutureMs: 0 },
                        time: new Date(Date.now() - 60 * 60 * 1000),
                    },
                    {
                        organization_id: testOrganization.id,
                        project_id: testProject.id,
                        type: 'ingestion.timestamp_skew',
                        quantity: 1,
                        metadata: { maxPastMs: 10000000, maxFutureMs: 0 },
                        time: new Date(Date.now() - 30 * 60 * 1000),
                    },
                ])
                .execute();

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/projects/${testProject.id}/ingestion-health`,
                headers: { Authorization: `Bearer ${authToken}` },
            });

            expect(response.statusCode).toBe(200);
            const { skew } = response.json();
            expect(skew.maxPastMs).toBe(10000000);
        });
    });
});
