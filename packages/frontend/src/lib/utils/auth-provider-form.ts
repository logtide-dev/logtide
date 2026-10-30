/**
 * Form helpers for the admin auth providers page.
 *
 * The backend never returns stored secrets: it sends a bullet placeholder
 * instead. On edit, the secret field starts empty ("leave blank to keep
 * current") and is only sent when the admin typed a new value.
 */

export interface OidcFormFields {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowAutoRegister: boolean;
}

export interface LdapFormFields {
  url: string;
  bindDn: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
  allowAutoRegister: boolean;
}

const MASK_RE = /^•+$/;

export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && MASK_RE.test(value.trim());
}

function shouldSendSecret(value: string, mode: 'create' | 'edit'): boolean {
  if (mode === 'create') return true;
  return value.trim() !== '' && !isMaskedSecret(value);
}

export function buildProviderConfig(
  type: 'oidc' | 'ldap',
  fields: { oidc: OidcFormFields; ldap: LdapFormFields },
  mode: 'create' | 'edit'
): Record<string, unknown> {
  if (type === 'oidc') {
    const f = fields.oidc;
    const config: Record<string, unknown> = {
      issuerUrl: f.issuerUrl,
      clientId: f.clientId,
      // null on edit clears a previously stored value; omitted on create
      redirectUri: f.redirectUri || (mode === 'edit' ? null : undefined),
      allowAutoRegister: f.allowAutoRegister,
    };
    if (shouldSendSecret(f.clientSecret, mode)) config.clientSecret = f.clientSecret;
    return config;
  }
  const f = fields.ldap;
  const config: Record<string, unknown> = {
    url: f.url,
    bindDn: f.bindDn,
    searchBase: f.searchBase,
    searchFilter: f.searchFilter,
    allowAutoRegister: f.allowAutoRegister,
  };
  if (shouldSendSecret(f.bindPassword, mode)) config.bindPassword = f.bindPassword;
  return config;
}
