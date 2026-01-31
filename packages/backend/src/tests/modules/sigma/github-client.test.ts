import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SigmaHQClient } from '../../../modules/sigma/github-client.js';

// Create mock functions using vi.hoisted() so they're available when vi.mock() runs
const { mockGet, mockSetex, mockIsRedisAvailable } = vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockSetex: vi.fn(),
    mockIsRedisAvailable: vi.fn(),
}));

// Mock Redis connection
vi.mock('../../../queue/connection.js', () => ({
    connection: {
        get: mockGet,
        setex: mockSetex,
    },
    isRedisAvailable: mockIsRedisAvailable,
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SigmaHQClient', () => {
    let client: SigmaHQClient;

    beforeEach(() => {
        client = new SigmaHQClient();
        // Reset all mocks
        mockGet.mockReset();
        mockSetex.mockReset();
        mockIsRedisAvailable.mockReset();
        mockFetch.mockReset();

        // Set default mock implementations
        mockGet.mockResolvedValue(null);
        mockSetex.mockResolvedValue('OK');
        mockIsRedisAvailable.mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should create client without token', () => {
            const client = new SigmaHQClient();
            expect(client).toBeInstanceOf(SigmaHQClient);
        });

        it('should create client with GitHub token', () => {
            const client = new SigmaHQClient('test-github-token');
            expect(client).toBeInstanceOf(SigmaHQClient);
        });
    });

    describe('getLatestCommit', () => {
        it('should fetch latest commit from GitHub API', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ sha: 'abc123def456' }),
            });

            const commit = await client.getLatestCommit();

            expect(commit).toBe('abc123def456');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.github.com/repos/SigmaHQ/sigma/commits/master',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Accept: 'application/vnd.github.v3+json',
                    }),
                })
            );
        });

        it('should throw error on API failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                statusText: 'Forbidden',
            });

            await expect(client.getLatestCommit()).rejects.toThrow('GitHub API error: 403 Forbidden');
        });

        it('should use cached commit if available', async () => {
            mockGet.mockResolvedValueOnce('cached-commit-sha');

            const commit = await client.getLatestCommit();

            expect(commit).toBe('cached-commit-sha');
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('getCategories', () => {
        it('should fetch categories from GitHub API', async () => {
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve([
                        { name: 'windows', path: 'rules/windows', type: 'dir' },
                        { name: 'linux', path: 'rules/linux', type: 'dir' },
                        { name: 'README.md', path: 'rules/README.md', type: 'file' },
                    ]),
                })
                // For countRulesInCategory and getSubcategories
                .mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve({
                        sha: 'abc123',
                        tree: [],
                        truncated: false,
                    }),
                });

            const categories = await client.getCategories();

            expect(categories).toHaveLength(2);
            expect(categories[0].name).toBe('windows');
            expect(categories[1].name).toBe('linux');
        });

        it('should throw error on API failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            await expect(client.getCategories()).rejects.toThrow('GitHub API error: 404 Not Found');
        });

        it('should use cached categories if available', async () => {
            const cachedCategories = [
                { name: 'cached', path: 'rules/cached', ruleCount: 10 },
            ];
            mockGet.mockResolvedValueOnce(JSON.stringify(cachedCategories));

            const categories = await client.getCategories();

            expect(categories).toEqual(cachedCategories);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('fetchRule', () => {
        it('should fetch rule content from raw GitHub', async () => {
            const yamlContent = 'title: Test Rule\nlevel: high\n';
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: () => Promise.resolve(yamlContent),
            });

            const content = await client.fetchRule('rules/windows/test.yml');

            expect(content).toBe(yamlContent);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://raw.githubusercontent.com/SigmaHQ/sigma/master/rules/windows/test.yml'
            );
        });

        it('should handle full URL path', async () => {
            const yamlContent = 'title: Test Rule\n';
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: () => Promise.resolve(yamlContent),
            });

            const content = await client.fetchRule('https://example.com/rule.yml');

            expect(content).toBe(yamlContent);
            expect(mockFetch).toHaveBeenCalledWith('https://example.com/rule.yml');
        });

        it('should throw error on fetch failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });

            await expect(client.fetchRule('nonexistent.yml')).rejects.toThrow(
                'Failed to fetch rule: 404 Not Found'
            );
        });
    });

    describe('fetchRulesByCategory', () => {
        it('should fetch rules for a category', async () => {
            // Mock getLatestCommit
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ sha: 'commit123' }),
            });

            // Mock tree API
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    sha: 'commit123',
                    tree: [
                        { path: 'rules/windows/rule1.yml', type: 'blob', sha: 'sha1' },
                        { path: 'rules/windows/rule2.yaml', type: 'blob', sha: 'sha2' },
                        { path: 'rules/windows/subdir', type: 'tree', sha: 'sha3' },
                        { path: 'rules/linux/other.yml', type: 'blob', sha: 'sha4' },
                    ],
                    truncated: false,
                }),
            });

            const rules = await client.fetchRulesByCategory('windows');

            expect(rules).toHaveLength(2);
            expect(rules[0].name).toBe('rule1.yml');
            expect(rules[1].name).toBe('rule2.yaml');
        });

        it('should use cached rules if available', async () => {
            const cachedRules = [
                { path: 'rules/cached/rule.yml', name: 'rule.yml', category: 'cached', downloadUrl: 'url', sha: 'sha' },
            ];
            mockGet.mockResolvedValueOnce(JSON.stringify(cachedRules));

            const rules = await client.fetchRulesByCategory('cached');

            expect(rules).toEqual(cachedRules);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('searchRulesByTag', () => {
        it('should search rules by tag using GitHub Search API', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    items: [
                        { path: 'rules/windows/rule1.yml', name: 'rule1.yml', sha: 'sha1' },
                        { path: 'rules/linux/rule2.yml', name: 'rule2.yml', sha: 'sha2' },
                    ],
                }),
            });

            const rules = await client.searchRulesByTag('attack.execution');

            expect(rules).toHaveLength(2);
            expect(rules[0].name).toBe('rule1.yml');
            expect(rules[0].category).toBe('windows');
        });

        it('should throw error on search API failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                statusText: 'Rate Limited',
            });

            await expect(client.searchRulesByTag('test')).rejects.toThrow(
                'GitHub Search API error: 403 Rate Limited'
            );
        });
    });

    describe('fetchAllRules', () => {
        it('should fetch all rules from repository', async () => {
            // Mock getLatestCommit
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ sha: 'commit123' }),
            });

            // Mock tree API
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    sha: 'commit123',
                    tree: [
                        { path: 'rules/windows/rule1.yml', type: 'blob', sha: 'sha1' },
                        { path: 'rules/linux/rule2.yml', type: 'blob', sha: 'sha2' },
                        { path: 'README.md', type: 'blob', sha: 'sha3' },
                    ],
                    truncated: false,
                }),
            });

            const rules = await client.fetchAllRules();

            expect(rules).toHaveLength(2);
        });

        it('should use cached all rules if available', async () => {
            const cachedRules = [{ path: 'rules/cached/rule.yml', name: 'rule.yml' }];
            mockGet.mockResolvedValueOnce(JSON.stringify(cachedRules));

            const rules = await client.fetchAllRules();

            expect(rules).toEqual(cachedRules);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('buildCategoryTree', () => {
        it('should build hierarchical category tree', async () => {
            // No cache - explicitly return null
            mockGet.mockResolvedValueOnce(null);

            // Mock getCategories
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve([
                        { name: 'windows', path: 'rules/windows', type: 'dir' },
                    ]),
                })
                .mockResolvedValue({
                    ok: true,
                    json: () => Promise.resolve({
                        sha: 'abc',
                        tree: [],
                        truncated: false,
                    }),
                });

            const tree = await client.buildCategoryTree();

            expect(Array.isArray(tree)).toBe(true);
        });

        it('should use cached tree if available', async () => {
            const cachedTree = [{ name: 'cached', path: 'rules/cached', type: 'category', ruleCount: 5 }];
            mockGet.mockResolvedValueOnce(JSON.stringify(cachedTree));

            const tree = await client.buildCategoryTree();

            expect(tree).toEqual(cachedTree);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('getRulesForCategory', () => {
        it('should get rules without metadata', async () => {
            // Mock fetchRulesByCategory chain
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ sha: 'commit123' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({
                        sha: 'commit123',
                        tree: [
                            { path: 'rules/windows/rule1.yml', type: 'blob', sha: 'sha1' },
                        ],
                        truncated: false,
                    }),
                });

            const rules = await client.getRulesForCategory('windows', false);

            expect(rules).toHaveLength(1);
            expect(rules[0].name).toBe('rule1.yml');
        });

        it('should get rules with metadata when requested', async () => {
            // Mock fetchRulesByCategory chain
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ sha: 'commit123' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({
                        sha: 'commit123',
                        tree: [
                            { path: 'rules/windows/rule1.yml', type: 'blob', sha: 'sha1' },
                        ],
                        truncated: false,
                    }),
                })
                // Mock rule content fetch
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve('title: Test Rule\nlevel: high\ndescription: A test rule\n'),
                });

            const rules = await client.getRulesForCategory('windows', true);

            expect(rules).toHaveLength(1);
            expect(rules[0].title).toBe('Test Rule');
            expect(rules[0].level).toBe('high');
            expect(rules[0].description).toBe('A test rule');
        });
    });

    describe('searchRules', () => {
        it('should search rules by query', async () => {
            // No cache for search, no cache for fetchAllRules
            mockGet
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null);

            // Mock fetchAllRules chain
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ sha: 'commit123' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({
                        sha: 'commit123',
                        tree: [
                            { path: 'rules/windows/mimikatz.yml', type: 'blob', sha: 'sha1' },
                            { path: 'rules/windows/other.yml', type: 'blob', sha: 'sha2' },
                        ],
                        truncated: false,
                    }),
                })
                // Mock rule content fetch for matching rule
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve('title: Mimikatz Detection\nlevel: critical\n'),
                });

            const rules = await client.searchRules('mimikatz');

            expect(rules.length).toBeGreaterThan(0);
            expect(rules[0].name).toContain('mimikatz');
        });

        it('should use cached search results if available', async () => {
            const cachedResults = [
                { path: 'rules/windows/cached.yml', name: 'cached.yml', title: 'Cached Rule' },
            ];
            mockGet.mockResolvedValueOnce(JSON.stringify(cachedResults));

            const rules = await client.searchRules('test');

            expect(rules).toEqual(cachedResults);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('parseRuleMetadata (private method via getRulesForCategory)', () => {
        it('should parse tags from YAML', async () => {
            // Mock fetchRulesByCategory chain
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ sha: 'commit123' }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({
                        sha: 'commit123',
                        tree: [
                            { path: 'rules/windows/rule1.yml', type: 'blob', sha: 'sha1' },
                        ],
                        truncated: false,
                    }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    text: () => Promise.resolve(`title: Tagged Rule
level: medium
description: A rule with tags
tags:
    - attack.execution
    - attack.t1059
`),
                });

            const rules = await client.getRulesForCategory('windows', true);

            expect(rules[0].tags).toEqual(['attack.execution', 'attack.t1059']);
        });
    });
});
