# Authentication Architecture

Logtide's authentication system is built around an `AuthProvider` interface. Every authentication
method — local email/password, OIDC, LDAP — is an implementation of this interface. The core
login path, session layer, and user-management code are unaware of *how* a user authenticated;
they only care about the resulting `userId`.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [The `AuthProvider` Interface](#the-authprovider-interface)
3. [Provider Registry](#provider-registry)
4. [Database Schema](#database-schema)
5. [Session Model](#session-model)
6. [Built-in Providers](#built-in-providers)
7. [Writing a Custom Provider](#writing-a-custom-provider)
8. [Capability Gate](#capability-gate)
9. [What Is Not Abstracted](#what-is-not-abstracted)

---

## Core Concepts

| Concept | Location | Role |
|---------|----------|------|
| `AuthProvider` interface | `src/modules/auth/providers/types.ts` | Contract every provider must satisfy |
| `ProviderRegistry` | `src/modules/auth/providers/registry.ts` | Singleton that loads/caches provider instances |
| `AuthenticationService` | `src/modules/auth/authentication-service.ts` | Orchestrates provider delegation, user provisioning, session creation |
| `auth_providers` table | `migrations/010_auth_providers.sql` | Persistent provider configuration (type, slug, JSONB config) |
| `user_identities` table | `migrations/010_auth_providers.sql` | Maps each user to one or more provider identities |

The flow for every login is:

```
HTTP route → AuthenticationService.authenticateWithProvider(slug, credentials)
                └─ ProviderRegistry.getProvider(slug)
                └─ provider.authenticate(credentials)
                └─ findOrCreateUser(provider, result)  ← user provisioning lives here
                └─ createSession(userId)               ← opaque token, provider-agnostic
```

---

## The `AuthProvider` Interface

```typescript
// src/modules/auth/providers/types.ts

export interface AuthProvider {
  /** Provider type: 'local' | 'oidc' | 'ldap' (or your custom string) */
  readonly type: AuthProviderType;

  /** Full provider configuration row from auth_providers table */
  readonly config: AuthProviderConfig;

  /**
   * Authenticate a user.
   * - Local: receives { email, password }
   * - LDAP:  receives { username, password }
   * - OIDC:  not used (uses callback flow instead)
   * - Custom: whatever shape you define
   */
  authenticate(credentials: unknown): Promise<AuthenticationResult>;

  /** True for redirect-based flows (OIDC). False for credential-based flows. */
  supportsRedirect(): boolean;

  /** OIDC only: generate authorization URL + PKCE state. */
  getAuthorizationUrl?(redirectUri: string): Promise<AuthorizationUrlResult>;

  /** OIDC only: handle provider callback and exchange code for tokens. */
  handleCallback?(
    data: OidcCallbackData,
    expectedNonce: string
  ): Promise<AuthenticationResult>;

  /** Validate that config is structurally correct (called before saving). */
  validateConfig(): boolean;

  /** Optional: test the external connection (shown in admin UI). */
  testConnection?(): Promise<{ success: boolean; message: string }>;
}
```

`AuthenticationResult` carries the information `AuthenticationService` needs to look up or create
a user:

```typescript
interface AuthenticationResult {
  success: boolean;
  providerUserId?: string;   // stable external ID (OIDC 'sub', LDAP DN, email for local)
  email?: string;
  emailVerified?: boolean;   // gates auto-linking; set to true only when provider asserts it
  name?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  errorCode?: AuthErrorCode;
}
```

---

## Provider Registry

`ProviderRegistry` is a singleton (`providerRegistry`) that:

1. Reads rows from `auth_providers` on first use (lazy init).
2. Creates provider instances via `createProvider(config)` — a factory switch on `config.type`.
3. Caches configs in Redis (5-minute TTL) and instances in memory.
4. Exposes `invalidateCache()` so the admin API can trigger a reload after config changes.

```typescript
// src/modules/auth/providers/registry.ts  (simplified)

function createProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.type) {
    case 'local': return new LocalProvider(config);
    case 'oidc':  return new OidcProvider(config);
    case 'ldap':  return new LdapProvider(config);
    default:      throw new Error(`Unknown provider type: ${config.type}`);
  }
}
```

To add a new built-in provider type, add a `case` here and ship the class alongside it. Provider
configs are stored in the database, so no code change is needed to *configure* existing types at
runtime — only to add a new type.

---

## Database Schema

```sql
-- auth_providers: one row per configured provider instance
CREATE TABLE auth_providers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         VARCHAR(50)  NOT NULL,           -- 'local' | 'oidc' | 'ldap'
  name         VARCHAR(255) NOT NULL,           -- display name
  slug         VARCHAR(255) NOT NULL UNIQUE,    -- used in API routes: /auth/providers/:slug/...
  enabled      BOOLEAN NOT NULL DEFAULT true,
  is_default   BOOLEAN NOT NULL DEFAULT false,  -- shown prominently on login page
  display_order INT NOT NULL DEFAULT 0,
  icon         VARCHAR(100),
  config       JSONB NOT NULL DEFAULT '{}',     -- provider-specific config (issuer URL, etc.)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_identities: maps a user to an external identity
-- one user can have N identities (local + OIDC + LDAP simultaneously)
CREATE TABLE user_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id      UUID NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
  provider_user_id VARCHAR(500) NOT NULL,  -- OIDC 'sub', LDAP DN, email for local
  metadata         JSONB,                  -- cached claims / attributes
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, provider_user_id)
);
```

Migration `010_auth_providers.sql` seeds a `local` row in `auth_providers` and backfills
`user_identities` for every existing user (using `email` as `provider_user_id`).

---

## Session Model

Sessions are not changed by the provider abstraction. After any successful authentication:

1. `AuthenticationService` calls `usersService.createSession(userId)`.
2. A row is inserted into `sessions` with an opaque 32-byte random token.
3. The token is returned to the client as a Bearer token.

Sessions carry only `userId` and `expiresAt`. The provider that was used to authenticate is not
stored on the session. This means:

- A user who logs in via OIDC gets exactly the same session as one who logs in locally.
- Provider-specific tokens (OIDC `access_token`, LDAP bind credentials) are **not** kept in the
  session. They are consumed only during the authentication handshake.
- Revoking a provider (disabling its row in `auth_providers`) does not automatically expire
  existing sessions. User management (disabling a user) invalidates sessions because session
  validation checks `users.disabled`.

---

## Built-in Providers

| Type | Class | Credential shape | Redirect? |
|------|-------|-----------------|-----------|
| `local` | `LocalProvider` | `{ email, password }` | No |
| `oidc` | `OidcProvider` | N/A (callback flow) | Yes |
| `ldap` | `LdapProvider` | `{ username, password }` | No |

Operators add provider instances via the admin UI (`/admin/auth/providers`) or the admin API
(`POST /api/v1/admin/auth/providers`). Multiple instances of the same type are supported (e.g.,
two separate OIDC providers for different identity platforms).

---

## Writing a Custom Provider

Below is a complete, minimal example: a **magic-link** provider that authenticates users by
verifying a short-lived token passed as a credential. It demonstrates the minimum required to
satisfy the `AuthProvider` interface.

### 1. Define the credential shape and config

```typescript
// src/modules/auth/providers/magic-link-provider.ts

import type {
  AuthProvider,
  AuthProviderConfig,
  AuthenticationResult,
} from './types.js';
import { AuthErrorCode } from './types.js';
import { CacheManager } from '../../../utils/cache.js';
import { db } from '../../../database/connection.js';

interface MagicLinkCredentials {
  token: string;   // the one-time token the user received by email
}

interface MagicLinkConfig {
  tokenTtlSeconds?: number;  // stored in auth_providers.config
}

export class MagicLinkProvider implements AuthProvider {
  readonly type = 'magic_link' as const;
  readonly config: AuthProviderConfig;

  private get providerConfig(): MagicLinkConfig {
    return this.config.config as MagicLinkConfig;
  }

  constructor(config: AuthProviderConfig) {
    this.config = config;
  }

  async authenticate(credentials: unknown): Promise<AuthenticationResult> {
    const { token } = credentials as MagicLinkCredentials;

    if (!token) {
      return {
        success: false,
        error: 'Token is required',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // Tokens are stored in Redis as: magic_link:<token> → email
    const cacheKey = `magic_link:${token}`;
    const email = await CacheManager.get<string>(cacheKey);

    if (!email) {
      return {
        success: false,
        error: 'Token is invalid or has expired',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // One-time use: delete immediately after successful validation
    await CacheManager.delete(cacheKey);

    // Look up the user (magic-link only works for existing accounts)
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'disabled'])
      .where('email', '=', email.toLowerCase().trim())
      .executeTakeFirst();

    if (!user) {
      return {
        success: false,
        error: 'No account found for this email',
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    if (user.disabled) {
      return {
        success: false,
        error: 'This account has been disabled',
        errorCode: AuthErrorCode.USER_DISABLED,
      };
    }

    return {
      success: true,
      providerUserId: user.email,  // stable external ID for this provider
      email: user.email,
      emailVerified: true,         // magic-link implies ownership of the inbox
      name: user.name,
    };
  }

  supportsRedirect(): boolean {
    return false;  // credential-based, not redirect-based
  }

  validateConfig(): boolean {
    const ttl = this.providerConfig.tokenTtlSeconds;
    if (ttl !== undefined && (typeof ttl !== 'number' || ttl < 60)) {
      return false;
    }
    return true;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Magic-link provider is always available' };
  }
}
```

### 2. Register the type in the factory

```typescript
// src/modules/auth/providers/registry.ts  — add one case

function createProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.type) {
    case 'local':       return new LocalProvider(config);
    case 'oidc':        return new OidcProvider(config);
    case 'ldap':        return new LdapProvider(config);
    case 'magic_link':  return new MagicLinkProvider(config);  // ← add this
    default:            throw new Error(`Unknown provider type: ${config.type}`);
  }
}
```

### 3. Seed a provider row (migration or admin API)

```sql
INSERT INTO auth_providers (type, name, slug, enabled, is_default, display_order, config)
VALUES (
  'magic_link',
  'Magic Link',
  'magic-link',
  true,
  false,
  10,
  '{"tokenTtlSeconds": 900}'::jsonb
);
```

Or via the admin API:

```bash
curl -X POST /api/v1/admin/auth/providers \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "magic_link",
    "name": "Magic Link",
    "slug": "magic-link",
    "enabled": true,
    "config": { "tokenTtlSeconds": 900 }
  }'
```

### 4. Call the provider from a route

The existing `POST /api/v1/auth/providers/:slug/login` route (for credential-based providers)
will automatically dispatch to your provider once the row exists in the database. No new route is
needed for credential-based flows.

```bash
# A separate endpoint would issue the token to the user's inbox (not shown here),
# then the client presents it:
curl -X POST /api/v1/auth/providers/magic-link/login \
  -H 'Content-Type: application/json' \
  -d '{"token": "a3f9..."}'
```

`AuthenticationService.authenticateWithProvider('magic-link', { token })` resolves the rest:
it calls `MagicLinkProvider.authenticate()`, provisions the user if needed, and returns a session.

---

## Capability Gate

SSO providers (any type other than `local`) are gated behind the `auth.sso` capability:

```typescript
// src/capabilities/registry.ts
'auth.sso': {
  kind: 'boolean',
  defaultEnabled: true,   // enabled for all plans in OSS
  description: 'Single sign-on / external auth provider selection',
}
```

The default is `true`, so all Logtide deployments can use external providers out of the box.
Cloud or enterprise distributions can override this per-organization via
`organization_entitlements`.

---

## What Is Not Abstracted

The following are intentionally **outside** the provider interface boundary:

- **Session storage** — sessions remain server-side opaque tokens in the `sessions` table,
  independent of how the user authenticated.
- **User management** — creating, disabling, and deleting users lives in `UsersService`, not in
  providers. Providers only assert identity; they do not manage the user record.
- **SAML** — not yet implemented. The `AuthInput` union can be extended with a
  `{ type: 'saml_assertion'; samlResponse: string }` branch when a SAML provider is added as a
  separate module, without modifying this interface or the session layer.
- **Authorization** — what a user can do after login (roles, organization membership) is handled
  by the capabilities and tenant isolation layers, not by auth providers.
