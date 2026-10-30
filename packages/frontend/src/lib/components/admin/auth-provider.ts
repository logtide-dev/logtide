import type { AuthProviderConfig } from '$lib/api/admin-auth';

/** Issuer URL (OIDC) or server URL (LDAP); null for providers without one. */
export function providerEndpoint(p: AuthProviderConfig): { label: string; value: string } | null {
  const cfg = p.config as { issuerUrl?: unknown; url?: unknown };
  if (p.type === 'oidc' && typeof cfg.issuerUrl === 'string' && cfg.issuerUrl) {
    return { label: 'Issuer URL', value: cfg.issuerUrl };
  }
  if (p.type === 'ldap' && typeof cfg.url === 'string' && cfg.url) {
    return { label: 'Server URL', value: cfg.url };
  }
  return null;
}

/**
 * Redirect URI the IdP must allow. The configured one wins; otherwise it is the
 * backend callback derived from the API base. `apiBase` may be relative.
 */
export function providerRedirectUri(p: AuthProviderConfig, apiBase: string, origin: string): string | null {
  if (p.type !== 'oidc') return null;
  const configured = (p.config as { redirectUri?: unknown }).redirectUri;
  if (typeof configured === 'string' && configured) return configured;
  const base = /^https?:\/\//.test(apiBase) ? apiBase : `${origin}${apiBase}`;
  return `${base.replace(/\/$/, '')}/auth/providers/${p.slug}/callback`;
}

export type DisableImpact = 'last-external' | 'last-any' | null;

/**
 * What disabling `target` would leave behind. 'last-external': no other
 * external provider stays enabled, so only the built-in email and password
 * sign-in remains. 'last-any': nothing at all would be enabled.
 */
export function disableImpact(providers: AuthProviderConfig[], target: AuthProviderConfig): DisableImpact {
  if (!target.enabled || target.type === 'local') return null;
  const others = providers.filter((p) => p.id !== target.id && p.enabled);
  if (others.some((p) => p.type !== 'local')) return null;
  return others.some((p) => p.type === 'local') ? 'last-external' : 'last-any';
}
