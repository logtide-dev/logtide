/**
 * Types and interfaces for authentication providers
 *
 * This module defines the core abstractions for the multi-provider authentication system.
 * Providers (Local, OIDC, LDAP) implement these interfaces to provide consistent auth flows.
 */

import type { AuthProviderType } from '../../../database/types.js';

// Re-export for convenience
export { AuthProviderType };

/**
 * Configuration for an authentication provider as stored in the database
 */
export interface AuthProviderConfig {
  id: string;
  type: AuthProviderType;
  name: string;
  slug: string;
  enabled: boolean;
  isDefault: boolean;
  displayOrder: number;
  icon: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OIDC provider-specific configuration
 */
export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string; // Manual redirect URI (if not set, auto-generated from request)
  scopes?: string[]; // Default: ['openid', 'email', 'profile']
  allowAutoRegister?: boolean; // Allow new users to be created on first login
  emailClaim?: string; // Claim to use for email (default: 'email')
  nameClaim?: string; // Claim to use for name (default: 'name')
}

/**
 * LDAP provider-specific configuration
 */
export interface LdapProviderConfig {
  url: string; // ldap://host:389 or ldaps://host:636
  bindDn: string; // Service account DN for searching
  bindPassword: string; // Service account password
  searchBase: string; // Base DN for user search (e.g., "ou=users,dc=example,dc=com")
  searchFilter: string; // Filter template with {{username}} placeholder
  tlsOptions?: {
    rejectUnauthorized?: boolean;
  };
  userAttributes?: {
    email?: string; // Attribute for email (default: 'mail')
    name?: string; // Attribute for display name (default: 'cn')
  };
  allowAutoRegister?: boolean; // Allow new users to be created on first login
}

/**
 * Result of an authentication attempt
 */
export interface AuthenticationResult {
  success: boolean;
  providerUserId?: string; // External user identifier (OIDC sub, LDAP DN, email for local)
  email?: string;
  name?: string;
  metadata?: Record<string, unknown>; // Provider-specific data (claims, attributes)
  error?: string;
  errorCode?: AuthErrorCode;
}

/**
 * Error codes for authentication failures
 */
export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  USER_DISABLED = 'USER_DISABLED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  INVALID_STATE = 'INVALID_STATE',
  MISSING_EMAIL = 'MISSING_EMAIL',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  AUTO_REGISTER_DISABLED = 'AUTO_REGISTER_DISABLED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
}

/**
 * Credentials for local (email/password) authentication
 */
export interface LocalCredentials {
  email: string;
  password: string;
}

/**
 * Credentials for LDAP authentication
 */
export interface LdapCredentials {
  username: string;
  password: string;
}

/**
 * OIDC callback data
 */
export interface OidcCallbackData {
  code: string;
  state: string;
  codeVerifier: string; // PKCE code verifier from stored state
  redirectUri: string; // Original redirect URI for token exchange
}

/**
 * Authorization URL result for OIDC
 */
export interface AuthorizationUrlResult {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string; // PKCE code verifier - MUST be stored and passed to token exchange
}

/**
 * Base interface for all authentication providers
 *
 * Providers handle the authentication logic for their specific protocol.
 * The authentication service orchestrates providers and handles user management.
 */
export interface AuthProvider {
  /**
   * Provider type identifier
   */
  readonly type: AuthProviderType;

  /**
   * Provider configuration
   */
  readonly config: AuthProviderConfig;

  /**
   * Authenticate a user with provider-specific credentials
   *
   * For Local: { email, password }
   * For LDAP: { username, password }
   * For OIDC: Not used (uses callback flow)
   */
  authenticate(credentials: unknown): Promise<AuthenticationResult>;

  /**
   * Check if this provider supports redirect-based auth (OIDC)
   */
  supportsRedirect(): boolean;

  /**
   * Get authorization URL for redirect-based flows (OIDC only)
   *
   * @param redirectUri - Where to redirect after authentication
   * @returns URL to redirect the user to, plus state/nonce for validation
   */
  getAuthorizationUrl?(redirectUri: string): Promise<AuthorizationUrlResult>;

  /**
   * Handle callback from redirect-based flows (OIDC only)
   *
   * @param data - Code and state from callback
   * @param expectedNonce - Nonce to validate (from state storage)
   * @returns Authentication result with user info
   */
  handleCallback?(
    data: OidcCallbackData,
    expectedNonce: string
  ): Promise<AuthenticationResult>;

  /**
   * Validate the provider's configuration
   *
   * @returns true if configuration is valid
   */
  validateConfig(): boolean;

  /**
   * Test the provider's connection (for admin UI)
   *
   * For LDAP: Test bind
   * For OIDC: Test discovery
   * For Local: Always succeeds
   */
  testConnection?(): Promise<{ success: boolean; message: string }>;
}

/**
 * Public provider info (safe to expose to frontend)
 */
export interface PublicAuthProvider {
  id: string;
  type: AuthProviderType;
  name: string;
  slug: string;
  icon: string | null;
  isDefault: boolean;
  displayOrder: number;
  supportsRedirect: boolean; // true for OIDC, false for Local/LDAP
}

/**
 * User identity linked to a provider
 */
export interface UserIdentity {
  id: string;
  userId: string;
  providerId: string;
  providerUserId: string;
  metadata: Record<string, unknown> | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined fields
  provider?: PublicAuthProvider;
}
