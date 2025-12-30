/**
 * Bootstrap Service
 *
 * Handles automatic setup:
 * - Creates initial admin user from environment variables if no users exist
 * - Uses the selected default user from settings for auth-free mode
 * - Provides the user for all auth-free requests
 *
 * This runs at server startup
 */

import bcrypt from 'bcrypt';
import { db } from '../../database/connection.js';
import { config } from '../../config/index.js';
import { settingsService } from '../settings/service.js';
import type { UserProfile } from '../users/service.js';

// Cache for default user (avoid DB query on every request in auth-free mode)
let cachedDefaultUser: UserProfile | null = null;

// Salt rounds for bcrypt
const SALT_ROUNDS = 10;

export class BootstrapService {
  /**
   * Run initial bootstrap at server startup
   * - Creates initial admin user if no users exist and env vars are set
   */
  async runInitialBootstrap(): Promise<void> {
    await this.ensureInitialAdmin();
  }

  /**
   * Create initial admin user from environment variables if:
   * 1. No users exist in the database
   * 2. INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are set
   */
  async ensureInitialAdmin(): Promise<void> {
    // Check if env vars are configured
    const { INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_NAME } = config;

    if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) {
      // No initial admin configured, skip
      return;
    }

    // Check if any "real" users exist (with password set - excludes system@logward.internal)
    const userCount = await db
      .selectFrom('users')
      .select(db.fn.count('id').as('count'))
      .where('password_hash', '!=', '') // Exclude system user which has empty password
      .executeTakeFirst();

    const count = Number(userCount?.count || 0);

    if (count > 0) {
      console.log('[Bootstrap] Users with login credentials already exist, skipping initial admin creation.');
      return;
    }

    // Create the initial admin user
    console.log(`[Bootstrap] No users found. Creating initial admin: ${INITIAL_ADMIN_EMAIL}`);

    const passwordHash = await bcrypt.hash(INITIAL_ADMIN_PASSWORD, SALT_ROUNDS);
    const adminName = INITIAL_ADMIN_NAME || 'Admin';

    const user = await db
      .insertInto('users')
      .values({
        email: INITIAL_ADMIN_EMAIL,
        password_hash: passwordHash,
        name: adminName,
        is_admin: true,
      })
      .returning(['id', 'email', 'name', 'is_admin', 'disabled', 'created_at', 'last_login'])
      .executeTakeFirstOrThrow();

    console.log(`[Bootstrap] Initial admin created successfully: ${user.email} (ID: ${user.id})`);

    // Set this user as default user for auth-free mode
    await settingsService.set('auth.default_user_id', user.id);
    console.log('[Bootstrap] Set initial admin as default user for auth-free mode.');
  }

  /**
   * Ensure default setup exists for auth-free mode
   * Called at server startup when auth.mode = 'none'
   */
  async ensureDefaultSetup(): Promise<void> {
    const userId = await settingsService.getDefaultUserId();

    if (!userId) {
      console.log('[Bootstrap] Auth-free mode enabled but no default user selected.');
      console.log('[Bootstrap] Please select a default user in Admin > Settings.');
      return;
    }

    const user = await this.loadUserById(userId);
    if (!user) {
      console.log(`[Bootstrap] Warning: Selected default user (${userId}) not found in database.`);
      console.log('[Bootstrap] Please select a valid user in Admin > Settings.');
      return;
    }

    cachedDefaultUser = user;
    console.log(`[Bootstrap] Auth-free mode active. Default user: ${user.email}`);
  }

  /**
   * Load a user by ID from database
   */
  private async loadUserById(userId: string): Promise<UserProfile | null> {
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
   * Get the cached default user (for auth-free mode requests)
   * Returns null if not in auth-free mode or not initialized
   */
  async getDefaultUser(): Promise<UserProfile | null> {
    if (cachedDefaultUser) {
      return cachedDefaultUser;
    }

    // Try to load from database using settings
    const userId = await settingsService.getDefaultUserId();
    if (!userId) {
      return null;
    }

    const user = await this.loadUserById(userId);
    if (user) {
      cachedDefaultUser = user;
    }

    return user;
  }

  /**
   * Clear cached default user (called when settings change)
   */
  clearCache(): void {
    cachedDefaultUser = null;
  }

  /**
   * Check if bootstrap has been initialized
   */
  isInitialized(): boolean {
    return cachedDefaultUser !== null;
  }
}

// Export singleton instance
export const bootstrapService = new BootstrapService();
