/**
 * Local Authentication Provider
 *
 * Handles email/password authentication using bcrypt.
 * This is a wrapper around the existing UsersService password verification.
 */

import bcrypt from 'bcrypt';
import { db } from '../../../database/connection.js';
import type {
  AuthProvider,
  AuthProviderConfig,
  AuthenticationResult,
  LocalCredentials,
} from './types.js';
import { AuthErrorCode } from './types.js';

export class LocalProvider implements AuthProvider {
  readonly type = 'local' as const;
  readonly config: AuthProviderConfig;

  constructor(config: AuthProviderConfig) {
    this.config = config;
  }

  /**
   * Authenticate with email and password
   */
  async authenticate(credentials: unknown): Promise<AuthenticationResult> {
    const { email, password } = credentials as LocalCredentials;

    if (!email || !password) {
      return {
        success: false,
        error: 'Email and password are required',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // Find user by email
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'password_hash', 'disabled'])
      .where('email', '=', email.toLowerCase().trim())
      .executeTakeFirst();

    if (!user) {
      return {
        success: false,
        error: 'Invalid email or password',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // Check if user has a password (OIDC/LDAP users may not)
    if (!user.password_hash) {
      return {
        success: false,
        error: 'Please log in using your organization SSO',
        errorCode: AuthErrorCode.SSO_REQUIRED,
      };
    }

    // Verify password before any other checks to prevent user enumeration:
    // a wrong password must always return the same generic error regardless of
    // whether the account is disabled or not.
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid email or password',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // Check if user is disabled (only after the password is confirmed correct)
    if (user.disabled) {
      return {
        success: false,
        error: 'This account has been disabled',
        errorCode: AuthErrorCode.USER_DISABLED,
      };
    }

    return {
      success: true,
      providerUserId: user.email, // For local, we use email as the provider user ID
      email: user.email,
      emailVerified: true, // Password verification implies ownership of the account
      name: user.name,
      metadata: {
        userId: user.id,
      },
    };
  }

  /**
   * Local provider does not support redirect-based auth
   */
  supportsRedirect(): boolean {
    return false;
  }

  /**
   * Configuration is always valid for local provider
   */
  validateConfig(): boolean {
    return true;
  }

  /**
   * Test connection always succeeds for local provider
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: 'Local authentication is always available',
    };
  }
}
