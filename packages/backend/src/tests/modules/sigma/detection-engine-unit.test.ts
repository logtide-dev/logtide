import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pure unit tests for SigmaDetectionEngine: the database is mocked with a
// fluent query builder stub so rule loading, logsource matching, log
// flattening and matched-field extraction can be exercised without Postgres.
// The condition evaluator and field matcher are the real implementations.

const dbState = vi.hoisted(() => ({
    rows: [] as any[],
    wheres: [] as any[],
    orArgs: [] as any[],
}));

vi.mock('../../../database/connection.js', () => {
    const builder: any = {
        selectAll: () => builder,
        where: (...args: any[]) => {
            if (typeof args[0] === 'function') {
                const eb: any = (...cmp: any[]) => ({ cmp });
                eb.or = (parts: any[]) => {
                    dbState.orArgs.push(parts);
                    return { or: parts };
                };
                dbState.wheres.push(args[0](eb));
            } else {
                dbState.wheres.push(args);
            }
            return builder;
        },
        execute: async () => dbState.rows,
    };
    return { db: { selectFrom: () => builder } };
});

import { SigmaDetectionEngine } from '../../../modules/sigma/detection-engine.js';

function row(overrides: Record<string, any> = {}) {
    return {
        id: 'rule-1',
        title: 'Suspicious message',
        description: 'desc',
        level: 'high',
        status: 'stable',
        logsource: {},
        detection: {
            selection: { 'message|contains': 'attack' },
            condition: 'selection',
        },
        tags: ['attack.t1059'],
        ...overrides,
    };
}

const ORG = 'org-1';

