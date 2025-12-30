/**
 * Authentication Service
 *
 * Orchestrates multi-provider authentication, handling:
 * - Provider selection and delegation
 * - User provisioning (auto-create on first login)
 * - Identity linking (associate external IDs with users)
 * - Session creation
 * - OIDC state management
 */

import crypto from 'crypto';
import { db } from '../../database/connection.js';
import { CacheManager } from '../../utils/cache.js';
import type { UserProfile, SessionInfo } from '../users/service.js';
import { settingsService } from '../settings/service.js';
import {
  providerRegistry,
  type AuthProvider,
  type AuthenticationResult,
  type UserIdentity,
} from './providers/index.js';

const OIDC_STATE_TTL = 300; // 5 minutes

export interface AuthenticateResult {
  user: UserProfile;
  session: SessionInfo;
  isNewUser: boolean;
}

export interface OidcStateData {
  providerId: string;
  nonce: string;
  redirectUri: string | null;
  codeVerifier?: string;
}

export class AuthenticationService {
  /**
   * Authenticate a user with a specific provider
   *
   * @param providerSlug - Provider slug (e.g., 'local', 'authentik')
   * @param credentials - Provider-specific credentials
   * @returns User profile and session
   */
  async authenticateWithProvider(
    providerSlug: string,
    credentials: unknown
  ): Promise<AuthenticateResult> {
    // Get provider
    const provider = await providerRegistry.getProvider(providerSlug);
    if (!provider) {
      throw new Error(`Authentication provider '${providerSlug}' not found or disabled`);
    }

    // Authenticate with provider
    const result = await provider.authenticate(credentials);

    if (!result.success) {
      throw new Error(result.error || 'Authentication failed');
    }

    // Find or create user
    const { user, isNewUser } = await this.findOrCreateUser(
      provider,
      result
    );

    // Create session
    const session = await this.createSession(user.id);

    // Update last login for identity
    await this.updateIdentityLastLogin(provider.config.id, result.providerUserId!);

    return { user, session, isNewUser };
  }

  /**
   * Generate OIDC authorization URL
   *
   * @param providerSlug - Provider slug
   * @param redirectUri - Where to redirect after auth
   * @returns Authorization URL and state
   */
  async getOidcAuthorizationUrl(
    providerSlug: string,
    redirectUri: string
  ): Promise<{ url: string; state: string }> {
    const provider = await providerRegistry.getProvider(providerSlug);
    if (!provider) {
      throw new Error(`Authentication provider '${providerSlug}' not found or disabled`);
    }

    if (!provider.supportsRedirect() || !provider.getAuthorizationUrl) {
      throw new Error('This provider does not support redirect-based authentication');
    }

    const result = await provider.getAuthorizationUrl(redirectUri);

    // Store state in database for verification (including codeVerifier for PKCE)
    await db
      .insertInto('oidc_states')
      .values({
        state: result.state,
        nonce: result.nonce,
        provider_id: provider.config.id,
        redirect_uri: redirectUri,
        code_verifier: result.codeVerifier, // PKCE: Store for token exchange
      })
      .execute();

    // Also cache in Redis for faster lookup
    const stateData: OidcStateData = {
      providerId: provider.config.id,
      nonce: result.nonce,
      redirectUri,
      codeVerifier: result.codeVerifier, // PKCE: Store for token exchange
    };
    await CacheManager.set(`oidc:state:${result.state}`, stateData, OIDC_STATE_TTL);

    return {
      url: result.url,
      state: result.state,
    };
  }

