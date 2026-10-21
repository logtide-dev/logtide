import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { SiemService } from '../../../modules/siem/service.js';
import { createTestContext, createTestLog } from '../../helpers/factories.js';

const siemService = new SiemService(db);

describe('SIEM Service - Detection Events', () => {
    beforeEach(async () => {
        await db.deleteFrom('detection_events').execute();
        await db.deleteFrom('sigma_rules').execute();
    });

    it('should create a detection event', async () => {
        const { organization, project, user } = await createTestContext();

        // Create Sigma rule first
        const sigmaRule = await db
            .insertInto('sigma_rules')
            .values({
                organization_id: organization.id,
                project_id: project.id,
                title: 'Test Sigma Rule',
                logsource: JSON.stringify({ product: 'linux' }),
                detection: JSON.stringify({ selection: { field: 'value' } }),
                level: 'high',
                status: 'stable',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Create a test log to reference
        const log = await createTestLog({
            projectId: project.id,
            service: 'test-service',
            level: 'error',
            message: 'Test log message',
        });

        const event = await siemService.createDetectionEvent({
            organizationId: organization.id,
            projectId: project.id,
            sigmaRuleId: sigmaRule.id,
            logId: log.id,
            severity: 'high',
            ruleTitle: 'Test Sigma Rule',
            ruleDescription: 'Test description',
            mitreTactics: ['execution'],
            mitreTechniques: ['T1059'],
            service: 'test-service',
            logLevel: 'error',
            logMessage: 'Test log message',
            traceId: 'test-trace-id',
            matchedFields: { field1: 'value1' },
        });

        expect(event.id).toBeDefined();
        expect(event.severity).toBe('high');
        expect(event.service).toBe('test-service');
        expect(event.mitreTactics).toEqual(['execution']);
    });

    it('should get detection events with filters', async () => {
        const { organization, project } = await createTestContext();

        const sigmaRule = await db
            .insertInto('sigma_rules')
            .values({
                organization_id: organization.id,
                project_id: project.id,
                title: 'Test Rule',
                logsource: JSON.stringify({}),
                detection: JSON.stringify({}),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Create test logs
        const log1 = await createTestLog({
            projectId: project.id,
            service: 'service-1',
            level: 'error',
            message: 'Critical event',
        });

        const log2 = await createTestLog({
            projectId: project.id,
            service: 'service-2',
            level: 'warn',
            message: 'Medium event',
        });

        // Create multiple detection events
        await Promise.all([
            siemService.createDetectionEvent({
                organizationId: organization.id,
                projectId: project.id,
                sigmaRuleId: sigmaRule.id,
                logId: log1.id,
                severity: 'critical',
                ruleTitle: 'Test Rule',
                service: 'service-1',
                logLevel: 'error',
                logMessage: 'Critical event',
            }),
            siemService.createDetectionEvent({
                organizationId: organization.id,
                projectId: project.id,
                sigmaRuleId: sigmaRule.id,
                logId: log2.id,
                severity: 'medium',
                ruleTitle: 'Test Rule',
                service: 'service-2',
                logLevel: 'warn',
                logMessage: 'Medium event',
            }),
        ]);

        // Filter by severity
        const criticalEvents = await siemService.getDetectionEvents({
            organizationId: organization.id,
            severity: ['critical'],
        });

        expect(criticalEvents).toHaveLength(1);
        expect(criticalEvents[0].severity).toBe('critical');

        // Get all events
        const allEvents = await siemService.getDetectionEvents({
            organizationId: organization.id,
        });

        expect(allEvents).toHaveLength(2);
    });

    it('should handle array of categories and endTime filter', async () => {
        const { organization, project } = await createTestContext();

        // Create Sigma rule
        const sigmaRule = await db
            .insertInto('sigma_rules')
            .values({
                organization_id: organization.id,
                project_id: project.id,
                title: 'Test Rule',
                logsource: JSON.stringify({}),
                detection: JSON.stringify({}),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Create test log
        const log = await createTestLog({
            projectId: project.id,
        });

        const now = new Date();

        await siemService.createDetectionEvent({
            organizationId: organization.id,
            projectId: project.id,
            sigmaRuleId: sigmaRule.id,
            logId: log.id,
            severity: 'medium',
            ruleTitle: 'Security Event',
            service: 'test',
            logLevel: 'error',
            logMessage: 'Security breach',
            category: 'security',
        });

        await siemService.createDetectionEvent({
            organizationId: organization.id,
            projectId: project.id,
            sigmaRuleId: sigmaRule.id,
            logId: log.id,
            severity: 'medium',
            ruleTitle: 'App Event',
            service: 'test',
            logLevel: 'error',
            logMessage: 'App error',
            category: 'application',
        });

        const result = await siemService.getDetectionEvents({
            organizationId: organization.id,
            category: ['security', 'application'],
            endTime: new Date(now.getTime() + 1000),
        });

        expect(result).toHaveLength(2);
    });
});

describe('SIEM Service - Incidents', () => {
    beforeEach(async () => {
        await db.deleteFrom('incident_comments').execute();
        await db.deleteFrom('incident_history').execute();
        await db.deleteFrom('incident_alerts').execute();
        await db.deleteFrom('incidents').execute();
    });

    it('should create an incident', async () => {
        const { organization, project } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Test Incident',
            description: 'Test description',
            severity: 'high',
            status: 'open',
        });

        expect(incident.id).toBeDefined();
        expect(incident.title).toBe('Test Incident');
        expect(incident.severity).toBe('high');
        expect(incident.status).toBe('open');
        expect(incident.detectionCount).toBe(0);
    });

    it('should get incident by ID', async () => {
        const { organization, project } = await createTestContext();

        const created = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Get Test',
            severity: 'medium',
        });

        const retrieved = await siemService.getIncident(created.id, organization.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(created.id);
        expect(retrieved?.title).toBe('Get Test');
    });

    it('should list incidents with filters', async () => {
        const { organization, project } = await createTestContext();

        // Create multiple incidents
        await Promise.all([
            siemService.createIncident({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Critical Incident',
                severity: 'critical',
                status: 'open',
            }),
            siemService.createIncident({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Medium Incident',
                severity: 'medium',
                status: 'resolved',
            }),
            siemService.createIncident({
                organizationId: organization.id,
                projectId: project.id,
                title: 'Low Incident',
                severity: 'low',
                status: 'open',
            }),
        ]);

        // Filter by status
        const openResult = await siemService.listIncidents({
            organizationId: organization.id,
            status: ['open'],
        });

        expect(openResult.incidents).toHaveLength(2);
        expect(openResult.total).toBe(2);

        // Filter by single status string
        const singleStatusResult = await siemService.listIncidents({
            organizationId: organization.id,
            status: 'resolved',
        });
        expect(singleStatusResult.incidents).toHaveLength(1);

        // Filter by assignee
        const assigneeResult = await siemService.listIncidents({
            organizationId: organization.id,
            assigneeId: crypto.randomUUID(), // non-existent
        });
        expect(assigneeResult.incidents).toHaveLength(0);

        // Filter by severity
        const criticalResult = await siemService.listIncidents({
            organizationId: organization.id,
            severity: ['critical'],
        });

        expect(criticalResult.incidents).toHaveLength(1);
        expect(criticalResult.incidents[0].title).toBe('Critical Incident');
        expect(criticalResult.total).toBe(1);

        // Filter by both
        const criticalOpenResult = await siemService.listIncidents({
            organizationId: organization.id,
            status: ['open'],
            severity: ['critical'],
        });

        expect(criticalOpenResult.incidents).toHaveLength(1);
        expect(criticalOpenResult.total).toBe(1);
    });

    it('should update an incident', async () => {
        const { organization, project, user } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Original Title',
            severity: 'medium',
            status: 'open',
        });

        const updated = await siemService.updateIncident(incident.id, organization.id, {
            title: 'Updated Title',
            status: 'investigating',
            severity: 'high',
        });

        expect(updated.title).toBe('Updated Title');
        expect(updated.status).toBe('investigating');
        expect(updated.severity).toBe('high');
    });

    it('should delete an incident', async () => {
        const { organization, project } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'To Delete',
            severity: 'low',
        });

        await siemService.deleteIncident(incident.id, organization.id);

        const retrieved = await siemService.getIncident(incident.id, organization.id);
        expect(retrieved).toBeNull();
    });

    it('should link detection events to incident', async () => {
        const { organization, project } = await createTestContext();

        // Create incident
        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Linked Incident',
            severity: 'high',
        });

        // Create Sigma rule
        const sigmaRule = await db
            .insertInto('sigma_rules')
            .values({
                organization_id: organization.id,
                project_id: project.id,
                title: 'Link Test Rule',
                logsource: JSON.stringify({}),
                detection: JSON.stringify({}),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Create test logs
        const log1 = await createTestLog({
            projectId: project.id,
            service: 'test',
            level: 'error',
            message: 'Event 1',
        });

        const log2 = await createTestLog({
            projectId: project.id,
            service: 'test',
            level: 'error',
            message: 'Event 2',
        });

        // Create detection events
        const event1 = await siemService.createDetectionEvent({
            organizationId: organization.id,
            projectId: project.id,
            sigmaRuleId: sigmaRule.id,
            logId: log1.id,
            severity: 'high',
            ruleTitle: 'Link Test Rule',
            service: 'test',
            logLevel: 'error',
            logMessage: 'Event 1',
        });

        const event2 = await siemService.createDetectionEvent({
            organizationId: organization.id,
            projectId: project.id,
            sigmaRuleId: sigmaRule.id,
            logId: log2.id,
            severity: 'high',
            ruleTitle: 'Link Test Rule',
            service: 'test',
            logLevel: 'error',
            logMessage: 'Event 2',
        });

        // Link events to incident
        await siemService.linkDetectionEventsToIncident(incident.id, [event1.id, event2.id], organization.id);

        // Verify link
        const linkedEvents = await siemService.getIncidentDetections(incident.id, organization.id);
        expect(linkedEvents).toHaveLength(2);
        expect(linkedEvents[0].incidentId).toBe(incident.id);
        expect(linkedEvents[1].incidentId).toBe(incident.id);

        // Verify detection count updated
        const updatedIncident = await siemService.getIncident(incident.id, organization.id);
        expect(updatedIncident?.detectionCount).toBe(2);
    });

    it('should enrich incident with IP data', async () => {
        const { organization, project } = await createTestContext();

        // Create incident
        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Enrichment Test',
            severity: 'medium',
        });

        // Create Sigma rule
        const sigmaRule = await db
            .insertInto('sigma_rules')
            .values({
                organization_id: organization.id,
                project_id: project.id,
                title: 'IP Test Rule',
                logsource: JSON.stringify({}),
                detection: JSON.stringify({}),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        const log = await createTestLog({
            projectId: project.id,
        });

        const event = await siemService.createDetectionEvent({
            organizationId: organization.id,
            projectId: project.id,
            sigmaRuleId: sigmaRule.id,
            logId: log.id,
            severity: 'medium',
            ruleTitle: 'IP Test Rule',
            service: 'test',
            logLevel: 'error',
            logMessage: 'Failed login from 8.8.8.8',
            matchedFields: { source_ip: '1.1.1.1' },
        });

        await siemService.linkDetectionEventsToIncident(incident.id, [event.id], organization.id);

        // Mock enrichment service
        const mockEnrichmentService = {
            extractIpAddresses: (text: string) => {
                if (text.includes('8.8.8.8')) return ['8.8.8.8'];
                if (text.includes('1.1.1.1')) return ['1.1.1.1'];
                return [];
            },
            checkIpReputationBatch: (ips: string[]) => ({
                '8.8.8.8': { score: 0, reports: 0, isWhitelisted: true, lastCheck: new Date() },
            }),
            getGeoIpDataBatch: (ips: string[]) => ({
                '8.8.8.8': { country: 'US', city: 'Mountain View', lat: 0, lon: 0 },
            }),
        } as any;

        await siemService.enrichIncidentIpData(incident.id, mockEnrichmentService, organization.id);

        const updated = await siemService.getIncident(incident.id, organization.id);
        expect(updated?.ipReputation).toBeDefined();
        expect(updated?.ipReputation).toHaveProperty('8.8.8.8');
        expect(updated?.geoData).toBeDefined();
        expect(updated?.geoData).toHaveProperty('8.8.8.8');
    });

    it('should handle enrichment when no IPs are found', async () => {
        const { organization, project } = await createTestContext();
        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'No IP Test',
            severity: 'low',
        });

        const mockEnrichmentService = {
            extractIpAddresses: () => [],
        } as any;

        await siemService.enrichIncidentIpData(incident.id, mockEnrichmentService, organization.id);
        const updated = await siemService.getIncident(incident.id, organization.id);
        expect(updated?.ipReputation).toBeNull();
    });

    it('createIncident sets lastEventAt to timeWindowEnd when given', async () => {
        const { organization, project } = await createTestContext();
        const timeWindowEnd = new Date('2026-10-20T08:30:00.000Z');
        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Windowed',
            severity: 'high',
            timeWindowStart: new Date('2026-10-20T08:00:00.000Z'),
            timeWindowEnd,
        });

        expect(new Date(incident.lastEventAt).getTime()).toBe(timeWindowEnd.getTime());
        const reloaded = await siemService.getIncident(incident.id, organization.id);
        expect(new Date(reloaded!.lastEventAt).getTime()).toBe(timeWindowEnd.getTime());
    });

    it('createIncident defaults lastEventAt to the creation time', async () => {
        const { organization, project } = await createTestContext();
        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'No window',
            severity: 'low',
        });

        expect(incident.lastEventAt).toBeDefined();
        const diff = Math.abs(
            new Date(incident.lastEventAt).getTime() - new Date(incident.createdAt).getTime()
        );
        expect(diff).toBeLessThan(5000);
    });

    it('createIncident still returns source sigma and null alertRuleId', async () => {
        const { organization, project } = await createTestContext();
        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Sigma',
            severity: 'medium',
        });

        expect(incident).toMatchObject({
            source: 'sigma',
            alertRuleId: null,
            monitorId: null,
            acknowledgedAt: null,
            acknowledgedBy: null,
            resolvedBy: null,
        });
    });
});

