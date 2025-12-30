import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../../database/connection.js';
import { CacheManager, CACHE_TTL } from '../../utils/cache.js';

const SALT_ROUNDS = 10;
const SESSION_DURATION_DAYS = 30;

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  disabled: boolean;
  createdAt: Date;
  lastLogin: Date | null;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}

export class UsersService {
  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify a password against a hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a secure random session token
   */
  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new user
   */
  async createUser(input: CreateUserInput): Promise<UserProfile> {
    // Check if user already exists
    const existingUser = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', input.email)
      .executeTakeFirst();

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash the password
    const passwordHash = await this.hashPassword(input.password);

    // Insert the user
    const user = await db
      .insertInto('users')
      .values({
        email: input.email,
        password_hash: passwordHash,
        name: input.name,
      })
      .returning(['id', 'email', 'name', 'is_admin', 'disabled', 'created_at', 'last_login'])
      .executeTakeFirstOrThrow();

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
      disabled: user.disabled,
      createdAt: new Date(user.created_at),
      lastLogin: user.last_login ? new Date(user.last_login) : null,
    };
  }

  /**
   * Authenticate a user and create a session
   */
  async login(input: LoginInput): Promise<SessionInfo> {
    // Find user by email
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'password_hash'])
      .where('email', '=', input.email)
      .executeTakeFirst();

    if (!user) {
      throw new Error('Invalid email or password');
    }

    // Check if user has a local password (external auth users may not)
    if (!user.password_hash) {
      throw new Error('Please log in using your organization SSO');
    }

    // Verify password
    const isValidPassword = await this.verifyPassword(input.password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // Update last login
    await db
      .updateTable('users')
      .set({ last_login: new Date() })
      .where('id', '=', user.id)
      .execute();

    // Create session
    const token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

    const session = await db
      .insertInto('sessions')
      .values({
        user_id: user.id,
        token,
        expires_at: expiresAt,
      })
      .returning(['id', 'token', 'expires_at'])
      .executeTakeFirstOrThrow();

    return {
      sessionId: session.id,
      userId: user.id,
      token: session.token,
      expiresAt: new Date(session.expires_at),
    };
  }

  /**
   * Validate a session token and return user info
   * Cached for performance - session validation happens on every request
   */
  async validateSession(token: string): Promise<UserProfile | null> {
    // Try cache first
    const cacheKey = CacheManager.sessionKey(token);
    const cached = await CacheManager.get<UserProfile & { expiresAt: string }>(cacheKey);

    if (cached) {
      // Check if cached session is expired
      if (new Date(cached.expiresAt) < new Date()) {
        await CacheManager.invalidateSession(token);
        await db.deleteFrom('sessions').where('token', '=', token).execute();
        return null;
      }
      // Convert date strings back to Date objects
      return {
        ...cached,
        createdAt: new Date(cached.createdAt),
        lastLogin: cached.lastLogin ? new Date(cached.lastLogin) : null,
      };
    }

    // Cache miss - query database
    const session = await db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select([
        'users.id',
        'users.email',
        'users.name',
        'users.is_admin',
        'users.disabled',
        'users.created_at',
        'users.last_login',
        'sessions.expires_at',
      ])
      .where('sessions.token', '=', token)
      .executeTakeFirst();

    if (!session) {
      return null;
    }

    // Check if session is expired
    const now = new Date();
    if (new Date(session.expires_at) < now) {
      // Delete expired session
      await db
        .deleteFrom('sessions')
        .where('token', '=', token)
        .execute();
      return null;
    }

    // Check if user is disabled
    if (session.disabled) {
      return null;
    }

    const userProfile: UserProfile = {
      id: session.id,
      email: session.email,
      name: session.name,
      is_admin: session.is_admin,
      disabled: session.disabled,
      createdAt: new Date(session.created_at),
      lastLogin: session.last_login ? new Date(session.last_login) : null,
    };

    // Cache the session with expiry info
    // Calculate TTL based on session expiry (max 30 minutes)
    const expiresAt = new Date(session.expires_at);
    const ttlMs = expiresAt.getTime() - now.getTime();
    const ttlSeconds = Math.min(Math.floor(ttlMs / 1000), CACHE_TTL.SESSION);

    if (ttlSeconds > 0) {
      await CacheManager.set(
        cacheKey,
        { ...userProfile, expiresAt: session.expires_at },
        ttlSeconds
      );
    }

    return userProfile;
  }

  /**
   * Logout (delete session)
   */
  async logout(token: string): Promise<void> {
    // Invalidate cache first
    await CacheManager.invalidateSession(token);

    await db
      .deleteFrom('sessions')
      .where('token', '=', token)
      .execute();
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<UserProfile | null> {
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'is_admin', 'disabled', 'created_at', 'last_login'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
      disabled: user.disabled,
      createdAt: new Date(user.created_at),
      lastLogin: user.last_login ? new Date(user.last_login) : null,
    };
  }

  /**
   * Update user profile
   */
  async updateUser(userId: string, input: UpdateUserInput): Promise<UserProfile> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // If changing email, check if new email already exists
    if (input.email && input.email !== user.email) {
      const existingUser = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', input.email)
        .executeTakeFirst();

      if (existingUser) {
        throw new Error('Email already in use');
      }
    }

    // If changing password, verify current password first
    if (input.newPassword) {
      if (!input.currentPassword) {
        throw new Error('Current password is required to set a new password');
      }

      const userWithPassword = await db
        .selectFrom('users')
        .select('password_hash')
        .where('id', '=', userId)
        .executeTakeFirst();

      if (!userWithPassword) {
        throw new Error('User not found');
      }

      if (!userWithPassword.password_hash) {
        throw new Error('Password cannot be changed for external auth users');
      }

      const isValidPassword = await this.verifyPassword(
        input.currentPassword,
        userWithPassword.password_hash
      );

      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }
    }

    // Build update object
    const updateData: any = {};
    if (input.name) updateData.name = input.name;
    if (input.email) updateData.email = input.email;
    if (input.newPassword) {
      updateData.password_hash = await this.hashPassword(input.newPassword);
    }

    // Update user
    const updatedUser = await db
      .updateTable('users')
      .set(updateData)
      .where('id', '=', userId)
      .returning(['id', 'email', 'name', 'is_admin', 'disabled', 'created_at', 'last_login'])
      .executeTakeFirstOrThrow();

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      is_admin: updatedUser.is_admin,
      disabled: updatedUser.disabled,
      createdAt: new Date(updatedUser.created_at),
      lastLogin: updatedUser.last_login ? new Date(updatedUser.last_login) : null,
    };
  }

  /**
   * Delete user account
   */
  async deleteUser(userId: string, password: string): Promise<void> {
    const user = await db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw new Error('User not found');
    }

    // Verify password before deletion
    if (!user.password_hash) {
      throw new Error('Account deletion requires a local password. Please contact your administrator.');
    }
    const isValidPassword = await this.verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid password');
    }

    // Delete user (sessions will cascade delete)
    await db.deleteFrom('users').where('id', '=', userId).execute();
  }

  /**
   * Delete all expired sessions (cleanup job)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await db
      .deleteFrom('sessions')
      .where('expires_at', '<', new Date())
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0);
  }
}

export const usersService = new UsersService();
