import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { CorrelationService } from '../../../modules/correlation/service.js';
import { createTestContext, createTestLog, createTestProject } from '../../helpers/factories.js';

describe('CorrelationService', () => {
    let service: CorrelationService;

    beforeEach(async () => {
        service = new CorrelationService();
        await db.deleteFrom('log_identifiers').execute();
        await db.deleteFrom('logs').execute();
    });

    describe('extractIdentifiers', () => {
        it('should extract UUID from message', () => {
            const log = {
                message: 'Request 123e4567-e89b-12d3-a456-426614174000 processed',
                service: 'api',
                level: 'info' as const,
            };

            const matches = service.extractIdentifiers(log);

            expect(matches).toContainEqual(
                expect.objectContaining({
                    type: 'uuid',
                    value: '123e4567-e89b-12d3-a456-426614174000',
                    sourceField: 'message',
                })
            );
        });

        it('should extract identifiers from metadata', () => {
            const log = {
                message: 'Request processed',
                service: 'api',
                level: 'info' as const,
                metadata: {
                    user_id: 'usr_12345',
                    request_id: 'req_abc123',
                },
            };

            const matches = service.extractIdentifiers(log);

            expect(matches).toContainEqual(
                expect.objectContaining({
                    type: 'user_id',
                    value: 'usr_12345',
                })
            );
        });

        it('should extract from nested metadata', () => {
            const log = {
                message: 'Request processed',
                service: 'api',
                level: 'info' as const,
                metadata: {
                    context: {
                        user_id: 'usr_nested_123',
                    },
                },
            };

            const matches = service.extractIdentifiers(log);

            const userMatch = matches.find((m) => m.value === 'usr_nested_123');
            expect(userMatch).toBeDefined();
            expect(userMatch?.sourceField).toContain('context');
        });

        it('should deduplicate matches', () => {
            const log = {
                message: 'Request 123e4567-e89b-12d3-a456-426614174000 for user 123e4567-e89b-12d3-a456-426614174000',
                service: 'api',
                level: 'info' as const,
            };

            const matches = service.extractIdentifiers(log);

            const uuidMatches = matches.filter(
                (m) => m.value === '123e4567-e89b-12d3-a456-426614174000'
            );
            expect(uuidMatches.length).toBe(1);
        });

        it('should return empty array for logs with no identifiers', () => {
            const log = {
                message: 'Simple log message',
                service: 'api',
                level: 'info' as const,
            };

            const matches = service.extractIdentifiers(log);

            expect(matches.length).toBe(0);
        });

        it('should handle null metadata', () => {
            const log = {
                message: 'Simple log message',
                service: 'api',
                level: 'info' as const,
                metadata: undefined,
            };

            const matches = service.extractIdentifiers(log);

            expect(matches).toEqual([]);
        });
    });

    describe('extractIdentifiersAsync', () => {
        it('should extract identifiers using org patterns', async () => {
            const { organization } = await createTestContext();

            // Create custom pattern for this org
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: organization.id,
                    name: 'custom_order',
                    display_name: 'Custom Order',
                    pattern: '\\bCUST-([A-Z0-9]+)\\b',
                    field_names: [],
                    enabled: true,
                    priority: 10,
                })
                .execute();

            const log = {
                message: 'Processing order CUST-ABC123',
                service: 'api',
                level: 'info' as const,
            };

            const matches = await service.extractIdentifiersAsync(log, organization.id);

            const customMatch = matches.find((m) => m.type === 'custom_order');
            expect(customMatch).toBeDefined();
        });
    });

    describe('storeIdentifiers', () => {
        it('should store identifiers for logs', async () => {
            const { organization, project } = await createTestContext();

            const log = await createTestLog({
                projectId: project.id,
                message: 'Test log',
            });

            const logs = [
                {
                    id: log.id,
                    time: log.time,
                    projectId: project.id,
                    organizationId: organization.id,
                },
            ];

            const identifiersByLog = new Map([
                [
                    0,
                    [
                        { type: 'uuid', value: '123e4567-e89b-12d3-a456-426614174000', sourceField: 'message' },
                        { type: 'user_id', value: 'usr_123', sourceField: 'metadata.user_id' },
                    ],
                ],
            ]);

            await service.storeIdentifiers(logs, identifiersByLog);

            // Verify stored
            const stored = await db
                .selectFrom('log_identifiers')
                .selectAll()
                .where('log_id', '=', log.id)
                .execute();

            expect(stored.length).toBe(2);
        });

        it('should handle empty identifiers', async () => {
            const { organization, project } = await createTestContext();

            const log = await createTestLog({ projectId: project.id });

            const logs = [
                {
                    id: log.id,
                    time: log.time,
                    projectId: project.id,
                    organizationId: organization.id,
                },
            ];

            const identifiersByLog = new Map<number, any[]>();

            await service.storeIdentifiers(logs, identifiersByLog);

            const stored = await db
                .selectFrom('log_identifiers')
                .selectAll()
                .where('log_id', '=', log.id)
                .execute();

            expect(stored.length).toBe(0);
        });

        it('should handle multiple logs', async () => {
            const { organization, project } = await createTestContext();

            const log1 = await createTestLog({ projectId: project.id });
            const log2 = await createTestLog({ projectId: project.id });

            const logs = [
                { id: log1.id, time: log1.time, projectId: project.id, organizationId: organization.id },
                { id: log2.id, time: log2.time, projectId: project.id, organizationId: organization.id },
            ];

            const identifiersByLog = new Map([
                [0, [{ type: 'uuid', value: 'uuid-1', sourceField: 'message' }]],
                [1, [{ type: 'uuid', value: 'uuid-2', sourceField: 'message' }]],
            ]);

            await service.storeIdentifiers(logs, identifiersByLog);

            const stored = await db.selectFrom('log_identifiers').selectAll().execute();

            expect(stored.length).toBe(2);
        });
    });

    describe('findCorrelatedLogs', () => {
        it('should find logs with matching identifier', async () => {
            const { organization, project } = await createTestContext();

            // Create logs
            const log1 = await createTestLog({
                projectId: project.id,
                message: 'First log',
                time: new Date(),
            });
            const log2 = await createTestLog({
                projectId: project.id,
                message: 'Second log',
                time: new Date(),
            });

            // Store identifiers
            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log1.id,
                        log_time: log1.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'shared-request-123',
                        source_field: 'message',
                    },
                    {
                        log_id: log2.id,
                        log_time: log2.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'shared-request-123',
                        source_field: 'message',
                    },
                ])
                .execute();

            const result = await service.findCorrelatedLogs({
                projectId: project.id,
                identifierValue: 'shared-request-123',
            });

            expect(result.logs.length).toBe(2);
            expect(result.identifier.value).toBe('shared-request-123');
            expect(result.identifier.type).toBe('request_id');
        });

        it('should filter by time window', async () => {
            const { organization, project } = await createTestContext();

            const now = new Date();
            const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

            const log1 = await createTestLog({
                projectId: project.id,
                message: 'Recent log',
                time: hourAgo,
            });
            const log2 = await createTestLog({
                projectId: project.id,
                message: 'Old log',
                time: twoHoursAgo,
            });

            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log1.id,
                        log_time: log1.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'test-request',
                        source_field: 'message',
                    },
                    {
                        log_id: log2.id,
                        log_time: log2.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'test-request',
                        source_field: 'message',
                    },
                ])
                .execute();

            const result = await service.findCorrelatedLogs({
                projectId: project.id,
                identifierValue: 'test-request',
                referenceTime: now,
                timeWindowMinutes: 90, // Only includes log1
            });

            expect(result.logs.length).toBe(1);
        });

        it('should return empty result when no matches', async () => {
            const { project } = await createTestContext();

            const result = await service.findCorrelatedLogs({
                projectId: project.id,
                identifierValue: 'nonexistent',
            });

            expect(result.logs.length).toBe(0);
            expect(result.total).toBe(0);
            expect(result.identifier.type).toBe('unknown');
        });

        it('should respect limit parameter', async () => {
            const { organization, project } = await createTestContext();

            // Create many logs
            const logs = [];
            for (let i = 0; i < 10; i++) {
                const log = await createTestLog({
                    projectId: project.id,
                    message: `Log ${i}`,
                });
                logs.push(log);
            }

            // Store identifiers for all logs
            await db
                .insertInto('log_identifiers')
                .values(
                    logs.map((log) => ({
                        log_id: log.id,
                        log_time: log.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'request_id',
                        identifier_value: 'shared-id',
                        source_field: 'message',
                    }))
                )
                .execute();

            const result = await service.findCorrelatedLogs({
                projectId: project.id,
                identifierValue: 'shared-id',
                limit: 5,
            });

            expect(result.logs.length).toBe(5);
        });

        it('should include time window in result', async () => {
            const { project } = await createTestContext();

            const referenceTime = new Date();
            const result = await service.findCorrelatedLogs({
                projectId: project.id,
                identifierValue: 'test',
                referenceTime,
                timeWindowMinutes: 30,
            });

            expect(result.timeWindow.from).toBeInstanceOf(Date);
            expect(result.timeWindow.to).toBeInstanceOf(Date);

            const expectedFrom = new Date(referenceTime.getTime() - 30 * 60 * 1000);
            const expectedTo = new Date(referenceTime.getTime() + 30 * 60 * 1000);

            expect(result.timeWindow.from.getTime()).toBe(expectedFrom.getTime());
            expect(result.timeWindow.to.getTime()).toBe(expectedTo.getTime());
        });
    });

    describe('getLogIdentifiers', () => {
        it('should return identifiers for a log', async () => {
            const { organization, project } = await createTestContext();

            const log = await createTestLog({ projectId: project.id });

            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log.id,
                        log_time: log.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'uuid',
                        identifier_value: '123e4567-e89b-12d3-a456-426614174000',
                        source_field: 'message',
                    },
                    {
                        log_id: log.id,
                        log_time: log.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'user_id',
                        identifier_value: 'usr_123',
                        source_field: 'metadata.user_id',
                    },
                ])
                .execute();

            const identifiers = await service.getLogIdentifiers(log.id);

            expect(identifiers.length).toBe(2);
            expect(identifiers).toContainEqual({
                type: 'uuid',
                value: '123e4567-e89b-12d3-a456-426614174000',
                sourceField: 'message',
            });
        });

        it('should return empty array for log with no identifiers', async () => {
            const { project } = await createTestContext();

            const log = await createTestLog({ projectId: project.id });

            const identifiers = await service.getLogIdentifiers(log.id);

            expect(identifiers.length).toBe(0);
        });
    });

    describe('getLogIdentifiersBatch', () => {
        it('should return identifiers for multiple logs', async () => {
            const { organization, project } = await createTestContext();

            const log1 = await createTestLog({ projectId: project.id });
            const log2 = await createTestLog({ projectId: project.id });

            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log1.id,
                        log_time: log1.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'uuid',
                        identifier_value: 'uuid-1',
                        source_field: 'message',
                    },
                    {
                        log_id: log2.id,
                        log_time: log2.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'uuid',
                        identifier_value: 'uuid-2',
                        source_field: 'message',
                    },
                ])
                .execute();

            const result = await service.getLogIdentifiersBatch([log1.id, log2.id]);

            expect(result.size).toBe(2);
            expect(result.get(log1.id)).toHaveLength(1);
            expect(result.get(log2.id)).toHaveLength(1);
        });

        it('should return empty map for empty input', async () => {
            const result = await service.getLogIdentifiersBatch([]);

            expect(result.size).toBe(0);
        });

        it('should handle logs with multiple identifiers', async () => {
            const { organization, project } = await createTestContext();

            const log = await createTestLog({ projectId: project.id });

            await db
                .insertInto('log_identifiers')
                .values([
                    {
                        log_id: log.id,
                        log_time: log.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'uuid',
                        identifier_value: 'uuid-1',
                        source_field: 'message',
                    },
                    {
                        log_id: log.id,
                        log_time: log.time,
                        project_id: project.id,
                        organization_id: organization.id,
                        identifier_type: 'user_id',
                        identifier_value: 'usr-1',
                        source_field: 'metadata',
                    },
                ])
                .execute();

            const result = await service.getLogIdentifiersBatch([log.id]);

            expect(result.get(log.id)).toHaveLength(2);
        });

        it('should handle partial results', async () => {
            const { organization, project } = await createTestContext();

            const log1 = await createTestLog({ projectId: project.id });
            const log2 = await createTestLog({ projectId: project.id });

            // Only add identifier for log1
            await db
                .insertInto('log_identifiers')
                .values({
                    log_id: log1.id,
                    log_time: log1.time,
                    project_id: project.id,
                    organization_id: organization.id,
                    identifier_type: 'uuid',
                    identifier_value: 'uuid-1',
                    source_field: 'message',
                })
                .execute();

            const result = await service.getLogIdentifiersBatch([log1.id, log2.id]);

            expect(result.get(log1.id)).toHaveLength(1);
            expect(result.get(log2.id)).toBeUndefined();
        });
    });
});
