import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import { db } from '../../../database/index.js';
import { LocalProvider } from '../../../modules/auth/providers/local-provider.js';
import { createTestUser } from '../../helpers/factories.js';
import { AuthErrorCode } from '../../../modules/auth/providers/types.js';

describe('LocalProvider', () => {
    let localProvider: LocalProvider;

    const providerConfig = {
        id: 'local-test-id',
        type: 'local' as const,
        name: 'Email & Password',
        slug: 'local',
        enabled: true,
        isDefault: true,
        displayOrder: 0,
        icon: 'mail',
        config: {},
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(async () => {
        localProvider = new LocalProvider(providerConfig);

        // Clean up
        await db.deleteFrom('user_identities').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();
    });

    afterAll(async () => {
        await db.deleteFrom('user_identities').execute();
        await db.deleteFrom('sessions').execute();
        await db.deleteFrom('organization_members').execute();
        await db.deleteFrom('api_keys').execute();
        await db.deleteFrom('projects').execute();
        await db.deleteFrom('organizations').execute();
        await db.deleteFrom('users').execute();
    });

    describe('constructor', () => {
        it('should set type to local', () => {
            expect(localProvider.type).toBe('local');
        });

        it('should store config', () => {
            expect(localProvider.config).toEqual(providerConfig);
        });
    });

    describe('authenticate', () => {
        it('should return error when email is missing', async () => {
            const result = await localProvider.authenticate({ password: 'test123' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Email and password are required');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when password is missing', async () => {
            const result = await localProvider.authenticate({ email: 'test@example.com' });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Email and password are required');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when both email and password are missing', async () => {
            const result = await localProvider.authenticate({});

            expect(result.success).toBe(false);
            expect(result.error).toBe('Email and password are required');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when user not found', async () => {
            const result = await localProvider.authenticate({
                email: 'nonexistent@example.com',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid email or password');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when user has no password hash (SSO user)', async () => {
            // Create user without password
            await db.insertInto('users').values({
                email: 'sso-user@example.com',
                name: 'SSO User',
                password_hash: null,
                is_admin: false,
                disabled: false,
            }).execute();

            const result = await localProvider.authenticate({
                email: 'sso-user@example.com',
                password: 'anypassword',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Please log in using your organization SSO');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return error when user is disabled', async () => {
            const passwordHash = await bcrypt.hash('password123', 10);
            await db.insertInto('users').values({
                email: 'disabled@example.com',
                name: 'Disabled User',
                password_hash: passwordHash,
                is_admin: false,
                disabled: true,
            }).execute();

            const result = await localProvider.authenticate({
                email: 'disabled@example.com',
                password: 'password123',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('This account has been disabled');
            expect(result.errorCode).toBe(AuthErrorCode.USER_DISABLED);
        });

        it('should return error when password is incorrect', async () => {
            const passwordHash = await bcrypt.hash('correctpassword', 10);
            await db.insertInto('users').values({
                email: 'test@example.com',
                name: 'Test User',
                password_hash: passwordHash,
                is_admin: false,
                disabled: false,
            }).execute();

            const result = await localProvider.authenticate({
                email: 'test@example.com',
                password: 'wrongpassword',
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid email or password');
            expect(result.errorCode).toBe(AuthErrorCode.INVALID_CREDENTIALS);
        });

        it('should return success when credentials are valid', async () => {
            const password = 'correctpassword123';
            const passwordHash = await bcrypt.hash(password, 10);

            const user = await db.insertInto('users').values({
                email: 'valid@example.com',
                name: 'Valid User',
                password_hash: passwordHash,
                is_admin: false,
                disabled: false,
            }).returningAll().executeTakeFirstOrThrow();

            const result = await localProvider.authenticate({
                email: 'valid@example.com',
                password,
            });

            expect(result.success).toBe(true);
            expect(result.providerUserId).toBe('valid@example.com');
            expect(result.email).toBe('valid@example.com');
            expect(result.name).toBe('Valid User');
            expect(result.metadata?.userId).toBe(user.id);
        });

        it('should normalize email to lowercase', async () => {
            const password = 'password123';
            const passwordHash = await bcrypt.hash(password, 10);

            const user = await db.insertInto('users').values({
                email: 'uppercase@example.com',
                name: 'Test User',
                password_hash: passwordHash,
                is_admin: false,
                disabled: false,
            }).returningAll().executeTakeFirstOrThrow();

            const result = await localProvider.authenticate({
                email: 'UPPERCASE@EXAMPLE.COM',
                password,
            });

            expect(result.success).toBe(true);
            expect(result.email).toBe('uppercase@example.com');
        });

        it('should trim whitespace from email', async () => {
            const password = 'password123';
            const passwordHash = await bcrypt.hash(password, 10);

            await db.insertInto('users').values({
                email: 'trimmed@example.com',
                name: 'Test User',
                password_hash: passwordHash,
                is_admin: false,
                disabled: false,
            }).execute();

            const result = await localProvider.authenticate({
                email: '  trimmed@example.com  ',
                password,
            });

            expect(result.success).toBe(true);
        });
    });

    describe('supportsRedirect', () => {
        it('should return false', () => {
            expect(localProvider.supportsRedirect()).toBe(false);
        });
    });

    describe('validateConfig', () => {
        it('should always return true', () => {
            expect(localProvider.validateConfig()).toBe(true);
        });
    });

    describe('testConnection', () => {
        it('should always return success', async () => {
            const result = await localProvider.testConnection();

            expect(result.success).toBe(true);
            expect(result.message).toBe('Local authentication is always available');
        });
    });
});