describe('SIEM Service - Comments', () => {
    beforeEach(async () => {
        await db.deleteFrom('incident_comments').execute();
        await db.deleteFrom('incidents').execute();
    });

    it('should add a comment to incident', async () => {
        const { organization, project, user } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Commented Incident',
            severity: 'medium',
        });

        const comment = await siemService.addComment({
            incidentId: incident.id,
            userId: user.id,
            comment: 'This is a test comment',
        });

        expect(comment.id).toBeDefined();
        expect(comment.incidentId).toBe(incident.id);
        expect(comment.userId).toBe(user.id);
        expect(comment.comment).toBe('This is a test comment');
        expect(comment.edited).toBe(false);
    });

    it('should get all comments for an incident', async () => {
        const { organization, project, user } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Multi Comment Incident',
            severity: 'low',
        });

        await siemService.addComment({
            incidentId: incident.id,
            userId: user.id,
            comment: 'First comment',
        });

        await siemService.addComment({
            incidentId: incident.id,
            userId: user.id,
            comment: 'Second comment',
        });

        const comments = await siemService.getIncidentComments(incident.id);

        expect(comments).toHaveLength(2);
        expect(comments[0].comment).toBe('First comment');
        expect(comments[1].comment).toBe('Second comment');
        expect(comments[0].userName).toBeDefined();
        expect(comments[0].userEmail).toBeDefined();
    });
});

