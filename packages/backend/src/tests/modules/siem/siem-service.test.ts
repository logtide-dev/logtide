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
        const openIncidents = await siemService.listIncidents({
            organizationId: organization.id,
            status: ['open'],
        });

        expect(openIncidents).toHaveLength(2);

        // Filter by severity
        const criticalIncidents = await siemService.listIncidents({
            organizationId: organization.id,
            severity: ['critical'],
        });

        expect(criticalIncidents).toHaveLength(1);
        expect(criticalIncidents[0].title).toBe('Critical Incident');

        // Filter by both
        const criticalOpen = await siemService.listIncidents({
            organizationId: organization.id,
            status: ['open'],
            severity: ['critical'],
        });

        expect(criticalOpen).toHaveLength(1);
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
        await siemService.linkDetectionEventsToIncident(incident.id, [event1.id, event2.id]);

        // Verify link
        const linkedEvents = await siemService.getIncidentDetections(incident.id);
        expect(linkedEvents).toHaveLength(2);
        expect(linkedEvents[0].incidentId).toBe(incident.id);
        expect(linkedEvents[1].incidentId).toBe(incident.id);

        // Verify detection count updated
        const updatedIncident = await siemService.getIncident(incident.id, organization.id);
        expect(updatedIncident?.detectionCount).toBe(2);
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
