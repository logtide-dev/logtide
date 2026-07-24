import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { UsersService } from '../../../modules/users/service.js';
import { createTestSession } from '../../helpers/auth.js';
import { authenticationService } from '../../../modules/auth/authentication-service.js';

describe('UsersService', () => {
    let usersService: UsersService;

    beforeEach(async () => {
        usersService = new UsersService();

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

    describe('hashPassword', () => {
        it('should hash a password', async () => {
            const password = 'testPassword123';
            const hash = await usersService.hashPassword(password);

            expect(hash).toBeDefined();
            expect(hash).not.toBe(password);
            expect(hash.length).toBeGreaterThan(0);
        });

        it('should generate different hashes for same password', async () => {
            const password = 'testPassword123';
            const hash1 = await usersService.hashPassword(password);
            const hash2 = await usersService.hashPassword(password);

            expect(hash1).not.toBe(hash2);
        });
    });

    describe('verifyPassword', () => {
        it('should verify correct password', async () => {
            const password = 'testPassword123';
            const hash = await usersService.hashPassword(password);

            const isValid = await usersService.verifyPassword(password, hash);

            expect(isValid).toBe(true);
        });

        it('should reject incorrect password', async () => {
            const password = 'testPassword123';
            const hash = await usersService.hashPassword(password);

            const isValid = await usersService.verifyPassword('wrongPassword', hash);

            expect(isValid).toBe(false);
        });
    });

    describe('generateToken', () => {
        it('should generate a 64-character hex string', () => {
            const token = usersService.generateToken();

            expect(token).toHaveLength(64);
            expect(token).toMatch(/^[a-f0-9]+$/);
        });

        it('should generate unique tokens', () => {
            const tokens = new Set<string>();
            for (let i = 0; i < 100; i++) {
                tokens.add(usersService.generateToken());
            }
            expect(tokens.size).toBe(100);
        });
    });

    describe('createUser', () => {
        it('should create a user with valid input', async () => {
            // Seed an existing admin so the new user is created as a regular (non-admin) user
            await db
                .insertInto('users')
                .values({
                    email: 'existing-admin@example.com',
                    password_hash: await usersService.hashPassword('adminpass'),
                    name: 'Existing Admin',
                    is_admin: true,
                })
                .execute();

            const user = await usersService.createUser({
                email: 'test@example.com',
                password: 'password123',
                name: 'Test User',
            });

            expect(user.id).toBeDefined();
            expect(user.email).toBe('test@example.com');
            expect(user.name).toBe('Test User');
            expect(user.is_admin).toBe(false);
            expect(user.disabled).toBe(false);
        });

        it('should promote the first user to admin when no admin exists', async () => {
            const user = await usersService.createUser({
                email: 'first@example.com',
                password: 'password123',
                name: 'First User',
            });

            expect(user.is_admin).toBe(true);
        });

        it('should not promote subsequent users to admin', async () => {
            const first = await usersService.createUser({
                email: 'first@example.com',
                password: 'password123',
                name: 'First User',
            });
            expect(first.is_admin).toBe(true);

            const second = await usersService.createUser({
                email: 'second@example.com',
                password: 'password123',
                name: 'Second User',
            });
            expect(second.is_admin).toBe(false);
        });

        it('promotes at most one admin under concurrent first-time registrations (race)', async () => {
            // Fire several registrations at once against an empty (zero-admin)
            // users table. Without serialization each would observe "no admin
            // yet" and all be promoted to admin.
            const N = 5;
            const users = await Promise.all(
                Array.from({ length: N }, (_, i) =>
                    usersService.createUser({
                        email: `race-${i}@example.com`,
                        password: 'password123',
                        name: `Race User ${i}`,
                    })
                )
            );

            const admins = users.filter((u) => u.is_admin);
            expect(admins).toHaveLength(1);

            // Confirm at the storage layer too.
            const adminCount = await db
                .selectFrom('users')
                .select((eb) => eb.fn.countAll().as('c'))
                .where('is_admin', '=', true)
                .executeTakeFirstOrThrow();
            expect(Number(adminCount.c)).toBe(1);
        });

        it('should throw error for duplicate email', async () => {
            await usersService.createUser({
                email: 'duplicate@example.com',
                password: 'password123',
                name: 'First User',
            });

            await expect(
                usersService.createUser({
                    email: 'duplicate@example.com',
                    password: 'password456',
                    name: 'Second User',
                })
            ).rejects.toThrow('User with this email already exists');
        });

        it('should store hashed password, not plain text', async () => {
            const plainPassword = 'mySecretPassword';
            await usersService.createUser({
                email: 'secure@example.com',
                password: plainPassword,
                name: 'Secure User',
            });

            const dbUser = await db
                .selectFrom('users')
                .select('password_hash')
                .where('email', '=', 'secure@example.com')
                .executeTakeFirst();

            expect(dbUser?.password_hash).not.toBe(plainPassword);
            expect(dbUser?.password_hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
        });
    });

    // Local login behavior (credential verification, disabled/SSO rejection,
    // enumeration hardening, session creation) is covered on the provider path:
    // see tests/modules/auth/local-provider.test.ts and authentication-service.test.ts,
    // plus audit coverage in tests/modules/audit-log/record-integration.test.ts.
    // usersService.login was removed as a redundant parallel implementation.

    describe('validateSession', () => {
        it('should return user profile for valid session', async () => {
            const user = await usersService.createUser({
                email: 'validate@example.com',
                password: 'password123',
                name: 'Validate User',
            });

            const session = await createTestSession(user.id);

            const profile = await usersService.validateSession(session.token);

            expect(profile).not.toBeNull();
            expect(profile?.id).toBe(user.id);
            expect(profile?.email).toBe('validate@example.com');
        });

        it('should return null for invalid token', async () => {
            const profile = await usersService.validateSession('invalid_token_123');

            expect(profile).toBeNull();
        });

        it('should return null for expired session', async () => {
            const user = await usersService.createUser({
                email: 'expired@example.com',
                password: 'password123',
                name: 'Expired User',
            });

            const session = await createTestSession(user.id);

            // Manually expire the session
            await db
                .updateTable('sessions')
                .set({ expires_at: new Date(Date.now() - 1000) })
                .where('token', '=', session.token)
                .execute();

            const profile = await usersService.validateSession(session.token);

            expect(profile).toBeNull();
        });

        it('should return null for disabled user', async () => {
            const user = await usersService.createUser({
                email: 'disabled@example.com',
                password: 'password123',
                name: 'Disabled User',
            });

            const session = await createTestSession(user.id);

            // Disable the user
            await db
                .updateTable('users')
                .set({ disabled: true })
                .where('id', '=', user.id)
                .execute();

            const profile = await usersService.validateSession(session.token);

            expect(profile).toBeNull();
        });

        it('should delete expired session on validation', async () => {
            const user = await usersService.createUser({
                email: 'cleanup@example.com',
                password: 'password123',
                name: 'Cleanup User',
            });

            const session = await createTestSession(user.id);

            // Manually expire the session
            await db
                .updateTable('sessions')
                .set({ expires_at: new Date(Date.now() - 1000) })
                .where('token', '=', session.token)
                .execute();

            await usersService.validateSession(session.token);

            // Session should be deleted
            const dbSession = await db
                .selectFrom('sessions')
                .select('id')
                .where('token', '=', session.token)
                .executeTakeFirst();

            expect(dbSession).toBeUndefined();
        });
    });

    describe('logout', () => {
        it('should delete the session', async () => {
            const user = await usersService.createUser({
                email: 'logout@example.com',
                password: 'password123',
                name: 'Logout User',
            });

            const session = await createTestSession(user.id);

            await usersService.logout(session.token);

            const profile = await usersService.validateSession(session.token);
            expect(profile).toBeNull();
        });

        it('should not throw error for non-existent token', async () => {
            await expect(
                usersService.logout('nonexistent_token')
            ).resolves.not.toThrow();
        });
    });

    describe('getUserById', () => {
        it('should return user for valid ID', async () => {
            const created = await usersService.createUser({
                email: 'getbyid@example.com',
                password: 'password123',
                name: 'Get By ID User',
            });

            const user = await usersService.getUserById(created.id);

            expect(user).not.toBeNull();
            expect(user?.id).toBe(created.id);
            expect(user?.email).toBe('getbyid@example.com');
        });

        it('should return null for non-existent user', async () => {
            const user = await usersService.getUserById('00000000-0000-0000-0000-000000000000');

            expect(user).toBeNull();
        });
    });

    describe('updateUser', () => {
        it('should update user name', async () => {
            const user = await usersService.createUser({
                email: 'update@example.com',
                password: 'password123',
                name: 'Original Name',
            });

            const updated = await usersService.updateUser(user.id, {
                name: 'New Name',
            });

            expect(updated.name).toBe('New Name');
        });

        it('should update user email', async () => {
            const user = await usersService.createUser({
                email: 'old@example.com',
                password: 'password123',
                name: 'Test User',
            });

            const updated = await usersService.updateUser(user.id, {
                email: 'new@example.com',
            });

            expect(updated.email).toBe('new@example.com');
        });

        it('should throw error for duplicate email', async () => {
            await usersService.createUser({
                email: 'existing@example.com',
                password: 'password123',
                name: 'Existing User',
            });

            const user = await usersService.createUser({
                email: 'changeme@example.com',
                password: 'password123',
                name: 'Change Me User',
            });

            await expect(
                usersService.updateUser(user.id, {
                    email: 'existing@example.com',
                })
            ).rejects.toThrow('Email already in use');
        });

        it('should update password with correct current password', async () => {
            const user = await usersService.createUser({
                email: 'password@example.com',
                password: 'oldPassword',
                name: 'Password User',
            });

            await usersService.updateUser(user.id, {
                currentPassword: 'oldPassword',
                newPassword: 'newPassword',
            });

            // Should be able to authenticate with the new password
            const result = await authenticationService.authenticateWithProvider('local', {
                email: 'password@example.com',
                password: 'newPassword',
            });

            expect(result.session.token).toBeDefined();
        });

        it('should throw error when changing password without current password', async () => {
            const user = await usersService.createUser({
                email: 'nopass@example.com',
                password: 'password123',
                name: 'No Pass User',
            });

            await expect(
                usersService.updateUser(user.id, {
                    newPassword: 'newPassword',
                })
            ).rejects.toThrow('Current password is required to set a new password');
        });

        it('should throw error for incorrect current password', async () => {
            const user = await usersService.createUser({
                email: 'wrongcurrent@example.com',
                password: 'correctPassword',
                name: 'Wrong Current User',
            });

            await expect(
                usersService.updateUser(user.id, {
                    currentPassword: 'wrongPassword',
                    newPassword: 'newPassword',
                })
            ).rejects.toThrow('Current password is incorrect');
        });

        it('should throw error for non-existent user', async () => {
            await expect(
                usersService.updateUser('00000000-0000-0000-0000-000000000000', {
                    name: 'Test',
                })
            ).rejects.toThrow('User not found');
        });
    });

    describe('deleteUser', () => {
        it('should delete user with correct password', async () => {
            const user = await usersService.createUser({
                email: 'delete@example.com',
                password: 'password123',
                name: 'Delete User',
            });

            await usersService.deleteUser(user.id, 'password123');

            const deleted = await usersService.getUserById(user.id);
            expect(deleted).toBeNull();
        });

        it('should throw error for incorrect password', async () => {
            const user = await usersService.createUser({
                email: 'nodelete@example.com',
                password: 'correctPassword',
                name: 'No Delete User',
            });

            await expect(
                usersService.deleteUser(user.id, 'wrongPassword')
            ).rejects.toThrow('Invalid password');
        });

        it('should throw error for non-existent user', async () => {
            await expect(
                usersService.deleteUser('00000000-0000-0000-0000-000000000000', 'password')
            ).rejects.toThrow('User not found');
        });

        it('should cascade delete sessions', async () => {
            const user = await usersService.createUser({
                email: 'cascade@example.com',
                password: 'password123',
                name: 'Cascade User',
            });

            const session = await createTestSession(user.id);

            await usersService.deleteUser(user.id, 'password123');

            // Session should be deleted via cascade
            const dbSession = await db
                .selectFrom('sessions')
                .select('id')
                .where('id', '=', session.id)
                .executeTakeFirst();

            expect(dbSession).toBeUndefined();
        });
    });

    describe('cleanupExpiredSessions', () => {
        it('should delete expired sessions', async () => {
            const user = await usersService.createUser({
                email: 'cleanup@example.com',
                password: 'password123',
                name: 'Cleanup User',
            });

            const session = await createTestSession(user.id);

            // Expire the session
            await db
                .updateTable('sessions')
                .set({ expires_at: new Date(Date.now() - 1000) })
                .where('token', '=', session.token)
                .execute();

            const deleted = await usersService.cleanupExpiredSessions();

            expect(deleted).toBe(1);
        });

        it('should not delete valid sessions', async () => {
            const user = await usersService.createUser({
                email: 'valid@example.com',
                password: 'password123',
                name: 'Valid User',
            });

            await createTestSession(user.id);

            const deleted = await usersService.cleanupExpiredSessions();

            expect(deleted).toBe(0);
        });

        it('should return 0 when no sessions exist', async () => {
            const deleted = await usersService.cleanupExpiredSessions();

            expect(deleted).toBe(0);
        });
    });
});
