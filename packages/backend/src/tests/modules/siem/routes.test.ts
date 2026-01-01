import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../../database/index.js';
import { siemRoutes } from '../../../modules/siem/routes.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';
import { CacheManager } from '../../../utils/cache.js';
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

// Helper to create a sigma rule
async function createTestSigmaRule(organizationId: string, projectId: string) {
    return db
        .insertInto('sigma_rules')
        .values({
            organization_id: organizationId,
            project_id: projectId,
            title: 'Test Sigma Rule',
            logsource: JSON.stringify({ product: 'linux' }),
            detection: JSON.stringify({ selection: { field: 'value' } }),
            level: 'high',
            status: 'stable',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
}

// Helper to create a detection event
async function createTestDetectionEvent(
    organizationId: string,
    projectId: string,
    sigmaRuleId: string,
    logId: string
) {
    return db
        .insertInto('detection_events')
        .values({
            organization_id: organizationId,
            project_id: projectId,
            sigma_rule_id: sigmaRuleId,
            log_id: logId,
            severity: 'high',
            rule_title: 'Test Rule',
            service: 'test-service',
            log_level: 'error',
            log_message: 'Test log message',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
}

// Helper to create an incident
async function createTestIncident(organizationId: string, projectId: string) {
    return db
        .insertInto('incidents')
        .values({
            organization_id: organizationId,
            project_id: projectId,
            title: 'Test Incident',
            severity: 'high',
            status: 'open',
            detection_count: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
}

describe('SIEM Routes', () => {
    let app: FastifyInstance;
    let authToken: string;
    let testUser: any;
    let testOrganization: any;
    let testProject: any;

    beforeAll(async () => {
        app = Fastify();
        await app.register(siemRoutes);
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        // Clean up system settings first (reset auth mode to standard)
        await db.deleteFrom('system_settings').execute();
        await CacheManager.invalidateSettings();

        // Clean up in correct order (respecting foreign keys)
        await db.deleteFrom('incident_comments').execute();
        await db.deleteFrom('incident_history').execute();
        await db.deleteFrom('incident_alerts').execute();
        await db.deleteFrom('detection_events').execute();
        await db.deleteFrom('incidents').execute();
        await db.deleteFrom('sigma_rules').execute();
        await db.deleteFrom('logs').execute();
        await db.deleteFrom('api_keys').execute();
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

    // ==========================================================================
    // AUTHENTICATION TESTS
    // ==========================================================================

    describe('Authentication', () => {
        it('should return 401 without auth token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/dashboard?organizationId=${testOrganization.id}&timeRange=24h`,
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.payload);
            expect(body.error).toBe('No token provided');
        });

        it('should return 401 with invalid token', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/dashboard?organizationId=${testOrganization.id}&timeRange=24h`,
                headers: {
                    Authorization: 'Bearer invalid-token',
                },
            });

            expect(response.statusCode).toBe(401);
            const body = JSON.parse(response.payload);
            expect(body.error).toBe('Invalid or expired session');
        });

        it('should return 403 when user is not member of organization', async () => {
            // Create another user not in the organization
            const otherUser = await db
                .insertInto('users')
                .values({
                    email: 'other@test.com',
                    name: 'Other User',
                    password_hash: 'hash',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/dashboard?organizationId=${testOrganization.id}&timeRange=24h`,
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
            });

            expect(response.statusCode).toBe(403);
            const body = JSON.parse(response.payload);
            expect(body.error).toBe('You are not a member of this organization');
        });
    });

    // ==========================================================================
    // DASHBOARD TESTS
    // ==========================================================================

    describe('GET /api/v1/siem/dashboard', () => {
        it('should get dashboard statistics', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/dashboard?organizationId=${testOrganization.id}&timeRange=24h`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('topThreats');
            expect(body).toHaveProperty('timeline');
            expect(body).toHaveProperty('affectedServices');
            expect(body).toHaveProperty('severityDistribution');
            expect(body).toHaveProperty('totalDetections');
            expect(body).toHaveProperty('totalIncidents');
        });

        it('should filter dashboard by project', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/dashboard?organizationId=${testOrganization.id}&projectId=${testProject.id}&timeRange=7d`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });

        it('should filter dashboard by severity', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/dashboard?organizationId=${testOrganization.id}&timeRange=24h&severity=critical&severity=high`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    // ==========================================================================
    // DETECTIONS TESTS
    // ==========================================================================

    describe('GET /api/v1/siem/detections', () => {
        it('should get detection events', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/detections?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('detections');
            expect(Array.isArray(body.detections)).toBe(true);
        });

        it('should get detection events with pagination', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/detections?organizationId=${testOrganization.id}&limit=5&offset=0`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });

        it('should filter detections by project', async () => {
            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/detections?organizationId=${testOrganization.id}&projectId=${testProject.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    // ==========================================================================
    // INCIDENTS TESTS
    // ==========================================================================

    describe('POST /api/v1/siem/incidents', () => {
        it('should create an incident', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/incidents',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    projectId: testProject.id,
                    title: 'New Test Incident',
                    description: 'Test description',
                    severity: 'high',
                    status: 'open',
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.title).toBe('New Test Incident');
            expect(body.severity).toBe('high');
            expect(body.status).toBe('open');
        });

        it('should create incident with detection events', async () => {
            // Create a sigma rule and detection event
            const sigmaRule = await createTestSigmaRule(testOrganization.id, testProject.id);
            const log = await createTestLog({
                projectId: testProject.id,
                service: 'test',
                level: 'error',
                message: 'Test log',
            });
            const detection = await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log.id
            );

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/incidents',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    projectId: testProject.id,
                    title: 'Incident with Detections',
                    severity: 'critical',
                    detectionEventIds: [detection.id],
                },
            });

            expect(response.statusCode).toBe(201);
        });

        it('should return 403 for non-member', async () => {
            const otherUser = await db
                .insertInto('users')
                .values({
                    email: 'other2@test.com',
                    name: 'Other User 2',
                    password_hash: 'hash',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const otherSession = await createTestSession(otherUser.id);

            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/incidents',
                headers: {
                    Authorization: `Bearer ${otherSession.token}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    title: 'Unauthorized Incident',
                    severity: 'low',
                },
            });

            expect(response.statusCode).toBe(403);
        });
    });

    describe('GET /api/v1/siem/incidents', () => {
        it('should list incidents', async () => {
            await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/incidents?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('incidents');
            expect(body.incidents.length).toBeGreaterThanOrEqual(1);
        });

        it('should filter incidents by status', async () => {
            await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/incidents?organizationId=${testOrganization.id}&status=open`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            body.incidents.forEach((incident: any) => {
                expect(incident.status).toBe('open');
            });
        });

        it('should filter incidents by severity', async () => {
            await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/incidents?organizationId=${testOrganization.id}&severity=high`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe('GET /api/v1/siem/incidents/:id', () => {
        it('should get incident by ID with related data', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/incidents/${incident.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('incident');
            expect(body).toHaveProperty('detections');
            expect(body).toHaveProperty('comments');
            expect(body).toHaveProperty('history');
            expect(body.incident.id).toBe(incident.id);
        });

        it('should return 404 for non-existent incident', async () => {
            const fakeId = '00000000-0000-0000-0000-000000000000';

            const response = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/incidents/${fakeId}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    describe('PATCH /api/v1/siem/incidents/:id', () => {
        it('should update incident status', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/siem/incidents/${incident.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    status: 'investigating',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.status).toBe('investigating');
        });

        it('should update incident severity', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/siem/incidents/${incident.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    severity: 'critical',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.severity).toBe('critical');
        });

        it('should update incident title and description', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/siem/incidents/${incident.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    title: 'Updated Title',
                    description: 'Updated description',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.title).toBe('Updated Title');
            expect(body.description).toBe('Updated description');
        });

        it('should update incident assignee', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'PATCH',
                url: `/api/v1/siem/incidents/${incident.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    assigneeId: testUser.id,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body.assigneeId).toBe(testUser.id);
        });
    });

    describe('DELETE /api/v1/siem/incidents/:id', () => {
        it('should delete an incident', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'DELETE',
                url: `/api/v1/siem/incidents/${incident.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(204);

            // Verify incident was deleted
            const getResponse = await app.inject({
                method: 'GET',
                url: `/api/v1/siem/incidents/${incident.id}?organizationId=${testOrganization.id}`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(getResponse.statusCode).toBe(404);
        });
    });

    // ==========================================================================
    // COMMENTS TESTS
    // ==========================================================================

    describe('POST /api/v1/siem/incidents/:id/comments', () => {
        it('should add a comment to incident', async () => {
            const incident = await createTestIncident(testOrganization.id, testProject.id);

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/siem/incidents/${incident.id}/comments`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    comment: 'This is a test comment',
                },
            });

            expect(response.statusCode).toBe(201);
            const body = JSON.parse(response.payload);
            expect(body.comment).toBe('This is a test comment');
            expect(body.incidentId).toBe(incident.id);
            expect(body.userId).toBe(testUser.id);
        });

        it('should return 404 for non-existent incident', async () => {
            const fakeId = '00000000-0000-0000-0000-000000000000';

            const response = await app.inject({
                method: 'POST',
                url: `/api/v1/siem/incidents/${fakeId}/comments`,
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    organizationId: testOrganization.id,
                    comment: 'Comment on non-existent incident',
                },
            });

            expect(response.statusCode).toBe(404);
        });
    });

    // ==========================================================================
    // ENRICHMENT TESTS
    // ==========================================================================

    describe('POST /api/v1/siem/enrichment/ip-reputation', () => {
        it('should check IP reputation (may return 503 if not configured)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/enrichment/ip-reputation',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    ip: '8.8.8.8',
                },
            });

            // Either returns data or 503 if service not configured
            expect([200, 503]).toContain(response.statusCode);
        });

        it('should reject invalid IP address', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/enrichment/ip-reputation',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    ip: 'not-an-ip',
                },
            });

            expect(response.statusCode).toBe(500);
        });
    });

    describe('POST /api/v1/siem/enrichment/geoip', () => {
        it('should get GeoIP data (may return 503 if not configured)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/enrichment/geoip',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    ip: '8.8.8.8',
                },
            });

            // Either returns data or 503 if service not configured
            expect([200, 503]).toContain(response.statusCode);
        });

        it('should reject invalid IP address', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/siem/enrichment/geoip',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                payload: {
                    ip: 'invalid-ip',
                },
            });

            expect(response.statusCode).toBe(500);
        });
    });

    describe('GET /api/v1/siem/enrichment/status', () => {
        it('should get enrichment services status', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/api/v1/siem/enrichment/status',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.payload);
            expect(body).toHaveProperty('ipReputation');
            expect(body).toHaveProperty('geoIp');
        });
    });
});
