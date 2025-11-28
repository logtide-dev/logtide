import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../database/index.js';
import { UsersService } from '../../../modules/users/service.js';

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

    describe('login', () => {
        it('should return session info for valid credentials', async () => {
            await usersService.createUser({
                email: 'login@example.com',
                password: 'password123',
                name: 'Login User',
            });

            const session = await usersService.login({
                email: 'login@example.com',
                password: 'password123',
            });

            expect(session.sessionId).toBeDefined();
            expect(session.userId).toBeDefined();
            expect(session.token).toBeDefined();
            expect(session.token).toHaveLength(64);
            expect(session.expiresAt).toBeInstanceOf(Date);
            expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });

        it('should throw error for non-existent user', async () => {
            await expect(
                usersService.login({
                    email: 'nonexistent@example.com',
                    password: 'password123',
                })
            ).rejects.toThrow('Invalid email or password');
        });

        it('should throw error for wrong password', async () => {
            await usersService.createUser({
                email: 'wrongpass@example.com',
                password: 'correctPassword',
                name: 'Test User',
            });

            await expect(
                usersService.login({
                    email: 'wrongpass@example.com',
                    password: 'wrongPassword',
                })
            ).rejects.toThrow('Invalid email or password');
        });

        it('should update last_login timestamp', async () => {
            const user = await usersService.createUser({
                email: 'lastlogin@example.com',
                password: 'password123',
                name: 'Last Login User',
            });

            expect(user.lastLogin).toBeNull();

            await usersService.login({
                email: 'lastlogin@example.com',
                password: 'password123',
            });

            const updatedUser = await usersService.getUserById(user.id);
            expect(updatedUser?.lastLogin).not.toBeNull();
        });

        it('should allow multiple concurrent sessions', async () => {
            await usersService.createUser({
                email: 'multi@example.com',
                password: 'password123',
                name: 'Multi Session User',
            });

            const session1 = await usersService.login({
                email: 'multi@example.com',
                password: 'password123',
            });

            const session2 = await usersService.login({
                email: 'multi@example.com',
                password: 'password123',
            });

            expect(session1.sessionId).not.toBe(session2.sessionId);
            expect(session1.token).not.toBe(session2.token);
        });
    });

    describe('validateSession', () => {
        it('should return user profile for valid session', async () => {
            const user = await usersService.createUser({
                email: 'validate@example.com',
                password: 'password123',
                name: 'Validate User',
            });

            const session = await usersService.login({
                email: 'validate@example.com',
                password: 'password123',
            });

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
            await usersService.createUser({
                email: 'expired@example.com',
                password: 'password123',
                name: 'Expired User',
            });

            const session = await usersService.login({
                email: 'expired@example.com',
                password: 'password123',
            });

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

            const session = await usersService.login({
                email: 'disabled@example.com',
                password: 'password123',
            });

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
            await usersService.createUser({
                email: 'cleanup@example.com',
                password: 'password123',
                name: 'Cleanup User',
            });

            const session = await usersService.login({
                email: 'cleanup@example.com',
                password: 'password123',
            });

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
            await usersService.createUser({
                email: 'logout@example.com',
                password: 'password123',
                name: 'Logout User',
            });

            const session = await usersService.login({
                email: 'logout@example.com',
                password: 'password123',
            });

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

            // Should be able to login with new password
            const session = await usersService.login({
                email: 'password@example.com',
                password: 'newPassword',
            });

            expect(session.token).toBeDefined();
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

            const session = await usersService.login({
                email: 'cascade@example.com',
                password: 'password123',
            });

            await usersService.deleteUser(user.id, 'password123');

            // Session should be deleted via cascade
            const dbSession = await db
                .selectFrom('sessions')
                .select('id')
                .where('id', '=', session.sessionId)
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

            const session = await usersService.login({
                email: 'cleanup@example.com',
                password: 'password123',
            });

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
            await usersService.createUser({
                email: 'valid@example.com',
                password: 'password123',
                name: 'Valid User',
            });

            await usersService.login({
                email: 'valid@example.com',
                password: 'password123',
            });

            const deleted = await usersService.cleanupExpiredSessions();

            expect(deleted).toBe(0);
        });

        it('should return 0 when no sessions exist', async () => {
            const deleted = await usersService.cleanupExpiredSessions();

            expect(deleted).toBe(0);
        });
    });
});