describe('SigmaDetectionEngine (unit)', () => {
    beforeEach(() => {
        dbState.rows = [];
        dbState.wheres = [];
        dbState.orArgs = [];
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('rule loading', () => {
        it('returns no match when there are no active rules', async () => {
            const result = await SigmaDetectionEngine.evaluateLog({ message: 'attack' }, ORG);
            expect(result).toEqual({ matched: false, matchedRules: [] });
            // org, conversion_status, enabled filters only (no project filter)
            expect(dbState.wheres).toHaveLength(3);
            expect(dbState.orArgs).toHaveLength(0);
        });

        it('adds a project-or-org-wide filter when a projectId is given', async () => {
            await SigmaDetectionEngine.evaluateLog({ message: 'x' }, ORG, 'proj-1');
            expect(dbState.wheres).toHaveLength(4);
            expect(dbState.orArgs).toHaveLength(1);
            expect(dbState.orArgs[0]).toEqual([
                { cmp: ['project_id', '=', 'proj-1'] },
                { cmp: ['project_id', 'is', null] },
            ]);
        });

        it('applies defaults for missing level, status, description and tags', async () => {
            dbState.rows = [row({ level: null, status: null, description: null, tags: undefined })];
            const result = await SigmaDetectionEngine.evaluateLog({ message: 'an attack happened' }, ORG);
            expect(result.matched).toBe(true);
            expect(result.matchedRules[0].ruleLevel).toBe('medium');
            expect(result.matchedRules[0].ruleTags).toBeUndefined();
        });

        it('reports rule metadata and matched fields on a match', async () => {
            dbState.rows = [row()];
            const result = await SigmaDetectionEngine.evaluateLog(
                { message: 'an ATTACK happened', service: 'api' },
                ORG,
            );
            expect(result.matched).toBe(true);
            expect(result.matchedRules).toHaveLength(1);
            const m = result.matchedRules[0];
            expect(m.sigmaRuleId).toBe('rule-1');
            expect(m.ruleTitle).toBe('Suspicious message');
            expect(m.ruleLevel).toBe('high');
            expect(m.ruleTags).toEqual(['attack.t1059']);
            expect(m.matchedAt).toBeInstanceOf(Date);
            // The field key carries the modifier, which is not a log field
            expect(m.matchedFields).toEqual({});
        });

        it('does not match when the detection does not match', async () => {
            dbState.rows = [row()];
            const result = await SigmaDetectionEngine.evaluateLog({ message: 'all good' }, ORG);
            expect(result).toEqual({ matched: false, matchedRules: [] });
        });
    });

    describe('logsource matching', () => {
        async function matches(logsource: any, log: any) {
            dbState.rows = [row({
                logsource,
                detection: { selection: { message: '*' }, condition: 'selection' },
            })];
            const r = await SigmaDetectionEngine.evaluateLog({ message: 'm', ...log }, ORG);
            return r.matched;
        }

        it('matches any log when the logsource is empty or missing', async () => {
            expect(await matches({}, {})).toBe(true);
            expect(await matches(null, {})).toBe(true);
        });

        it('matches service exactly, case-insensitively', async () => {
            expect(await matches({ service: 'SSHD' }, { service: 'sshd' })).toBe(true);
            expect(await matches({ service: 'sshd' }, { service: 'nginx' })).toBe(false);
            expect(await matches({ service: 'sshd' }, {})).toBe(false);
        });

        it('matches service wildcards and escapes regex characters', async () => {
            expect(await matches({ service: 'auth-*' }, { service: 'auth-api' })).toBe(true);
            expect(await matches({ service: 'auth-*' }, { service: 'billing' })).toBe(false);
            expect(await matches({ service: 'a.b*' }, { service: 'axb-1' })).toBe(false);
            expect(await matches({ service: 'a.b*' }, { service: 'a.b-1' })).toBe(true);
        });

        it('skips service validation for unknown services', async () => {
            expect(await matches({ service: 'sshd' }, { service: 'unknown' })).toBe(true);
        });

        it('matches product from metadata or top level', async () => {
            expect(await matches({ product: 'Linux' }, { metadata: { product: 'linux' } })).toBe(true);
            expect(await matches({ product: 'linux' }, { product: 'LINUX' })).toBe(true);
            expect(await matches({ product: 'linux' }, { product: 'windows' })).toBe(false);
            expect(await matches({ product: 'linux' }, {})).toBe(false);
        });

        it('treats product "any" and unknown log products as wildcards', async () => {
            expect(await matches({ product: 'any' }, { product: 'windows' })).toBe(true);
            expect(await matches({ product: 'linux' }, { product: 'unknown' })).toBe(true);
        });

        it('matches product wildcards', async () => {
            expect(await matches({ product: 'win*' }, { product: 'windows' })).toBe(true);
            expect(await matches({ product: 'win*' }, { product: 'linux' })).toBe(false);
        });

        it('matches category from metadata, top level, or service fallback', async () => {
            expect(await matches({ category: 'process_creation' }, { metadata: { category: 'process_creation' } })).toBe(true);
            expect(await matches({ category: 'webserver' }, { category: 'WebServer' })).toBe(true);
            expect(await matches({ category: 'webserver' }, { service: 'webserver' })).toBe(true);
            expect(await matches({ category: 'webserver' }, { service: 'db' })).toBe(false);
            expect(await matches({ category: 'webserver' }, {})).toBe(false);
        });

        it('treats unknown categories as wildcards and supports category wildcards', async () => {
            expect(await matches({ category: 'webserver' }, { category: 'unknown' })).toBe(true);
            expect(await matches({ category: 'process_*' }, { category: 'process_creation' })).toBe(true);
            expect(await matches({ category: 'process_*' }, { category: 'network' })).toBe(false);
        });

        it('requires every specified logsource field to match', async () => {
            expect(await matches(
                { service: 'sshd', product: 'linux', category: 'auth' },
                { service: 'sshd', product: 'linux', category: 'auth' },
            )).toBe(true);
            expect(await matches(
                { service: 'sshd', product: 'linux', category: 'auth' },
                { service: 'sshd', product: 'linux', category: 'network' },
            )).toBe(false);
        });
    });

    describe('log flattening and matched fields', () => {
        it('matches on nested metadata paths and root-promoted metadata keys', async () => {
            dbState.rows = [row({
                detection: {
                    selection: { 'metadata.user.name': 'root', 'action': 'login' },
                    condition: 'selection',
                },
            })];
            const result = await SigmaDetectionEngine.evaluateLog(
                { message: 'm', metadata: { user: { name: 'root' }, action: 'login', ips: ['1.1.1.1'] } },
                ORG,
            );
            expect(result.matched).toBe(true);
            expect(result.matchedRules[0].matchedFields).toEqual({
                'metadata.user.name': 'root',
                action: 'login',
            });
        });

        it('does not let metadata keys override top-level fields', async () => {
            dbState.rows = [row({
                detection: { selection: { service: 'api' }, condition: 'selection' },
            })];
            const result = await SigmaDetectionEngine.evaluateLog(
                { message: 'm', service: 'api', metadata: { service: 'spoofed' } },
                ORG,
            );
            expect(result.matched).toBe(true);
            expect(result.matchedRules[0].matchedFields).toEqual({ service: 'api' });
        });

        it('keeps arrays and nulls as leaf values when flattening metadata', async () => {
            dbState.rows = [row({
                detection: {
                    selection: { 'metadata.tags': '*admin*' },
                    filter: { 'metadata.extra|exists': true },
                    condition: 'selection and not filter',
                },
            })];
            const result = await SigmaDetectionEngine.evaluateLog(
                { message: 'm', metadata: { tags: ['admin'], extra: null } },
                ORG,
            );
            expect(result.matched).toBe(true);
            expect(result.matchedRules[0].matchedFields).toEqual({ 'metadata.tags': ['admin'] });
        });

        it('ignores keyword-list and non-object patterns when extracting fields', async () => {
            dbState.rows = [row({
                detection: {
                    keywords: ['attack'],
                    timeframe: '5m',
                    condition: 'keywords',
                },
            })];
            const result = await SigmaDetectionEngine.evaluateLog({ message: 'attack now', level: 'warn' }, ORG);
            expect(result.matched).toBe(true);
            // Arrays are objects: their indices are not log fields
            expect(result.matchedRules[0].matchedFields).toEqual({});
        });

        it('returns empty matched fields when field extraction throws', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const detection = new Proxy(
                { selection: { message: '*' }, condition: 'selection' },
                {
                    ownKeys: () => {
                        throw new Error('boom');
                    },
                },
            );
            dbState.rows = [row({ detection })];
            const result = await SigmaDetectionEngine.evaluateLog({ message: 'x' }, ORG);
            expect(result.matched).toBe(true);
            expect(result.matchedRules[0].matchedFields).toEqual({});
            expect(errSpy).toHaveBeenCalledWith(
                '[SigmaDetectionEngine] Error extracting matched fields:',
                expect.any(Error),
            );
        });
    });

    describe('error isolation', () => {
        it('logs a broken rule and keeps evaluating the others', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            dbState.rows = [row({ id: 'broken', detection: null }), row({ id: 'ok' })];
            const result = await SigmaDetectionEngine.evaluateLog({ message: 'attack' }, ORG);
            expect(result.matchedRules.map((r) => r.sigmaRuleId)).toEqual(['ok']);
            expect(errSpy).toHaveBeenCalledTimes(1);
            expect(String(errSpy.mock.calls[0][0])).toContain('broken');
        });
    });

    describe('evaluateBatch', () => {
        it('returns an empty result per log when there are no rules', async () => {
            const results = await SigmaDetectionEngine.evaluateBatch(
                [{ message: 'a' }, { message: 'b' }],
                ORG,
                'proj-1',
            );
            expect(results.size).toBe(2);
            expect(results.get(0)).toEqual({ matched: false, matchedRules: [] });
            expect(results.get(1)).toEqual({ matched: false, matchedRules: [] });
            expect(dbState.orArgs).toHaveLength(1);
        });

        it('evaluates every log against every rule, honoring logsource', async () => {
            dbState.rows = [
                row({ id: 'any-source' }),
                row({ id: 'sshd-only', logsource: { service: 'sshd' }, level: null, tags: undefined }),
            ];
            const results = await SigmaDetectionEngine.evaluateBatch(
                [
                    { message: 'attack', service: 'sshd' },
                    { message: 'attack', service: 'nginx' },
                    { message: 'quiet', service: 'sshd' },
                ],
                ORG,
            );
            expect(results.get(0)!.matchedRules.map((r) => r.sigmaRuleId)).toEqual(['any-source', 'sshd-only']);
            expect(results.get(0)!.matchedRules[1].ruleLevel).toBe('medium');
            expect(results.get(1)!.matchedRules.map((r) => r.sigmaRuleId)).toEqual(['any-source']);
            expect(results.get(2)).toEqual({ matched: false, matchedRules: [] });
        });

        it('isolates rule errors per log in batch mode', async () => {
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            dbState.rows = [row({ id: 'broken', detection: null }), row({ id: 'ok' })];
            const results = await SigmaDetectionEngine.evaluateBatch(
                [{ message: 'attack' }, { message: 'attack again' }],
                ORG,
            );
            expect(results.get(0)!.matchedRules.map((r) => r.sigmaRuleId)).toEqual(['ok']);
            expect(results.get(1)!.matched).toBe(true);
            expect(errSpy).toHaveBeenCalledTimes(2);
        });
    });
});