describe('SIEM Service - History', () => {
    beforeEach(async () => {
        await db.deleteFrom('incident_history').execute();
        await db.deleteFrom('incidents').execute();
    });

    it('should track incident status changes', async () => {
        const { organization, project, user } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'History Test',
            severity: 'medium',
            status: 'open',
        });

        // Update status (should trigger history entry)
        await siemService.updateIncident(incident.id, organization.id, {
            status: 'investigating',
        });

        // Small delay for trigger to execute
        await new Promise(resolve => setTimeout(resolve, 100));

        const history = await siemService.getIncidentHistory(incident.id);

        expect(history.length).toBeGreaterThan(0);
        const statusChange = history.find(h => h.action === 'status_change');
        expect(statusChange).toBeDefined();
        expect(statusChange?.oldValue).toBe('open');
        expect(statusChange?.newValue).toBe('investigating');
    });

    it('should track incident severity changes', async () => {
        const { organization, project } = await createTestContext();

        const incident = await siemService.createIncident({
            organizationId: organization.id,
            projectId: project.id,
            title: 'Severity Change Test',
            severity: 'low',
        });

        await siemService.updateIncident(incident.id, organization.id, {
            severity: 'critical',
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        const history = await siemService.getIncidentHistory(incident.id);
        const severityChange = history.find(h => h.action === 'severity_change');

        expect(severityChange).toBeDefined();
        expect(severityChange?.oldValue).toBe('low');
        expect(severityChange?.newValue).toBe('critical');
    });
});
