import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Use vi.hoisted to create mocks that work with hoisted vi.mock calls
const { mockEnrichmentService } = vi.hoisted(() => ({
    mockEnrichmentService: {
        checkIpReputation: vi.fn(() => null),
        getGeoIpData: vi.fn(() => null),
        getStatus: vi.fn(() => ({ ipReputation: false, geoIp: false })),
        checkIpReputationBatch: vi.fn(() => ({})),
        getGeoIpDataBatch: vi.fn(() => ({})),
        enrichIp: vi.fn(() => ({ reputation: null, geo: null })),
        extractIpAddresses: vi.fn(() => []),
        isConfigured: vi.fn(() => ({ ipReputation: false, geoIp: false })),
    },
}));

// Mock enrichment service BEFORE imports
vi.mock('../../../modules/siem/enrichment-service.js', () => ({
    enrichmentService: mockEnrichmentService,
}));

import { db } from '../../../database/index.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';
import { processIncidentAutoGrouping } from '../../../queue/jobs/incident-autogrouping.js';

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
    logId: string,
    options?: {
        traceId?: string;
        service?: string;
        severity?: string;
        time?: Date;
        mitreTactics?: string[];
        mitreTechniques?: string[];
    }
) {
    return db
        .insertInto('detection_events')
        .values({
            organization_id: organizationId,
            project_id: projectId,
            sigma_rule_id: sigmaRuleId,
            log_id: logId,
            severity: (options?.severity as any) || 'high',
            rule_title: 'Test Rule',
            service: options?.service || 'test-service',
            log_level: 'error',
            log_message: 'Test log message',
            trace_id: options?.traceId || null,
            time: options?.time || new Date(),
            mitre_tactics: options?.mitreTactics || null,
            mitre_techniques: options?.mitreTechniques || null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
}

describe('Incident Auto-Grouping Job', () => {
    let testOrganization: any;
    let testProject: any;
    let sigmaRule: any;

    beforeEach(async () => {
        vi.clearAllMocks();

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
        testOrganization = context.organization;
        testProject = context.project;

        // Create sigma rule
        sigmaRule = await createTestSigmaRule(testOrganization.id, testProject.id);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('processIncidentAutoGrouping', () => {
        it('should complete successfully with no ungrouped events', async () => {
            await expect(processIncidentAutoGrouping({})).resolves.not.toThrow();
        });

        it('should group detection events by trace_id', async () => {
            const traceId = 'test-trace-123';

            // Create logs for detection events
            const log1 = await createTestLog({
                projectId: testProject.id,
                service: 'api-gateway',
                level: 'error',
                message: 'Event 1',
            });

            const log2 = await createTestLog({
                projectId: testProject.id,
                service: 'user-service',
                level: 'error',
                message: 'Event 2',
            });

            // Create 2 detection events with same trace_id
            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log1.id,
                {
                    traceId,
                    service: 'api-gateway',
                    severity: 'high',
                    mitreTactics: ['initial_access'],
                    mitreTechniques: ['T1190'],
                }
            );

            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log2.id,
                {
                    traceId,
                    service: 'user-service',
                    severity: 'critical',
                    mitreTactics: ['execution'],
                    mitreTechniques: ['T1059'],
                }
            );

            // Run auto-grouping
            await processIncidentAutoGrouping({});

            // Verify incident was created
            const incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            expect(incidents).toHaveLength(1);
            expect(incidents[0].title).toContain('Trace');
            expect(incidents[0].detection_count).toBe(2);

            // Verify detection events were linked
            const linkedEvents = await db
                .selectFrom('detection_events')
                .select(['id', 'incident_id'])
                .where('incident_id', '=', incidents[0].id)
                .execute();

            expect(linkedEvents).toHaveLength(2);
        });

        it('should not group single detection event by trace_id', async () => {
            const traceId = 'single-trace';

            const log = await createTestLog({
                projectId: testProject.id,
                service: 'test',
                level: 'error',
                message: 'Single event',
            });

            // Create only 1 detection event
            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log.id,
                { traceId }
            );

            await processIncidentAutoGrouping({});

            // Should not create an incident for single event
            const incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            expect(incidents).toHaveLength(0);
        });

        it('should group detection events by time window', async () => {
            // Use a fixed base time in the middle of a 5-minute window to avoid edge cases
            // The job groups by 5-minute windows, so we need all events in the same window
            const now = new Date();
            // Align to the middle of current 5-minute window (add 2.5 minutes from window start)
            const windowStart = new Date(now);
            windowStart.setMinutes(Math.floor(now.getMinutes() / 5) * 5, 0, 0);
            const baseTime = new Date(windowStart.getTime() + 2.5 * 60 * 1000); // Middle of window

            // Create 3 logs within same time window
            const logs = await Promise.all([
                createTestLog({
                    projectId: testProject.id,
                    service: 'burst-service',
                    level: 'error',
                    message: 'Burst event 1',
                }),
                createTestLog({
                    projectId: testProject.id,
                    service: 'burst-service',
                    level: 'error',
                    message: 'Burst event 2',
                }),
                createTestLog({
                    projectId: testProject.id,
                    service: 'burst-service',
                    level: 'error',
                    message: 'Burst event 3',
                }),
            ]);

            // Create 3 detection events without trace_id, within 5-minute window
            // All times are within 1 minute of each other, centered in the window
            for (let i = 0; i < 3; i++) {
                const time = new Date(baseTime.getTime() - i * 30 * 1000); // 30 seconds apart
                await createTestDetectionEvent(
                    testOrganization.id,
                    testProject.id,
                    sigmaRule.id,
                    logs[i].id,
                    {
                        service: 'burst-service',
                        severity: 'high',
                        time,
                    }
                );
            }

            await processIncidentAutoGrouping({});

            // Verify incident was created
            const incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            expect(incidents).toHaveLength(1);
            expect(incidents[0].title).toContain('Burst Detection');
            expect(incidents[0].detection_count).toBe(3);
        });

        it('should not group events that are too far apart in time', async () => {
            const now = new Date();

            const logs = await Promise.all([
                createTestLog({
                    projectId: testProject.id,
                    service: 'sparse-service',
                    level: 'error',
                    message: 'Sparse event 1',
                }),
                createTestLog({
                    projectId: testProject.id,
                    service: 'sparse-service',
                    level: 'error',
                    message: 'Sparse event 2',
                }),
            ]);

            // Create 2 detection events more than 5 minutes apart
            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                logs[0].id,
                {
                    service: 'sparse-service',
                    severity: 'high',
                    time: now,
                }
            );

            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                logs[1].id,
                {
                    service: 'sparse-service',
                    severity: 'high',
                    time: new Date(now.getTime() - 10 * 60 * 1000), // 10 minutes ago
                }
            );

            await processIncidentAutoGrouping({});

            // Should not create incident (only 2 events, need 3)
            const incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            expect(incidents).toHaveLength(0);
        });

        it('should handle multiple organizations', async () => {
            // Create second organization
            const org2User = await db
                .insertInto('users')
                .values({
                    email: 'org2@test.com',
                    name: 'Org 2 User',
                    password_hash: 'hash',
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const org2 = await db
                .insertInto('organizations')
                .values({
                    name: 'Organization 2',
                    slug: 'organization-2',
                    owner_id: org2User.id,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const project2 = await db
                .insertInto('projects')
                .values({
                    name: 'Project 2',
                    organization_id: org2.id,
                    user_id: org2User.id,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const sigmaRule2 = await createTestSigmaRule(org2.id, project2.id);

            // Create events for org 1
            const log1 = await createTestLog({
                projectId: testProject.id,
                service: 'org1-service',
                level: 'error',
                message: 'Org 1 event',
            });

            const log2 = await createTestLog({
                projectId: testProject.id,
                service: 'org1-service',
                level: 'error',
                message: 'Org 1 event 2',
            });

            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log1.id,
                { traceId: 'org1-trace' }
            );

            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log2.id,
                { traceId: 'org1-trace' }
            );

            // Create events for org 2
            const log3 = await createTestLog({
                projectId: project2.id,
                service: 'org2-service',
                level: 'error',
                message: 'Org 2 event',
            });

            const log4 = await createTestLog({
                projectId: project2.id,
                service: 'org2-service',
                level: 'error',
                message: 'Org 2 event 2',
            });

            await createTestDetectionEvent(org2.id, project2.id, sigmaRule2.id, log3.id, {
                traceId: 'org2-trace',
            });

            await createTestDetectionEvent(org2.id, project2.id, sigmaRule2.id, log4.id, {
                traceId: 'org2-trace',
            });

            await processIncidentAutoGrouping({});

            // Verify incidents were created for both organizations
            const org1Incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            const org2Incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', org2.id)
                .execute();

            expect(org1Incidents).toHaveLength(1);
            expect(org2Incidents).toHaveLength(1);
        });

        it('should preserve MITRE ATT&CK data when grouping', async () => {
            const traceId = 'mitre-trace';

            const log1 = await createTestLog({
                projectId: testProject.id,
                service: 'test',
                level: 'error',
                message: 'MITRE event 1',
            });

            const log2 = await createTestLog({
                projectId: testProject.id,
                service: 'test',
                level: 'error',
                message: 'MITRE event 2',
            });

            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log1.id,
                {
                    traceId,
                    mitreTactics: ['initial_access', 'execution'],
                    mitreTechniques: ['T1190'],
                }
            );

            await createTestDetectionEvent(
                testOrganization.id,
                testProject.id,
                sigmaRule.id,
                log2.id,
                {
                    traceId,
                    mitreTactics: ['persistence'],
                    mitreTechniques: ['T1059', 'T1078'],
                }
            );

            await processIncidentAutoGrouping({});

            const incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            expect(incidents).toHaveLength(1);
            // Verify MITRE data is aggregated
            expect(incidents[0].mitre_tactics).toBeDefined();
            expect(incidents[0].mitre_techniques).toBeDefined();
        });

        it('should skip already grouped events', async () => {
            const traceId = 'already-grouped-trace';

            const log1 = await createTestLog({
                projectId: testProject.id,
                service: 'test',
                level: 'error',
                message: 'Grouped event',
            });

            const log2 = await createTestLog({
                projectId: testProject.id,
                service: 'test',
                level: 'error',
                message: 'Grouped event 2',
            });

            // Create incident first
            const incident = await db
                .insertInto('incidents')
                .values({
                    organization_id: testOrganization.id,
                    project_id: testProject.id,
                    title: 'Existing Incident',
                    severity: 'high',
                    status: 'open',
                    detection_count: 0,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            // Create detection events already linked to incident
            await db
                .insertInto('detection_events')
                .values({
                    organization_id: testOrganization.id,
                    project_id: testProject.id,
                    sigma_rule_id: sigmaRule.id,
                    log_id: log1.id,
                    severity: 'high',
                    rule_title: 'Test',
                    service: 'test',
                    log_level: 'error',
                    log_message: 'Test',
                    trace_id: traceId,
                    incident_id: incident.id, // Already linked
                })
                .execute();

            await db
                .insertInto('detection_events')
                .values({
                    organization_id: testOrganization.id,
                    project_id: testProject.id,
                    sigma_rule_id: sigmaRule.id,
                    log_id: log2.id,
                    severity: 'high',
                    rule_title: 'Test',
                    service: 'test',
                    log_level: 'error',
                    log_message: 'Test',
                    trace_id: traceId,
                    incident_id: incident.id, // Already linked
                })
                .execute();

            await processIncidentAutoGrouping({});

            // Should not create new incident
            const incidents = await db
                .selectFrom('incidents')
                .selectAll()
                .where('organization_id', '=', testOrganization.id)
                .execute();

            expect(incidents).toHaveLength(1);
            expect(incidents[0].id).toBe(incident.id);
        });
    });
});
