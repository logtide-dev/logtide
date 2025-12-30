/**
 * OpenID Connect (OIDC) Authentication Provider
 *
 * Handles authentication via OIDC-compliant identity providers like:
 * - Authentik
 * - Keycloak
 * - Okta
 * - Auth0
 * - Google
 * - Azure AD
 *
 * Uses the Authorization Code flow with PKCE.
 */

import crypto from 'crypto';
import type {
  AuthProvider,
  AuthProviderConfig,
  AuthenticationResult,
  OidcProviderConfig,
  OidcCallbackData,
  AuthorizationUrlResult,
} from './types.js';
import { AuthErrorCode } from './types.js';

// Dynamic import for openid-client (ESM only)
let oidcClient: typeof import('openid-client') | null = null;

async function getOidcClient() {
  if (!oidcClient) {
    oidcClient = await import('openid-client');
  }
  return oidcClient;
}

// Cache for OIDC configurations (issuer discovery)
const issuerCache: Map<string, { issuer: any; expiresAt: number }> = new Map();
const ISSUER_CACHE_TTL = 3600000; // 1 hour

export class OidcProvider implements AuthProvider {
  readonly type = 'oidc' as const;
  readonly config: AuthProviderConfig;
  private oidcConfig: OidcProviderConfig;

  constructor(config: AuthProviderConfig) {
    this.config = config;
    this.oidcConfig = config.config as unknown as OidcProviderConfig;
  }

  /**
   * Get OIDC configuration
   */
  private getOidcConfig(): OidcProviderConfig {
    return this.oidcConfig;
  }

  /**
   * Discover and cache OIDC issuer
   */
  private async discoverIssuer(): Promise<any> {
    const { issuerUrl } = this.getOidcConfig();
    const oidc = await getOidcClient();

    // Allow HTTP for development (localhost)
    const isLocalhost = issuerUrl.includes('localhost') || issuerUrl.includes('127.0.0.1');

    // Check cache
    const cached = issuerCache.get(issuerUrl);
    if (cached && cached.expiresAt > Date.now()) {
      // Ensure allowInsecureRequests is set for localhost even on cached configs
      if (isLocalhost) {
        oidc.allowInsecureRequests(cached.issuer);
      }
      return cached.issuer;
    }

    // For localhost, we need to allow HTTP (insecure) requests
    // allowInsecureRequests is a function that modifies the config, but also used as options key
    const options = isLocalhost ? { execute: [oidc.allowInsecureRequests] } : undefined;
    console.log('[OIDC] Discovering issuer:', issuerUrl, 'allowInsecure:', isLocalhost);

    // Discover issuer metadata
    // Use ClientSecretPost for better compatibility with providers like Authentik
    const config = await oidc.discovery(
      new URL(issuerUrl),
      this.oidcConfig.clientId,
      this.oidcConfig.clientSecret,
      oidc.ClientSecretPost(),
      options
    );

    // Cache for 1 hour
    issuerCache.set(issuerUrl, {
      issuer: config,
      expiresAt: Date.now() + ISSUER_CACHE_TTL,
    });

    return config;
  }

  /**
   * Generate authorization URL for OIDC redirect flow
   */
  async getAuthorizationUrl(redirectUri: string): Promise<AuthorizationUrlResult> {
    const oidc = await getOidcClient();
    const config = await this.discoverIssuer();
    const oidcConfig = this.getOidcConfig();

    // Generate random state and nonce for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

    // Build scopes
    const scopes = oidcConfig.scopes || ['openid', 'email', 'profile'];

    // Build authorization URL
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url: url.href,
      state,
      nonce,
      codeVerifier, // PKCE: Must be stored and passed to token exchange
    };
  }

  /**
   * Handle OIDC callback after user authentication
   */
  async handleCallback(
    data: OidcCallbackData,
    expectedNonce: string
  ): Promise<AuthenticationResult> {
    try {
      const oidc = await getOidcClient();
      const config = await this.discoverIssuer();
      const oidcConfig = this.getOidcConfig();

      // Build the callback URL with the authorization code
      const callbackUrl = new URL(data.redirectUri);
      callbackUrl.searchParams.set('code', data.code);
      callbackUrl.searchParams.set('state', data.state);

      // Exchange code for tokens with PKCE code_verifier
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        expectedNonce,
        expectedState: data.state,
        pkceCodeVerifier: data.codeVerifier, // PKCE: Required for token exchange
      });

      // Get claims from ID token
      const claims = tokens.claims();

      if (!claims) {
        return {
          success: false,
          error: 'Failed to get user claims from identity provider',
          errorCode: AuthErrorCode.PROVIDER_ERROR,
        };
      }

      // Extract user info
      const emailClaim = oidcConfig.emailClaim || 'email';
      const nameClaim = oidcConfig.nameClaim || 'name';

      const email = claims[emailClaim] as string | undefined;
      const name = (claims[nameClaim] as string) || (claims.preferred_username as string) || email?.split('@')[0];
      const sub = claims.sub as string;

      if (!email) {
        return {
          success: false,
          error: 'Identity provider did not return an email address. Please ensure your account has a verified email.',
          errorCode: AuthErrorCode.MISSING_EMAIL,
        };
      }

      // Check email verification (if available)
      if (claims.email_verified === false) {
        return {
          success: false,
          error: 'Please verify your email address with your identity provider',
          errorCode: AuthErrorCode.EMAIL_NOT_VERIFIED,
        };
      }

      return {
        success: true,
        providerUserId: sub, // Use OIDC 'sub' claim as unique identifier
        email: email.toLowerCase().trim(),
        name: name || 'Unknown',
        metadata: {
          sub,
          claims: {
            preferred_username: claims.preferred_username,
            groups: claims.groups,
            roles: claims.roles,
            picture: claims.picture,
          },
        },
      };
    } catch (error) {
      console.error('OIDC callback error:', error);

      const errorMessage =
        error instanceof Error ? error.message : 'Authentication failed';

      return {
        success: false,
        error: `SSO authentication failed: ${errorMessage}`,
        errorCode: AuthErrorCode.PROVIDER_ERROR,
      };
    }
  }

  /**
   * OIDC does not use direct authentication (uses redirect flow)
   */
  async authenticate(_credentials: unknown): Promise<AuthenticationResult> {
    return {
      success: false,
      error: 'OIDC provider uses redirect-based authentication. Use getAuthorizationUrl() and handleCallback().',
      errorCode: AuthErrorCode.PROVIDER_ERROR,
    };
  }

  /**
   * OIDC supports redirect-based auth
   */
  supportsRedirect(): boolean {
    return true;
  }

  /**
   * Validate OIDC configuration
   */
  validateConfig(): boolean {
    const config = this.getOidcConfig();
    return !!(config.issuerUrl && config.clientId && config.clientSecret);
  }

  /**
   * Test OIDC connection by attempting discovery
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const config = this.getOidcConfig();

      if (!this.validateConfig()) {
        return {
          success: false,
          message: 'Invalid configuration: issuerUrl, clientId, and clientSecret are required',
        };
      }

      // Clear cache to force fresh discovery
      issuerCache.delete(config.issuerUrl);

      // Attempt discovery
      await this.discoverIssuer();

      return {
        success: true,
        message: `Successfully connected to ${config.issuerUrl}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to connect: ${errorMessage}`,
      };
    }
  }
}
