import { describe, it, expect } from 'vitest';
import type { AuthProviderConfig } from '$lib/api/admin-auth';
import { providerEndpoint, providerRedirectUri, disableImpact } from './auth-provider';

function p(over: Partial<AuthProviderConfig>): AuthProviderConfig {
  return {
    id: 'a',
    type: 'oidc',
    name: 'A',
    slug: 'a',
    enabled: true,
    isDefault: false,
    displayOrder: 0,
    icon: null,
    config: {},
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('auth provider helpers', () => {
  it('finds the endpoint by type', () => {
    expect(providerEndpoint(p({ config: { issuerUrl: 'https://i' } }))).toEqual({ label: 'Issuer URL', value: 'https://i' });
    expect(providerEndpoint(p({ type: 'ldap', config: { url: 'ldap://x' } }))).toEqual({ label: 'Server URL', value: 'ldap://x' });
    expect(providerEndpoint(p({ type: 'local' }))).toBeNull();
    expect(providerEndpoint(p({ config: {} }))).toBeNull();
  });

  it('derives the redirect URI', () => {
    expect(providerRedirectUri(p({ slug: 'okta' }), '/api/v1', 'https://l.example')).toBe('https://l.example/api/v1/auth/providers/okta/callback');
    expect(providerRedirectUri(p({ slug: 'okta' }), 'http://h:8080/api/v1', 'https://l.example')).toBe('http://h:8080/api/v1/auth/providers/okta/callback');
    expect(providerRedirectUri(p({ config: { redirectUri: 'https://x/cb' } }), '/api/v1', 'o')).toBe('https://x/cb');
    expect(providerRedirectUri(p({ type: 'ldap' }), '/api/v1', 'o')).toBeNull();
  });

  it('computes the impact of disabling', () => {
    const local = p({ id: 'l', type: 'local' });
    const a = p({ id: 'a' });
    const b = p({ id: 'b' });
    expect(disableImpact([local, a, b], a)).toBeNull();
    expect(disableImpact([local, a], a)).toBe('last-external');
    expect(disableImpact([{ ...local, enabled: false }, a], a)).toBe('last-any');
    expect(disableImpact([local, { ...a, enabled: false }], { ...a, enabled: false })).toBeNull();
    expect(disableImpact([local], local)).toBeNull();
  });
});