  /**
   * Handle OIDC callback
   *
   * @param code - Authorization code
   * @param state - State parameter for CSRF validation
   * @returns User profile and session
   */
  async handleOidcCallback(
    code: string,
    state: string
  ): Promise<AuthenticateResult> {
    // Look up state from cache first, then database
    let stateData = await CacheManager.get<OidcStateData>(`oidc:state:${state}`);

    if (!stateData) {
      // Try database
      const dbState = await db
        .selectFrom('oidc_states')
        .selectAll()
        .where('state', '=', state)
        .executeTakeFirst();

      if (!dbState) {
        throw new Error('Invalid or expired authentication state. Please try again.');
      }

      // Check if state is too old (5 minutes)
      const stateAge = Date.now() - new Date(dbState.created_at).getTime();
      if (stateAge > OIDC_STATE_TTL * 1000) {
        // Clean up old state
        await db.deleteFrom('oidc_states').where('state', '=', state).execute();
        throw new Error('Authentication state expired. Please try again.');
      }

      stateData = {
        providerId: dbState.provider_id,
        nonce: dbState.nonce,
        redirectUri: dbState.redirect_uri,
        codeVerifier: dbState.code_verifier, // PKCE: Retrieve for token exchange
      };
    }

    // Get provider
    const provider = await providerRegistry.getProviderById(stateData.providerId);
    if (!provider) {
      throw new Error('Authentication provider not found or disabled');
    }

    if (!provider.handleCallback) {
      throw new Error('Provider does not support callback handling');
    }

    // Validate required PKCE data
    if (!stateData.codeVerifier) {
      throw new Error('Missing PKCE code verifier. Authentication state is corrupted.');
    }
    if (!stateData.redirectUri) {
      throw new Error('Missing redirect URI. Authentication state is corrupted.');
    }

    // Handle callback with provider (including PKCE data)
    const result = await provider.handleCallback(
      {
        code,
        state,
        codeVerifier: stateData.codeVerifier,
        redirectUri: stateData.redirectUri,
      },
      stateData.nonce
    );

    // Clean up state
    await db.deleteFrom('oidc_states').where('state', '=', state).execute();
    await CacheManager.delete(`oidc:state:${state}`);

    if (!result.success) {
      throw new Error(result.error || 'Authentication failed');
    }

    // Find or create user
    const { user, isNewUser } = await this.findOrCreateUser(provider, result);

    // Create session
    const session = await this.createSession(user.id);

    // Update last login for identity
    await this.updateIdentityLastLogin(provider.config.id, result.providerUserId!);

    return { user, session, isNewUser };
  }

  /**
   * Find existing user or create new one based on auth result
   */
  private async findOrCreateUser(
    provider: AuthProvider,
    result: AuthenticationResult
  ): Promise<{ user: UserProfile; isNewUser: boolean }> {
    const providerId = provider.config.id;
    const providerUserId = result.providerUserId!;
    const email = result.email!.toLowerCase().trim();
    const name = result.name || email.split('@')[0];

    // First, check if this external identity already exists
    const existingIdentity = await db
      .selectFrom('user_identities')
      .innerJoin('users', 'users.id', 'user_identities.user_id')
      .select([
        'users.id',
        'users.email',
        'users.name',
        'users.is_admin',
        'users.disabled',
        'users.created_at',
        'users.last_login',
      ])
      .where('user_identities.provider_id', '=', providerId)
      .where('user_identities.provider_user_id', '=', providerUserId)
      .executeTakeFirst();

    if (existingIdentity) {
      // Check if user is disabled
      if (existingIdentity.disabled) {
        throw new Error('This account has been disabled');
      }

      // Update user's last login
      await db
        .updateTable('users')
        .set({ last_login: new Date() })
        .where('id', '=', existingIdentity.id)
        .execute();

      return {
        user: {
          id: existingIdentity.id,
          email: existingIdentity.email,
          name: existingIdentity.name,
          is_admin: existingIdentity.is_admin,
          disabled: existingIdentity.disabled,
          createdAt: new Date(existingIdentity.created_at),
          lastLogin: existingIdentity.last_login ? new Date(existingIdentity.last_login) : null,
        },
        isNewUser: false,
      };
    }

    // Check if a user with this email already exists (for account linking)
    const existingUser = await db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'is_admin', 'disabled', 'created_at', 'last_login'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (existingUser) {
      // Check if user is disabled
      if (existingUser.disabled) {
        throw new Error('This account has been disabled');
      }

      // Link this external identity to the existing user
      await db
        .insertInto('user_identities')
        .values({
          user_id: existingUser.id,
          provider_id: providerId,
          provider_user_id: providerUserId,
          metadata: result.metadata || {},
        })
        .execute();

      // Update user's last login
      await db
        .updateTable('users')
        .set({ last_login: new Date() })
        .where('id', '=', existingUser.id)
        .execute();

      return {
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          is_admin: existingUser.is_admin,
          disabled: existingUser.disabled,
          createdAt: new Date(existingUser.created_at),
          lastLogin: existingUser.last_login ? new Date(existingUser.last_login) : null,
        },
        isNewUser: false,
      };
    }

