import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { db } from '../../../database/index.js';
import { authService, AuthService } from '../../../modules/auth/service.js';
import { createTestContext } from '../../helpers/factories.js';

describe('AuthService', () => {
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
    });

    describe('generateApiKey', () => {
        it('should generate a key with correct prefix', () => {
            const key = authService.generateApiKey();
            expect(key).toMatch(/^lp_/);
        });

        it('should generate a 64-character hex string after prefix', () => {
            const key = authService.generateApiKey();
            const hex = key.replace('lp_', '');
            expect(hex).toHaveLength(64);
            expect(hex).toMatch(/^[a-f0-9]+$/);
        });

        it('should generate unique keys', () => {
            const keys = new Set<string>();
            for (let i = 0; i < 100; i++) {
                keys.add(authService.generateApiKey());
            }
            expect(keys.size).toBe(100);
        });
    });

    describe('createApiKey', () => {
        it('should create an API key in the database', async () => {
            const { project } = await createTestContext();

            const result = await authService.createApiKey('Test Key', project.id);

            expect(result.id).toBeDefined();
            expect(result.apiKey).toMatch(/^lp_/);

            // Verify in database
            const dbKey = await db
                .selectFrom('api_keys')
                .selectAll()
                .where('id', '=', result.id)
                .executeTakeFirst();

            expect(dbKey).toBeDefined();
            expect(dbKey?.name).toBe('Test Key');
            expect(dbKey?.project_id).toBe(project.id);
            expect(dbKey?.revoked).toBe(false);
        });

        it('should hash the API key before storing', async () => {
            const { project } = await createTestContext();

            const result = await authService.createApiKey('Hashed Key', project.id);

            const dbKey = await db
                .selectFrom('api_keys')
                .selectAll()
                .where('id', '=', result.id)
                .executeTakeFirst();

            // The stored key_hash should not equal the plain key
            expect(dbKey?.key_hash).not.toBe(result.apiKey);
            // Should be a SHA-256 hash (64 hex chars)
            expect(dbKey?.key_hash).toHaveLength(64);
            expect(dbKey?.key_hash).toMatch(/^[a-f0-9]+$/);
        });
    });

    describe('verifyApiKey', () => {
        it('should return true for valid API key', async () => {
            const { project } = await createTestContext();
            const { apiKey } = await authService.createApiKey('Valid Key', project.id);

            const isValid = await authService.verifyApiKey(apiKey);

            expect(isValid).toBe(true);
        });

        it('should return false for invalid API key', async () => {
            const isValid = await authService.verifyApiKey('lp_invalid_key_12345');

            expect(isValid).toBe(false);
        });

        it('should return false for revoked API key', async () => {
            const { project } = await createTestContext();
            const { id, apiKey } = await authService.createApiKey('Revoked Key', project.id);

            // Revoke the key
            await authService.revokeApiKey(id);

            const isValid = await authService.verifyApiKey(apiKey);

            expect(isValid).toBe(false);
        });

        it('should update last_used timestamp on successful verification', async () => {
            const { project } = await createTestContext();
            const { id, apiKey } = await authService.createApiKey('Timestamp Key', project.id);

            // Get initial last_used
            const before = await db
                .selectFrom('api_keys')
                .select(['last_used'])
                .where('id', '=', id)
                .executeTakeFirst();

            // Wait a bit and verify
            await new Promise((resolve) => setTimeout(resolve, 10));
            await authService.verifyApiKey(apiKey);

            const after = await db
                .selectFrom('api_keys')
                .select(['last_used'])
                .where('id', '=', id)
                .executeTakeFirst();

            expect(after?.last_used).toBeDefined();
            // last_used should be updated (or set if it was null)
            if (before?.last_used) {
                expect(after?.last_used?.getTime()).toBeGreaterThanOrEqual(
                    before.last_used.getTime()
                );
            }
        });
    });

    describe('revokeApiKey', () => {
        it('should revoke an existing API key', async () => {
            const { project } = await createTestContext();
            const { id } = await authService.createApiKey('To Revoke', project.id);

            await authService.revokeApiKey(id);

            const dbKey = await db
                .selectFrom('api_keys')
                .selectAll()
                .where('id', '=', id)
                .executeTakeFirst();

            expect(dbKey?.revoked).toBe(true);
        });

        it('should not throw for non-existent key', async () => {
            // Should not throw, just do nothing
            await expect(
                authService.revokeApiKey('00000000-0000-0000-0000-000000000000')
            ).resolves.not.toThrow();
        });
    });

    describe('listApiKeys', () => {
        it('should return all API keys', async () => {
            const { project } = await createTestContext();

            await authService.createApiKey('Key 1', project.id);
            await authService.createApiKey('Key 2', project.id);
            await authService.createApiKey('Key 3', project.id);

            const keys = await authService.listApiKeys();

            // createTestContext creates one key, plus our 3 = 4 total
            expect(keys.length).toBe(4);
            expect(keys.some((k) => k.name === 'Key 1')).toBe(true);
            expect(keys.some((k) => k.name === 'Key 2')).toBe(true);
            expect(keys.some((k) => k.name === 'Key 3')).toBe(true);
        });

        it('should return keys ordered by created_at desc', async () => {
            const { project } = await createTestContext();

            await authService.createApiKey('First', project.id);
            await new Promise((resolve) => setTimeout(resolve, 10));
            await authService.createApiKey('Second', project.id);
            await new Promise((resolve) => setTimeout(resolve, 10));
            await authService.createApiKey('Third', project.id);

            const keys = await authService.listApiKeys();

            // Find indices in the full list - newer should come first
            const thirdIdx = keys.findIndex((k) => k.name === 'Third');
            const secondIdx = keys.findIndex((k) => k.name === 'Second');
            const firstIdx = keys.findIndex((k) => k.name === 'First');

            // Should be ordered newest first (lower index = newer)
            expect(thirdIdx).toBeLessThan(secondIdx);
            expect(secondIdx).toBeLessThan(firstIdx);
        });

        it('should include revoked keys in the list', async () => {
            const { project } = await createTestContext();

            const { id } = await authService.createApiKey('Revoked', project.id);
            await authService.revokeApiKey(id);

            const keys = await authService.listApiKeys();
            const revokedKey = keys.find((k) => k.name === 'Revoked');

            expect(revokedKey).toBeDefined();
            expect(revokedKey?.revoked).toBe(true);
        });

        it('should not include key_hash in response', async () => {
            const { project } = await createTestContext();
            await authService.createApiKey('Secret', project.id);

            const keys = await authService.listApiKeys();

            // The returned object should not have key_hash
            keys.forEach((key) => {
                expect(key).not.toHaveProperty('key_hash');
            });
        });
    });

    describe('AuthService class instantiation', () => {
        it('should be a singleton export', () => {
            expect(authService).toBeInstanceOf(AuthService);
        });

        it('should allow creating new instances', () => {
            const newService = new AuthService();
            expect(newService).toBeInstanceOf(AuthService);
            expect(newService.generateApiKey()).toMatch(/^lp_/);
        });
    });
});
