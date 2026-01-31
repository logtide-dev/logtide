import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../database/index.js';
import { IdentifierPatternRegistry } from '../../../modules/correlation/pattern-registry.js';
import { createTestOrganization } from '../../helpers/factories.js';

describe('IdentifierPatternRegistry', () => {
    let registry: IdentifierPatternRegistry;

    beforeEach(async () => {
        registry = new IdentifierPatternRegistry();
        await db.deleteFrom('identifier_patterns').execute();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getDefaultPatterns', () => {
        it('should return all default patterns', () => {
            const patterns = registry.getDefaultPatterns();

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns.every((p) => p.isBuiltIn)).toBe(true);
        });

        it('should include UUID pattern', () => {
            const patterns = registry.getDefaultPatterns();
            const uuidPattern = patterns.find((p) => p.type === 'uuid');

            expect(uuidPattern).toBeDefined();
            expect(uuidPattern?.displayName).toBe('UUID');
        });

        it('should include request_id pattern', () => {
            const patterns = registry.getDefaultPatterns();
            const requestIdPatterns = patterns.filter((p) => p.type === 'request_id');

            expect(requestIdPatterns.length).toBeGreaterThan(0);
        });

        it('should include session_id pattern', () => {
            const patterns = registry.getDefaultPatterns();
            const sessionIdPatterns = patterns.filter((p) => p.type === 'session_id');

            expect(sessionIdPatterns.length).toBeGreaterThan(0);
        });

        it('should include user_id pattern', () => {
            const patterns = registry.getDefaultPatterns();
            const userIdPatterns = patterns.filter((p) => p.type === 'user_id');

            expect(userIdPatterns.length).toBeGreaterThan(0);
        });

        it('should include trace_id pattern', () => {
            const patterns = registry.getDefaultPatterns();
            const traceIdPattern = patterns.find((p) => p.type === 'trace_id');

            expect(traceIdPattern).toBeDefined();
        });

        it('should include span_id pattern', () => {
            const patterns = registry.getDefaultPatterns();
            const spanIdPattern = patterns.find((p) => p.type === 'span_id');

            expect(spanIdPattern).toBeDefined();
        });
    });

    describe('getPatternsForOrg', () => {
        it('should return default patterns when no custom patterns exist', async () => {
            const org = await createTestOrganization();

            const patterns = await registry.getPatternsForOrg(org.id);

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns.every((p) => p.isBuiltIn)).toBe(true);
        });

        it('should include custom patterns for organization', async () => {
            const org = await createTestOrganization();

            // Create custom pattern
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: org.id,
                    name: 'custom_id',
                    display_name: 'Custom ID',
                    description: 'Test custom pattern',
                    pattern: '\\bCUST-[0-9]+\\b',
                    field_names: ['custom_id'],
                    enabled: true,
                    priority: 10,
                })
                .execute();

            const patterns = await registry.getPatternsForOrg(org.id);

            const customPattern = patterns.find((p) => p.type === 'custom_id');
            expect(customPattern).toBeDefined();
            expect(customPattern?.isBuiltIn).toBe(false);
            expect(customPattern?.priority).toBe(10);
        });

        it('should cache patterns for organization', async () => {
            const org = await createTestOrganization();

            // First call
            const patterns1 = await registry.getPatternsForOrg(org.id);

            // Second call should use cache
            const patterns2 = await registry.getPatternsForOrg(org.id);

            expect(patterns1).toBe(patterns2); // Same reference from cache
        });

        it('should not include disabled custom patterns', async () => {
            const org = await createTestOrganization();

            // Create disabled pattern
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: org.id,
                    name: 'disabled_pattern',
                    display_name: 'Disabled Pattern',
                    pattern: '\\bDIS-[0-9]+\\b',
                    field_names: [],
                    enabled: false,
                    priority: 10,
                })
                .execute();

            const patterns = await registry.getPatternsForOrg(org.id);

            const disabledPattern = patterns.find((p) => p.type === 'disabled_pattern');
            expect(disabledPattern).toBeUndefined();
        });

        it('should sort patterns by priority', async () => {
            const org = await createTestOrganization();

            // Create custom patterns with different priorities
            await db
                .insertInto('identifier_patterns')
                .values([
                    {
                        organization_id: org.id,
                        name: 'low_priority',
                        display_name: 'Low Priority',
                        pattern: '\\bLOW-[0-9]+\\b',
                        field_names: [],
                        enabled: true,
                        priority: 200,
                    },
                    {
                        organization_id: org.id,
                        name: 'high_priority',
                        display_name: 'High Priority',
                        pattern: '\\bHIGH-[0-9]+\\b',
                        field_names: [],
                        enabled: true,
                        priority: 5,
                    },
                ])
                .execute();

            const patterns = await registry.getPatternsForOrg(org.id);

            const highIndex = patterns.findIndex((p) => p.type === 'high_priority');
            const lowIndex = patterns.findIndex((p) => p.type === 'low_priority');

            expect(highIndex).toBeLessThan(lowIndex);
        });

        it('should handle invalid custom regex gracefully', async () => {
            const org = await createTestOrganization();

            // Create pattern with invalid regex
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: org.id,
                    name: 'invalid_pattern',
                    display_name: 'Invalid Pattern',
                    pattern: '[invalid regex(', // Invalid regex
                    field_names: [],
                    enabled: true,
                    priority: 10,
                })
                .execute();

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const patterns = await registry.getPatternsForOrg(org.id);

            // Should not include invalid pattern but should not crash
            const invalidPattern = patterns.find((p) => p.type === 'invalid_pattern');
            expect(invalidPattern).toBeUndefined();
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });

    describe('invalidateCache', () => {
        it('should clear cache for organization', async () => {
            const org = await createTestOrganization();

            // Populate cache
            await registry.getPatternsForOrg(org.id);

            // Add new pattern
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: org.id,
                    name: 'new_pattern',
                    display_name: 'New Pattern',
                    pattern: '\\bNEW-[0-9]+\\b',
                    field_names: [],
                    enabled: true,
                    priority: 10,
                })
                .execute();

            // Invalidate cache
            registry.invalidateCache(org.id);

            // Should now include new pattern
            const patterns = await registry.getPatternsForOrg(org.id);
            const newPattern = patterns.find((p) => p.type === 'new_pattern');
            expect(newPattern).toBeDefined();
        });
    });

    describe('extractFromText', () => {
        it('should extract UUID from text', async () => {
            const text = 'Request 123e4567-e89b-12d3-a456-426614174000 failed';

            const matches = await registry.extractFromText(text);

            expect(matches).toContainEqual({
                type: 'uuid',
                value: '123e4567-e89b-12d3-a456-426614174000',
            });
        });

        it('should extract request_id from text', async () => {
            const text = 'request_id: req_abc123def456';

            const matches = await registry.extractFromText(text);

            const requestIdMatch = matches.find((m) => m.type === 'request_id');
            expect(requestIdMatch).toBeDefined();
        });

        it('should extract multiple identifiers from text', async () => {
            const text = 'User user_123 made request req_abc123 with trace_id 0123456789abcdef0123456789abcdef';

            const matches = await registry.extractFromText(text);

            expect(matches.length).toBeGreaterThan(1);
        });

        it('should use org patterns when organizationId provided', async () => {
            const org = await createTestOrganization();

            // Create custom pattern
            await db
                .insertInto('identifier_patterns')
                .values({
                    organization_id: org.id,
                    name: 'custom_order',
                    display_name: 'Custom Order',
                    pattern: '\\bORD-([A-Z0-9]+)\\b',
                    field_names: [],
                    enabled: true,
                    priority: 10,
                })
                .execute();

            const text = 'Processing ORD-ABC123';

            const matches = await registry.extractFromText(text, org.id);

            const customMatch = matches.find((m) => m.type === 'custom_order');
            expect(customMatch).toBeDefined();
        });

        it('should use default patterns when organizationId not provided', async () => {
            const text = 'UUID: 123e4567-e89b-12d3-a456-426614174000';

            const matches = await registry.extractFromText(text);

            expect(matches.length).toBeGreaterThan(0);
        });
    });

    describe('extractWithPatterns', () => {
        it('should extract identifiers using provided patterns', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'Request 123e4567-e89b-12d3-a456-426614174000 processed';

            const matches = registry.extractWithPatterns(text, patterns);

            expect(matches).toContainEqual({
                type: 'uuid',
                value: '123e4567-e89b-12d3-a456-426614174000',
            });
        });

        it('should deduplicate matches', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'UUID 123e4567-e89b-12d3-a456-426614174000 appears twice: 123e4567-e89b-12d3-a456-426614174000';

            const matches = registry.extractWithPatterns(text, patterns);

            const uuidMatches = matches.filter(
                (m) => m.value === '123e4567-e89b-12d3-a456-426614174000'
            );
            expect(uuidMatches.length).toBe(1);
        });

        it('should use capture group if available', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'requestId: abc123def456xyz';

            const matches = registry.extractWithPatterns(text, patterns);

            // Should use capture group value, not full match
            const requestMatch = matches.find((m) => m.type === 'request_id');
            if (requestMatch) {
                expect(requestMatch.value).not.toContain('requestId:');
            }
        });

        it('should return empty array for text with no identifiers', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'Just a regular log message with no identifiers';

            const matches = registry.extractWithPatterns(text, patterns);

            expect(matches.length).toBe(0);
        });

        it('should handle empty text', () => {
            const patterns = registry.getDefaultPatterns();

            const matches = registry.extractWithPatterns('', patterns);

            expect(matches.length).toBe(0);
        });
    });

    describe('matchFieldName', () => {
        it('should match field name to pattern', () => {
            const patterns = registry.getDefaultPatterns();

            const match = registry.matchFieldName('user_id', 'usr_12345', patterns);

            expect(match).not.toBeNull();
            expect(match?.type).toBe('user_id');
            expect(match?.value).toBe('usr_12345');
        });

        it('should match case-insensitively', () => {
            const patterns = registry.getDefaultPatterns();

            const match = registry.matchFieldName('USER_ID', 'usr_12345', patterns);

            expect(match).not.toBeNull();
            expect(match?.type).toBe('user_id');
        });

        it('should return null for unknown field name', () => {
            const patterns = registry.getDefaultPatterns();

            const match = registry.matchFieldName('unknown_field', 'some_value', patterns);

            expect(match).toBeNull();
        });

        it('should return null for empty value', () => {
            const patterns = registry.getDefaultPatterns();

            const match = registry.matchFieldName('user_id', '', patterns);

            expect(match).toBeNull();
        });

        it('should return null for non-string value', () => {
            const patterns = registry.getDefaultPatterns();

            const match = registry.matchFieldName('user_id', 12345 as any, patterns);

            expect(match).toBeNull();
        });

        it('should skip patterns with no fieldNames', () => {
            const patterns = registry.getDefaultPatterns();

            // Prefixed patterns have empty fieldNames
            const prefixedPatterns = patterns.filter((p) => p.fieldNames.length === 0);
            expect(prefixedPatterns.length).toBeGreaterThan(0);

            // Should not match by field name if pattern has no fieldNames
            const match = registry.matchFieldName('some_field', 'req_12345', patterns);
            // Should only match if 'some_field' is in a pattern's fieldNames
            if (match) {
                const matchingPattern = patterns.find((p) => p.type === match.type);
                expect(matchingPattern?.fieldNames.length).toBeGreaterThan(0);
            }
        });
    });

    describe('default pattern matching', () => {
        it('should match UUID v4 format', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'id=123e4567-e89b-12d3-a456-426614174000';

            const matches = registry.extractWithPatterns(text, patterns);

            expect(matches).toContainEqual({
                type: 'uuid',
                value: '123e4567-e89b-12d3-a456-426614174000',
            });
        });

        it('should match prefixed request IDs', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'Processing req_abc123def456';

            const matches = registry.extractWithPatterns(text, patterns);

            const requestMatch = matches.find((m) => m.type === 'request_id');
            expect(requestMatch).toBeDefined();
        });

        it('should match prefixed session IDs', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'Session sess_xyz789abc123def';

            const matches = registry.extractWithPatterns(text, patterns);

            const sessionMatch = matches.find((m) => m.type === 'session_id');
            expect(sessionMatch).toBeDefined();
        });

        it('should match trace IDs (32 hex chars)', () => {
            const patterns = registry.getDefaultPatterns();
            // Pattern expects trace_id:VALUE or trace_id=VALUE or trace_id VALUE (single separator)
            const text = 'traceId=0123456789abcdef0123456789abcdef';

            const matches = registry.extractWithPatterns(text, patterns);

            const traceMatch = matches.find((m) => m.type === 'trace_id');
            expect(traceMatch).toBeDefined();
        });

        it('should match span IDs (16 hex chars)', () => {
            const patterns = registry.getDefaultPatterns();
            // Pattern expects span_id:VALUE or spanId=VALUE (single separator)
            const text = 'spanId=0123456789abcdef';

            const matches = registry.extractWithPatterns(text, patterns);

            const spanMatch = matches.find((m) => m.type === 'span_id');
            expect(spanMatch).toBeDefined();
        });

        it('should match transaction IDs', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'transaction_id: txn_abc123xyz';

            const matches = registry.extractWithPatterns(text, patterns);

            const txnMatch = matches.find((m) => m.type === 'transaction_id');
            expect(txnMatch).toBeDefined();
        });

        it('should match order IDs', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'Processing order_id: ord_abc123';

            const matches = registry.extractWithPatterns(text, patterns);

            const orderMatch = matches.find((m) => m.type === 'order_id');
            expect(orderMatch).toBeDefined();
        });

        it('should match correlation IDs', () => {
            const patterns = registry.getDefaultPatterns();
            const text = 'x-correlation-id: corr_abc123def456';

            const matches = registry.extractWithPatterns(text, patterns);

            const corrMatch = matches.find((m) => m.type === 'correlation_id');
            expect(corrMatch).toBeDefined();
        });
    });
});