    // Check if auto-register is allowed for this provider
    const providerConfig = provider.config.config as { allowAutoRegister?: boolean };
    if (providerConfig.allowAutoRegister === false) {
      throw new Error(
        'Automatic account creation is disabled for this authentication provider. Please contact your administrator.'
      );
    }

    // Check if global signup is enabled
    const signupEnabled = await settingsService.isSignupEnabled();
    if (!signupEnabled) {
      throw new Error(
        'User registration is currently disabled. Please contact your administrator.'
      );
    }

    // Create new user
    const newUser = await db
      .insertInto('users')
      .values({
        email,
        name,
        password_hash: null, // External auth users don't have local passwords
        last_login: new Date(),
      })
      .returning(['id', 'email', 'name', 'is_admin', 'disabled', 'created_at', 'last_login'])
      .executeTakeFirstOrThrow();

    // Create identity link
    await db
      .insertInto('user_identities')
      .values({
        user_id: newUser.id,
        provider_id: providerId,
        provider_user_id: providerUserId,
        metadata: result.metadata || {},
      })
      .execute();

    return {
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        is_admin: newUser.is_admin,
        disabled: newUser.disabled,
        createdAt: new Date(newUser.created_at),
        lastLogin: newUser.last_login ? new Date(newUser.last_login) : null,
      },
      isNewUser: true,
    };
  }

  /**
   * Create a session for the user
   */
  private async createSession(userId: string): Promise<SessionInfo> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    const session = await db
      .insertInto('sessions')
      .values({
        user_id: userId,
        token,
        expires_at: expiresAt,
      })
      .returning(['id', 'token', 'expires_at'])
      .executeTakeFirstOrThrow();

    return {
      sessionId: session.id,
      userId,
      token: session.token,
      expiresAt: new Date(session.expires_at),
    };
  }

  /**
   * Update last login timestamp for an identity
   */
  private async updateIdentityLastLogin(providerId: string, providerUserId: string): Promise<void> {
    await db
      .updateTable('user_identities')
      .set({ last_login_at: new Date() })
      .where('provider_id', '=', providerId)
      .where('provider_user_id', '=', providerUserId)
      .execute();
  }

  /**
   * Link a new authentication identity to an existing user
   *
   * @param userId - User to link to
   * @param providerSlug - Provider slug
   * @param credentials - Provider-specific credentials
   */
  async linkIdentity(
    userId: string,
    providerSlug: string,
    credentials: unknown
  ): Promise<UserIdentity> {
    const provider = await providerRegistry.getProvider(providerSlug);
    if (!provider) {
      throw new Error(`Authentication provider '${providerSlug}' not found or disabled`);
    }

    // Authenticate with provider to get external ID
    const result = await provider.authenticate(credentials);
    if (!result.success) {
      throw new Error(result.error || 'Authentication failed');
    }

    // Check if this external identity is already linked to another user
    const existingIdentity = await db
      .selectFrom('user_identities')
      .select(['user_id'])
      .where('provider_id', '=', provider.config.id)
      .where('provider_user_id', '=', result.providerUserId!)
      .executeTakeFirst();

    if (existingIdentity) {
      if (existingIdentity.user_id === userId) {
        throw new Error('This authentication method is already linked to your account');
      }
      throw new Error('This authentication method is already linked to another account');
    }

    // Create identity link
    const identity = await db
      .insertInto('user_identities')
      .values({
        user_id: userId,
        provider_id: provider.config.id,
        provider_user_id: result.providerUserId!,
        metadata: result.metadata || {},
      })
      .returning(['id', 'user_id', 'provider_id', 'provider_user_id', 'metadata', 'last_login_at', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();

    return {
      id: identity.id,
      userId: identity.user_id,
      providerId: identity.provider_id,
      providerUserId: identity.provider_user_id,
      metadata: identity.metadata,
      lastLoginAt: identity.last_login_at ? new Date(identity.last_login_at) : null,
      createdAt: new Date(identity.created_at),
      updatedAt: new Date(identity.updated_at),
    };
  }

  /**
   * Get all identities linked to a user
   */
  async getUserIdentities(userId: string): Promise<UserIdentity[]> {
    const identities = await db
      .selectFrom('user_identities')
      .innerJoin('auth_providers', 'auth_providers.id', 'user_identities.provider_id')
      .select([
        'user_identities.id',
        'user_identities.user_id',
        'user_identities.provider_id',
        'user_identities.provider_user_id',
        'user_identities.metadata',
        'user_identities.last_login_at',
        'user_identities.created_at',
        'user_identities.updated_at',
        'auth_providers.type',
        'auth_providers.name',
        'auth_providers.slug',
        'auth_providers.icon',
        'auth_providers.is_default',
        'auth_providers.display_order',
      ])
      .where('user_identities.user_id', '=', userId)
      .orderBy('auth_providers.display_order', 'asc')
      .execute();

    return identities.map((row) => ({
      id: row.id,
      userId: row.user_id,
      providerId: row.provider_id,
      providerUserId: row.provider_user_id,
      metadata: row.metadata,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      provider: {
        id: row.provider_id,
        type: row.type,
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        isDefault: row.is_default,
        displayOrder: row.display_order,
        supportsRedirect: row.type === 'oidc',
      },
    }));
  }

  /**
   * Unlink an identity from a user
   *
   * @param userId - User ID
   * @param identityId - Identity ID to unlink
   */
  async unlinkIdentity(userId: string, identityId: string): Promise<void> {
    // Check if user has more than one identity
    const identityCount = await db
      .selectFrom('user_identities')
      .select(db.fn.countAll().as('count'))
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (!identityCount || Number(identityCount.count) <= 1) {
      throw new Error('Cannot unlink the only authentication method. Add another method first.');
    }

    // Check if the identity belongs to this user
    const identity = await db
      .selectFrom('user_identities')
      .innerJoin('auth_providers', 'auth_providers.id', 'user_identities.provider_id')
      .select(['user_identities.id', 'auth_providers.type'])
      .where('user_identities.id', '=', identityId)
      .where('user_identities.user_id', '=', userId)
      .executeTakeFirst();

    if (!identity) {
      throw new Error('Identity not found');
    }

    // If unlinking local auth, check if user has password
    if (identity.type === 'local') {
      const user = await db
        .selectFrom('users')
        .select(['password_hash'])
        .where('id', '=', userId)
        .executeTakeFirst();

      if (user?.password_hash) {
        // Clear password hash since they're unlinking local auth
        await db
          .updateTable('users')
          .set({ password_hash: null })
          .where('id', '=', userId)
          .execute();
      }
    }

    // Delete the identity
    await db
      .deleteFrom('user_identities')
      .where('id', '=', identityId)
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Clean up expired OIDC states
   */
  async cleanupExpiredOidcStates(): Promise<number> {
    const expiredBefore = new Date(Date.now() - OIDC_STATE_TTL * 1000);

    const result = await db
      .deleteFrom('oidc_states')
      .where('created_at', '<', expiredBefore)
      .executeTakeFirst();

    return Number(result.numDeletedRows || 0);
  }
}

// Export singleton instance
export const authenticationService = new AuthenticationService();
