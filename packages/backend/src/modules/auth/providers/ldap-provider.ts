/**
 * LDAP Authentication Provider
 *
 * Handles authentication via LDAP/Active Directory servers.
 * Uses the bind authentication method:
 * 1. Bind with service account to search for user
 * 2. Bind with user's credentials to verify password
 * 3. Extract user attributes (email, name)
 */

import type {
  AuthProvider,
  AuthProviderConfig,
  AuthenticationResult,
  LdapProviderConfig,
  LdapCredentials,
} from './types.js';
import { AuthErrorCode } from './types.js';

// Dynamic import for ldapts (ESM)
let ldapts: typeof import('ldapts') | null = null;

async function getLdapts() {
  if (!ldapts) {
    ldapts = await import('ldapts');
  }
  return ldapts;
}

export class LdapProvider implements AuthProvider {
  readonly type = 'ldap' as const;
  readonly config: AuthProviderConfig;
  private ldapConfig: LdapProviderConfig;

  constructor(config: AuthProviderConfig) {
    this.config = config;
    this.ldapConfig = config.config as unknown as LdapProviderConfig;
  }

  /**
   * Get LDAP configuration
   */
  private getLdapConfig(): LdapProviderConfig {
    return this.ldapConfig;
  }

  /**
   * Escape special characters in LDAP filter values
   * Prevents LDAP injection attacks
   */
  private escapeFilterValue(value: string): string {
    return value
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00');
  }

  /**
   * Authenticate with username and password via LDAP
   */
  async authenticate(credentials: unknown): Promise<AuthenticationResult> {
    const { username, password } = credentials as LdapCredentials;

    if (!username || !password) {
      return {
        success: false,
        error: 'Username and password are required',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    const ldapConfig = this.getLdapConfig();
    const { Client } = await getLdapts();

    // Create client for service account bind
    const serviceClient = new Client({
      url: ldapConfig.url,
      timeout: 5000,
      connectTimeout: 5000,
      tlsOptions: ldapConfig.tlsOptions,
    });

    try {
      // Step 1: Bind with service account
      await serviceClient.bind(ldapConfig.bindDn, ldapConfig.bindPassword);

      // Step 2: Search for user
      const escapedUsername = this.escapeFilterValue(username);
      const searchFilter = ldapConfig.searchFilter.replace(
        /\{\{username\}\}/g,
        escapedUsername
      );

      const { searchEntries } = await serviceClient.search(ldapConfig.searchBase, {
        scope: 'sub',
        filter: searchFilter,
        attributes: [
          ldapConfig.userAttributes?.email || 'mail',
          ldapConfig.userAttributes?.name || 'cn',
          'dn',
          'distinguishedName',
        ],
      });

      if (searchEntries.length === 0) {
        return {
          success: false,
          error: 'Invalid username or password',
          errorCode: AuthErrorCode.INVALID_CREDENTIALS,
        };
      }

      const userEntry = searchEntries[0];
      const userDn = (userEntry.dn || userEntry.distinguishedName) as string;

      if (!userDn) {
        return {
          success: false,
          error: 'Could not determine user DN',
          errorCode: AuthErrorCode.PROVIDER_ERROR,
        };
      }

      // Step 3: Bind with user credentials to verify password
      const userClient = new Client({
        url: ldapConfig.url,
        timeout: 5000,
        connectTimeout: 5000,
        tlsOptions: ldapConfig.tlsOptions,
      });

      try {
        await userClient.bind(userDn, password);
      } catch (bindError) {
        // Invalid password
        return {
          success: false,
          error: 'Invalid username or password',
          errorCode: AuthErrorCode.INVALID_CREDENTIALS,
        };
      } finally {
        await userClient.unbind().catch(() => {});
      }

      // Step 4: Extract user attributes
      const emailAttr = ldapConfig.userAttributes?.email || 'mail';
      const nameAttr = ldapConfig.userAttributes?.name || 'cn';

      const email = this.extractAttribute(userEntry, emailAttr);
      const name = this.extractAttribute(userEntry, nameAttr);

      if (!email) {
        return {
          success: false,
          error: 'User account does not have an email address configured',
          errorCode: AuthErrorCode.MISSING_EMAIL,
        };
      }

      return {
        success: true,
        providerUserId: userDn, // Use DN as unique identifier
        email: email.toLowerCase().trim(),
        name: name || username,
        metadata: {
          dn: userDn,
          username,
          attributes: {
            email,
            name,
          },
        },
      };
    } catch (error) {
      console.error('LDAP authentication error:', error);

      // Check for specific LDAP errors
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (
        errorMessage.includes('connect') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('timeout')
      ) {
        return {
          success: false,
          error: 'Directory service is unavailable',
          errorCode: AuthErrorCode.PROVIDER_UNAVAILABLE,
        };
      }

      if (
        errorMessage.includes('Invalid credentials') ||
        errorMessage.includes('49')
      ) {
        return {
          success: false,
          error: 'Invalid service account credentials. Please contact your administrator.',
          errorCode: AuthErrorCode.PROVIDER_ERROR,
        };
      }

      return {
        success: false,
        error: `LDAP error: ${errorMessage}`,
        errorCode: AuthErrorCode.PROVIDER_ERROR,
      };
    } finally {
      await serviceClient.unbind().catch(() => {});
    }
  }

  /**
   * Extract attribute value from LDAP entry (handles arrays)
   */
  private extractAttribute(entry: Record<string, unknown>, attr: string): string | null {
    const value = entry[attr];
    if (Array.isArray(value)) {
      return value[0]?.toString() || null;
    }
    return value?.toString() || null;
  }

  /**
   * LDAP does not support redirect-based auth
   */
  supportsRedirect(): boolean {
    return false;
  }

  /**
   * Validate LDAP configuration
   */
  validateConfig(): boolean {
    const config = this.getLdapConfig();
    return !!(
      config.url &&
      config.bindDn &&
      config.bindPassword &&
      config.searchBase &&
      config.searchFilter
    );
  }

  /**
   * Test LDAP connection by attempting service account bind
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const ldapConfig = this.getLdapConfig();

    if (!this.validateConfig()) {
      return {
        success: false,
        message:
          'Invalid configuration: url, bindDn, bindPassword, searchBase, and searchFilter are required',
      };
    }

    const { Client } = await getLdapts();
    const client = new Client({
      url: ldapConfig.url,
      timeout: 5000,
      connectTimeout: 5000,
      tlsOptions: ldapConfig.tlsOptions,
    });

    try {
      await client.bind(ldapConfig.bindDn, ldapConfig.bindPassword);
      await client.unbind();

      return {
        success: true,
        message: `Successfully connected to ${ldapConfig.url}`,
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
