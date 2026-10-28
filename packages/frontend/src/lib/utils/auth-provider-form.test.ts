import { describe, it, expect } from 'vitest';
import { buildProviderConfig, isMaskedSecret } from './auth-provider-form';

const oidc = {
  issuerUrl: 'https://auth.example.com',
  clientId: 'client',
  clientSecret: '',
  redirectUri: '',
  allowAutoRegister: false,
};

const ldap = {
  url: 'ldap://dc.example.com',
  bindDn: 'cn=svc',
  bindPassword: '',
  searchBase: 'dc=example',
  searchFilter: '(uid={{username}})',
  allowAutoRegister: true,
};

describe('isMaskedSecret', () => {
  it('detects the bullet placeholder', () => {
    expect(isMaskedSecret('•'.repeat(8))).toBe(true);
    expect(isMaskedSecret('secret')).toBe(false);
    expect(isMaskedSecret(undefined)).toBe(false);
  });
});

describe('buildProviderConfig', () => {
  it('omits an empty OIDC secret on edit so the stored one is kept', () => {
    const config = buildProviderConfig('oidc', { oidc, ldap }, 'edit');
    expect(config).not.toHaveProperty('clientSecret');
    expect(config.allowAutoRegister).toBe(false);
    expect(config.redirectUri).toBeNull();
  });

  it('omits a masked secret even if one slips into the field', () => {
    const config = buildProviderConfig(
      'oidc',
      { oidc: { ...oidc, clientSecret: '•'.repeat(8) }, ldap },
      'edit'
    );
    expect(config).not.toHaveProperty('clientSecret');
  });

  it('sends a new OIDC secret when one is typed', () => {
    const config = buildProviderConfig('oidc', { oidc: { ...oidc, clientSecret: 'new' }, ldap }, 'edit');
    expect(config.clientSecret).toBe('new');
  });

  it('always sends the secret on create', () => {
    const config = buildProviderConfig('oidc', { oidc: { ...oidc, clientSecret: 's' }, ldap }, 'create');
    expect(config.clientSecret).toBe('s');
    expect(config.redirectUri).toBeUndefined();
  });

  it('omits an empty LDAP bind password on edit and keeps the auto-register value', () => {
    const config = buildProviderConfig('ldap', { oidc, ldap }, 'edit');
    expect(config).not.toHaveProperty('bindPassword');
    expect(config).toMatchObject({ url: ldap.url, bindDn: 'cn=svc', allowAutoRegister: true });
  });
});
