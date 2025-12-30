/**
 * Authentication Providers Module
 *
 * Exports all provider-related types, classes, and the registry.
 */

// Types
export type {
  AuthProvider,
  AuthProviderConfig,
  AuthenticationResult,
  LocalCredentials,
  LdapCredentials,
  OidcCallbackData,
  OidcProviderConfig,
  LdapProviderConfig,
  AuthorizationUrlResult,
  PublicAuthProvider,
  UserIdentity,
} from './types.js';

export { type AuthProviderType, AuthErrorCode } from './types.js';

// Providers
export { LocalProvider } from './local-provider.js';
export { OidcProvider } from './oidc-provider.js';
export { LdapProvider } from './ldap-provider.js';

// Registry
export { providerRegistry, ProviderRegistry } from './registry.js';
