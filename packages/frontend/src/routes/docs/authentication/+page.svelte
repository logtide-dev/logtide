<script lang="ts">
    import Breadcrumbs from "$lib/components/docs/Breadcrumbs.svelte";
    import CodeBlock from "$lib/components/docs/CodeBlock.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { AlertCircle, CheckCircle2, KeyRound, Server, Building2, Shield, Home, UserCog, Settings } from "lucide-svelte";
</script>

<div class="docs-content">
    <Breadcrumbs />

    <h1 class="text-3xl font-bold mb-4">Authentication</h1>
    <p class="text-lg text-muted-foreground mb-8">
        LogWard supports multiple authentication methods including local email/password,
        OpenID Connect (OIDC) for SSO, and LDAP for enterprise directory integration.
    </p>

    <h2
        id="overview"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Overview
    </h2>

    <div class="mb-12 space-y-6">
        <div class="grid md:grid-cols-3 gap-4">
            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <KeyRound class="w-5 h-5 text-primary mt-0.5" />
                        <div>
                            <CardTitle class="text-base">Local</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Traditional email/password authentication. Built-in, no external dependencies.
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <Building2 class="w-5 h-5 text-primary mt-0.5" />
                        <div>
                            <CardTitle class="text-base">OpenID Connect</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    SSO via OIDC providers: Authentik, Keycloak, Okta, Auth0, Google, Azure AD.
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div class="flex items-start gap-3">
                        <Server class="w-5 h-5 text-primary mt-0.5" />
                        <div>
                            <CardTitle class="text-base">LDAP</CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent class="text-sm text-muted-foreground">
                    Enterprise directory integration with Active Directory, OpenLDAP, FreeIPA.
                </CardContent>
            </Card>
        </div>

        <Card class="border-blue-500/30 bg-blue-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <Shield class="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Security Features</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <ul class="list-disc list-inside space-y-1">
                    <li>PKCE flow for OIDC (protection against authorization code interception)</li>
                    <li>Secure password hashing with bcrypt for local accounts</li>
                    <li>Rate limiting on authentication endpoints</li>
                    <li>Automatic account linking when email matches</li>
                </ul>
            </CardContent>
        </Card>
    </div>

    <h2
        id="admin-setup"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Admin Setup
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            Authentication providers are configured by administrators in the Admin Panel.
            Navigate to <strong>Admin &gt; Auth Providers</strong> to manage providers.
        </p>

        <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <div class="flex items-start gap-3">
                <CheckCircle2 class="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                <div>
                    <p class="font-semibold text-green-600 dark:text-green-400 mb-1">
                        Local Provider Enabled by Default
                    </p>
                    <p class="text-sm text-muted-foreground">
                        The local email/password provider is automatically available.
                        Add OIDC or LDAP providers to enable SSO.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <h2
        id="oidc"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        OpenID Connect (OIDC)
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            OIDC enables Single Sign-On (SSO) with identity providers like Authentik, Keycloak,
            Okta, Auth0, Google, and Azure AD.
        </p>

        <div>
            <h3 id="oidc-config" class="text-lg font-semibold mb-3 scroll-mt-20">Configuration Fields</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Field</th>
                            <th class="text-left p-3 border-b border-border">Description</th>
                            <th class="text-left p-3 border-b border-border">Example</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Issuer URL</td>
                            <td class="p-3 border-b border-border">OIDC discovery endpoint (without <code>/.well-known/openid-configuration</code>)</td>
                            <td class="p-3 border-b border-border font-mono text-xs">https://auth.example.com/application/o/logward/</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Client ID</td>
                            <td class="p-3 border-b border-border">Application client ID from your identity provider</td>
                            <td class="p-3 border-b border-border font-mono text-xs">logward-client-id</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Client Secret</td>
                            <td class="p-3 border-b border-border">Application client secret (for confidential clients)</td>
                            <td class="p-3 border-b border-border font-mono text-xs">your-secret-here</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Redirect URI</td>
                            <td class="p-3 border-b border-border">Callback URL (optional, auto-generated if empty)</td>
                            <td class="p-3 border-b border-border font-mono text-xs">https://logward.example.com/api/v1/auth/providers/my-oidc/callback</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Scopes</td>
                            <td class="p-3 border-b border-border">OAuth scopes to request</td>
                            <td class="p-3 border-b border-border font-mono text-xs">openid, email, profile</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Email Claim</td>
                            <td class="p-3 border-b border-border">JWT claim containing user email</td>
                            <td class="p-3 border-b border-border font-mono text-xs">email</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">Name Claim</td>
                            <td class="p-3">JWT claim containing user display name</td>
                            <td class="p-3 font-mono text-xs">name</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div>
            <h3 id="authentik-setup" class="text-lg font-semibold mb-3 scroll-mt-20">Example: Authentik Setup</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Configure LogWard as an OAuth2/OIDC application in Authentik:
            </p>
            <ol class="list-decimal list-inside space-y-2 text-sm text-muted-foreground mb-4">
                <li>In Authentik, go to <strong>Applications &gt; Applications</strong> and create a new application</li>
                <li>Create an OAuth2/OIDC Provider with these settings:
                    <ul class="list-disc list-inside ml-4 mt-1 space-y-1">
                        <li><strong>Client type:</strong> Confidential</li>
                        <li><strong>Client ID:</strong> (auto-generated or custom)</li>
                        <li><strong>Client Secret:</strong> (auto-generated)</li>
                        <li><strong>Redirect URIs:</strong> <code>https://your-logward.com/api/v1/auth/providers/authentik/callback</code></li>
                    </ul>
                </li>
                <li>Note the <strong>OpenID Configuration Issuer</strong> URL from the provider overview</li>
                <li>In LogWard Admin, add a new OIDC provider with these values</li>
            </ol>
            <CodeBlock
                lang="json"
                code={`{
  "issuerUrl": "https://auth.example.com/application/o/logward/",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "redirectUri": "https://logward.example.com/api/v1/auth/providers/authentik/callback",
  "scopes": ["openid", "email", "profile"]
}`}
            />
        </div>

        <div>
            <h3 id="keycloak-setup" class="text-lg font-semibold mb-3 scroll-mt-20">Example: Keycloak Setup</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm text-muted-foreground mb-4">
                <li>In Keycloak Admin Console, create a new client in your realm</li>
                <li>Set <strong>Client type</strong> to "OpenID Connect"</li>
                <li>Set <strong>Client authentication</strong> to "On" (confidential client)</li>
                <li>Add <strong>Valid redirect URI:</strong> <code>https://your-logward.com/api/v1/auth/providers/keycloak/callback</code></li>
                <li>Copy Client ID and Client Secret from the Credentials tab</li>
            </ol>
            <CodeBlock
                lang="json"
                code={`{
  "issuerUrl": "https://keycloak.example.com/realms/your-realm",
  "clientId": "logward",
  "clientSecret": "your-client-secret"
}`}
            />
        </div>

        <Card class="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Redirect URI Must Match</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    The redirect URI configured in your identity provider must exactly match what LogWard uses.
                    The format is: <code>https://your-logward-domain/api/v1/auth/providers/&#123;slug&#125;/callback</code>
                </p>
                <p class="mt-2">
                    If you're using a reverse proxy, ensure the backend API is accessible at <code>/api/</code>.
                </p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="ldap"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        LDAP / Active Directory
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            LDAP integration allows users to authenticate with their enterprise directory credentials
            (Active Directory, OpenLDAP, FreeIPA, etc.).
        </p>

        <div>
            <h3 id="ldap-config" class="text-lg font-semibold mb-3 scroll-mt-20">Configuration Fields</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Field</th>
                            <th class="text-left p-3 border-b border-border">Description</th>
                            <th class="text-left p-3 border-b border-border">Example</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Server URL</td>
                            <td class="p-3 border-b border-border">LDAP server address (ldap:// or ldaps://)</td>
                            <td class="p-3 border-b border-border font-mono text-xs">ldap://ldap.example.com:389</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Bind DN</td>
                            <td class="p-3 border-b border-border">Service account DN for searching users</td>
                            <td class="p-3 border-b border-border font-mono text-xs">cn=admin,dc=example,dc=com</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Bind Password</td>
                            <td class="p-3 border-b border-border">Service account password</td>
                            <td class="p-3 border-b border-border font-mono text-xs">your-bind-password</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Search Base</td>
                            <td class="p-3 border-b border-border">Base DN for user searches</td>
                            <td class="p-3 border-b border-border font-mono text-xs">ou=users,dc=example,dc=com</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Search Filter</td>
                            <td class="p-3 border-b border-border">LDAP filter to find users (use <code>&#123;&#123;username&#125;&#125;</code> placeholder)</td>
                            <td class="p-3 border-b border-border font-mono text-xs">(uid=&#123;&#123;username&#125;&#125;)</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">Email Attribute</td>
                            <td class="p-3 border-b border-border">LDAP attribute containing user email</td>
                            <td class="p-3 border-b border-border font-mono text-xs">mail</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">Name Attribute</td>
                            <td class="p-3">LDAP attribute containing user display name</td>
                            <td class="p-3 font-mono text-xs">cn</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div>
            <h3 id="openldap-setup" class="text-lg font-semibold mb-3 scroll-mt-20">Example: OpenLDAP Setup</h3>
            <CodeBlock
                lang="json"
                code={`{
  "serverUrl": "ldap://ldap.example.com:389",
  "bindDn": "cn=admin,dc=example,dc=com",
  "bindPassword": "admin-password",
  "searchBase": "ou=users,dc=example,dc=com",
  "searchFilter": "(uid={{username}})",
  "emailAttribute": "mail",
  "nameAttribute": "cn"
}`}
            />
        </div>

        <div>
            <h3 id="active-directory-setup" class="text-lg font-semibold mb-3 scroll-mt-20">Example: Active Directory Setup</h3>
            <CodeBlock
                lang="json"
                code={`{
  "serverUrl": "ldaps://ad.example.com:636",
  "bindDn": "CN=Service Account,OU=Service Accounts,DC=example,DC=com",
  "bindPassword": "service-account-password",
  "searchBase": "OU=Users,DC=example,DC=com",
  "searchFilter": "(sAMAccountName={{username}})",
  "emailAttribute": "mail",
  "nameAttribute": "displayName"
}`}
            />
            <p class="text-sm text-muted-foreground mt-3">
                For Active Directory, use <code>sAMAccountName</code> for username-based login
                or <code>userPrincipalName</code> for email-based login.
            </p>
        </div>

        <Card class="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">LDAPS Recommended for Production</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    Always use <code>ldaps://</code> (LDAP over SSL/TLS on port 636) in production
                    to encrypt credentials in transit. Plain <code>ldap://</code> transmits passwords in cleartext.
                </p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="user-flow"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        User Authentication Flow
    </h2>

    <div class="mb-12 space-y-6">
        <div>
            <h3 id="new-users" class="text-lg font-semibold mb-3 scroll-mt-20">New Users</h3>
            <p class="text-sm text-muted-foreground mb-3">
                When a user authenticates via OIDC or LDAP for the first time:
            </p>
            <ol class="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>A new LogWard account is automatically created using their email and name from the identity provider</li>
                <li>The external identity is linked to the new account</li>
                <li>User is redirected to the onboarding flow to create or join an organization</li>
            </ol>
        </div>

        <div>
            <h3 id="existing-users" class="text-lg font-semibold mb-3 scroll-mt-20">Existing Users</h3>
            <p class="text-sm text-muted-foreground mb-3">
                When an existing user authenticates:
            </p>
            <ul class="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li><strong>Same email:</strong> If a local account exists with the same email, the external identity is automatically linked</li>
                <li><strong>Already linked:</strong> If the identity is already linked, user is logged in directly</li>
            </ul>
        </div>

        <div>
            <h3 id="multiple-providers" class="text-lg font-semibold mb-3 scroll-mt-20">Multiple Providers</h3>
            <p class="text-sm text-muted-foreground">
                Users can have multiple identities linked to one account. For example, a user could:
            </p>
            <ul class="list-disc list-inside space-y-1 text-sm text-muted-foreground mt-2">
                <li>Sign up with email/password (local)</li>
                <li>Later link their Okta account for SSO convenience</li>
                <li>Also link their LDAP credentials for on-premise access</li>
            </ul>
        </div>
    </div>

    <h2
        id="environment-variables"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Environment Variables
    </h2>

    <div class="mb-12 space-y-6">
        <div class="overflow-x-auto">
            <table class="w-full text-sm border border-border rounded-lg">
                <thead class="bg-muted">
                    <tr>
                        <th class="text-left p-3 border-b border-border">Variable</th>
                        <th class="text-left p-3 border-b border-border">Description</th>
                        <th class="text-left p-3 border-b border-border">Default</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="p-3 border-b border-border font-mono text-xs">FRONTEND_URL</td>
                        <td class="p-3 border-b border-border">Frontend URL for OIDC redirects</td>
                        <td class="p-3 border-b border-border font-mono text-xs">http://localhost:3000 (dev)</td>
                    </tr>
                    <tr>
                        <td class="p-3 border-b border-border font-mono text-xs">AUTH_RATE_LIMIT_LOGIN</td>
                        <td class="p-3 border-b border-border">Max login attempts per window</td>
                        <td class="p-3 border-b border-border font-mono text-xs">20</td>
                    </tr>
                    <tr>
                        <td class="p-3 font-mono text-xs">AUTH_RATE_LIMIT_WINDOW</td>
                        <td class="p-3">Rate limit window in milliseconds</td>
                        <td class="p-3 font-mono text-xs">900000 (15 min)</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <Card class="border-blue-500/30 bg-blue-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Production Configuration</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    For production deployments with OIDC, set <code>FRONTEND_URL</code> to your actual frontend domain
                    (e.g., <code>https://logward.example.com</code>). This ensures users are redirected correctly after SSO authentication.
                </p>
            </CardContent>
        </Card>
    </div>

    <h2
        id="auth-free-mode"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Auth-Free Mode
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            For single-user deployments, LogWard supports an <strong>auth-free mode</strong> that
            bypasses authentication entirely. This is ideal for personal setups where you're the only user
            and don't need login protection.
        </p>

        <Card class="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Security Warning</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    Auth-free mode disables all authentication. <strong>Only use this for private, single-user deployments</strong>
                    where the LogWard instance is not exposed to the internet. Anyone with network access to your
                    LogWard instance will have full admin access.
                </p>
            </CardContent>
        </Card>

        <div>
            <h3 id="auth-free-how" class="text-lg font-semibold mb-3 scroll-mt-20">How It Works</h3>
            <p class="text-sm text-muted-foreground mb-3">
                When auth-free mode is enabled:
            </p>
            <ul class="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li>All API requests bypass token validation</li>
                <li>The frontend automatically uses the configured default user</li>
                <li>No login page is shown — users go directly to the dashboard</li>
                <li>The default user must be an admin with at least one organization</li>
            </ul>
        </div>

        <div>
            <h3 id="auth-free-setup" class="text-lg font-semibold mb-3 scroll-mt-20">Setting Up Auth-Free Mode</h3>
            <ol class="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>First, create a local admin account through normal signup</li>
                <li>Create at least one organization for the admin user</li>
                <li>Go to <strong>Admin &gt; Settings</strong></li>
                <li>Set <strong>Authentication Mode</strong> to "Auth-Free (No Login Required)"</li>
                <li>Select the admin user as the <strong>Default User</strong></li>
                <li>Save changes</li>
            </ol>
            <p class="text-sm text-muted-foreground mt-3">
                After saving, you'll be automatically logged in as the default user. On subsequent visits,
                no login will be required.
            </p>
        </div>

        <div>
            <h3 id="auth-free-requirements" class="text-lg font-semibold mb-3 scroll-mt-20">Requirements</h3>
            <div class="grid md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <div class="flex items-start gap-3">
                            <UserCog class="w-5 h-5 text-primary mt-0.5" />
                            <div>
                                <CardTitle class="text-base">Admin User Required</CardTitle>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        The default user must have admin privileges. Only admin users appear in the
                        default user selection dropdown.
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div class="flex items-start gap-3">
                            <Building2 class="w-5 h-5 text-primary mt-0.5" />
                            <div>
                                <CardTitle class="text-base">Organization Required</CardTitle>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        The default user must belong to at least one organization. Create an organization
                        before enabling auth-free mode.
                    </CardContent>
                </Card>
            </div>
        </div>

        <div>
            <h3 id="auth-free-disable" class="text-lg font-semibold mb-3 scroll-mt-20">Disabling Auth-Free Mode</h3>
            <p class="text-sm text-muted-foreground">
                To re-enable authentication, go to <strong>Admin &gt; Settings</strong> and set
                <strong>Authentication Mode</strong> back to "Standard (Login Required)". Users will
                then need to log in with their credentials.
            </p>
        </div>
    </div>

    <h2
        id="initial-admin"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Initial Admin Setup
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            For automated deployments (Docker, Kubernetes, etc.), you can create an initial admin user
            using environment variables. This allows you to deploy LogWard without needing to manually
            create the first account.
        </p>

        <div>
            <h3 id="initial-admin-env" class="text-lg font-semibold mb-3 scroll-mt-20">Environment Variables</h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm border border-border rounded-lg">
                    <thead class="bg-muted">
                        <tr>
                            <th class="text-left p-3 border-b border-border">Variable</th>
                            <th class="text-left p-3 border-b border-border">Description</th>
                            <th class="text-left p-3 border-b border-border">Required</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">INITIAL_ADMIN_EMAIL</td>
                            <td class="p-3 border-b border-border">Email address for the admin account</td>
                            <td class="p-3 border-b border-border">Yes</td>
                        </tr>
                        <tr>
                            <td class="p-3 border-b border-border font-mono text-xs">INITIAL_ADMIN_PASSWORD</td>
                            <td class="p-3 border-b border-border">Password (minimum 8 characters)</td>
                            <td class="p-3 border-b border-border">Yes</td>
                        </tr>
                        <tr>
                            <td class="p-3 font-mono text-xs">INITIAL_ADMIN_NAME</td>
                            <td class="p-3">Display name (defaults to "Admin")</td>
                            <td class="p-3">No</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div>
            <h3 id="initial-admin-example" class="text-lg font-semibold mb-3 scroll-mt-20">Docker Compose Example</h3>
            <CodeBlock
                lang="yaml"
                code={`services:
  backend:
    image: logward/backend:latest
    environment:
      # Initial admin (only creates user if no users exist)
      INITIAL_ADMIN_EMAIL: admin@example.com
      INITIAL_ADMIN_PASSWORD: your-secure-password
      INITIAL_ADMIN_NAME: Administrator
      # ... other environment variables`}
            />
        </div>

        <Card class="border-blue-500/30 bg-blue-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <CheckCircle2 class="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">One-Time Creation</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    The initial admin is only created if <strong>no users with login credentials exist</strong>.
                    After the first user is created, these environment variables are ignored. This is safe to
                    leave in your deployment configuration.
                </p>
            </CardContent>
        </Card>

        <div>
            <h3 id="auto-generated-credentials" class="text-lg font-semibold mb-3 scroll-mt-20">Auto-Generated Credentials</h3>
            <p class="text-sm text-muted-foreground mb-3">
                If you don't configure <code>INITIAL_ADMIN_*</code> environment variables, LogWard will
                automatically create a <code>system@logward.internal</code> admin account with a randomly
                generated password. The credentials are printed to the console on first startup:
            </p>
            <CodeBlock
                lang="text"
                code={`╔════════════════════════════════════════════════════════════════╗
║  INITIAL ADMIN CREDENTIALS (save these!)                       ║
╠════════════════════════════════════════════════════════════════╣
║  Email:    system@logward.internal                             ║
║  Password: xY7k2mN9pQ4rS1tU...                                 ║
╠════════════════════════════════════════════════════════════════╣
║  Change your password after first login!                       ║
║  Or set INITIAL_ADMIN_* env vars for future deployments.       ║
╚════════════════════════════════════════════════════════════════╝`}
            />
            <p class="text-sm text-muted-foreground mt-3">
                Check your Docker logs or terminal output for these credentials. We recommend changing the
                password after first login or using the <code>INITIAL_ADMIN_*</code> environment variables
                for production deployments.
            </p>
        </div>
    </div>

    <h2
        id="admin-settings"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Admin Settings
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            Administrators can configure authentication behavior from <strong>Admin &gt; Settings</strong>.
        </p>

        <div class="overflow-x-auto">
            <table class="w-full text-sm border border-border rounded-lg">
                <thead class="bg-muted">
                    <tr>
                        <th class="text-left p-3 border-b border-border">Setting</th>
                        <th class="text-left p-3 border-b border-border">Description</th>
                        <th class="text-left p-3 border-b border-border">Options</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="p-3 border-b border-border font-medium">Authentication Mode</td>
                        <td class="p-3 border-b border-border">Controls whether users need to log in</td>
                        <td class="p-3 border-b border-border">
                            <ul class="list-disc list-inside space-y-1">
                                <li><strong>Standard:</strong> Users must log in</li>
                                <li><strong>Auth-Free:</strong> No login required</li>
                            </ul>
                        </td>
                    </tr>
                    <tr>
                        <td class="p-3 border-b border-border font-medium">Signups Enabled</td>
                        <td class="p-3 border-b border-border">Allow new user registration</td>
                        <td class="p-3 border-b border-border">
                            <ul class="list-disc list-inside space-y-1">
                                <li><strong>Enabled:</strong> Anyone can create an account</li>
                                <li><strong>Disabled:</strong> Only existing users can log in</li>
                            </ul>
                        </td>
                    </tr>
                    <tr>
                        <td class="p-3 font-medium">Default User</td>
                        <td class="p-3">User to use in auth-free mode</td>
                        <td class="p-3">Select from admin users only</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div>
            <h3 id="disable-signups" class="text-lg font-semibold mb-3 scroll-mt-20">Disabling Signups</h3>
            <p class="text-sm text-muted-foreground mb-3">
                To prevent new user registrations (useful for private instances):
            </p>
            <ol class="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Go to <strong>Admin &gt; Settings</strong></li>
                <li>Toggle <strong>Signups Enabled</strong> to off</li>
                <li>Save changes</li>
            </ol>
            <p class="text-sm text-muted-foreground mt-3">
                When signups are disabled, the signup link is hidden from the login page. Users can only
                be created by administrators or through external identity providers (OIDC/LDAP).
            </p>
        </div>
    </div>

    <h2
        id="user-management"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        User Management
    </h2>

    <div class="mb-12 space-y-6">
        <p class="text-muted-foreground">
            Administrators can manage users from <strong>Admin &gt; Users</strong>.
        </p>

        <div>
            <h3 id="admin-role" class="text-lg font-semibold mb-3 scroll-mt-20">Admin Role Management</h3>
            <p class="text-sm text-muted-foreground mb-3">
                From the user details page, administrators can promote or demote users:
            </p>
            <ul class="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li><strong>Promote to Admin:</strong> Gives the user full admin access including system settings,
                    user management, and access to all organizations</li>
                <li><strong>Remove Admin Role:</strong> Revokes admin privileges. The user retains their
                    organization memberships and data access</li>
            </ul>
        </div>

        <Card class="border-yellow-500/30 bg-yellow-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-yellow-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">Self-Demotion Protection</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p>
                    You cannot remove the admin role from yourself. This prevents accidentally locking
                    yourself out of admin access. Another admin must demote you if needed.
                </p>
            </CardContent>
        </Card>

        <div>
            <h3 id="user-actions" class="text-lg font-semibold mb-3 scroll-mt-20">Other User Actions</h3>
            <div class="grid md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle class="text-base">Enable/Disable User</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        Disabled users are immediately logged out and cannot log in until re-enabled.
                        Use this to temporarily revoke access without deleting the account.
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-base">Reset Password</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        Set a new password for a user. This invalidates all their existing sessions,
                        requiring them to log in again with the new password.
                    </CardContent>
                </Card>
            </div>
        </div>
    </div>

    <h2
        id="troubleshooting"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Troubleshooting
    </h2>

    <div class="mb-8 space-y-6">
        <div>
            <h3 id="oidc-errors" class="text-lg font-semibold mb-3 scroll-mt-20">OIDC Errors</h3>
            <div class="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">invalid_client</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Verify Client ID and Client Secret are correct</li>
                            <li>Check that the client is configured as "Confidential" in your IdP</li>
                            <li>Some providers require POST-based client authentication (LogWard uses this by default)</li>
                        </ul>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">redirect_uri_mismatch</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>The redirect URI in LogWard must exactly match what's configured in your IdP</li>
                            <li>Check for trailing slashes, http vs https, and port numbers</li>
                            <li>Format: <code>https://&#123;domain&#125;/api/v1/auth/providers/&#123;slug&#125;/callback</code></li>
                        </ul>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">issuer mismatch</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>The Issuer URL must match exactly what the IdP returns in discovery</li>
                            <li>Check for trailing slashes - some providers require them, others don't</li>
                            <li>Visit <code>&#123;issuerUrl&#125;/.well-known/openid-configuration</code> to see the expected issuer</li>
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </div>

        <div>
            <h3 id="auth-free-errors" class="text-lg font-semibold mb-3 scroll-mt-20">Auth-Free Mode Issues</h3>
            <div class="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">Redirect loop between login and dashboard</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Ensure the default user is configured in Admin Settings</li>
                            <li>Verify the default user has at least one organization</li>
                            <li>Clear browser cache and cookies, then refresh</li>
                        </ul>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">"Auth-free mode enabled but default user not configured"</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Go to Admin &gt; Settings and select a default user</li>
                            <li>The default user must be an admin with at least one organization</li>
                            <li>If no users are available, switch back to standard mode and create an admin user first</li>
                        </ul>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">API returns "Invalid or expired session"</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Verify auth-free mode is properly enabled in the database</li>
                            <li>Restart the backend service to clear any cached settings</li>
                            <li>Check that the Redis cache has been updated (settings use a 5-minute cache TTL)</li>
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </div>

        <div>
            <h3 id="ldap-errors" class="text-lg font-semibold mb-3 scroll-mt-20">LDAP Errors</h3>
            <div class="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">Invalid credentials</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Verify the Bind DN and Bind Password are correct</li>
                            <li>Test the bind credentials directly with <code>ldapsearch</code></li>
                            <li>Check if the service account has permission to search the user base</li>
                        </ul>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">User not found</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Verify the Search Base DN is correct</li>
                            <li>Check the Search Filter - use <code>(uid=&#123;&#123;username&#125;&#125;)</code> for OpenLDAP or <code>(sAMAccountName=&#123;&#123;username&#125;&#125;)</code> for AD</li>
                            <li>Ensure the user exists in the specified search base</li>
                        </ul>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="text-sm font-mono">Connection refused / timeout</CardTitle>
                    </CardHeader>
                    <CardContent class="text-sm text-muted-foreground">
                        <ul class="list-disc list-inside space-y-1">
                            <li>Check firewall rules between LogWard and the LDAP server</li>
                            <li>Verify the server URL and port (389 for LDAP, 636 for LDAPS)</li>
                            <li>For LDAPS, ensure the server certificate is valid</li>
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </div>
    </div>

    <h2
        id="dev-testing"
        class="text-2xl font-semibold mb-4 scroll-mt-20 border-b border-border pb-2"
    >
        Development Testing
    </h2>

    <div class="mb-8 space-y-6">
        <p class="text-muted-foreground">
            For local development and testing, you can run identity providers using Docker.
        </p>

        <div>
            <h3 id="test-authentik" class="text-lg font-semibold mb-3 scroll-mt-20">Test with Authentik (OIDC)</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Create a <code>docker-compose.authentik.yml</code> file:
            </p>
            <CodeBlock
                lang="yaml"
                code={`# Authentik for testing OIDC integration
# Run: docker compose -f docker-compose.authentik.yml up -d
# Access: http://localhost:9000 (admin setup on first visit)

services:
  postgresql-authentik:
    image: docker.io/library/postgres:16-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -d \$\${POSTGRES_DB} -U \$\${POSTGRES_USER}"]
      start_period: 20s
      interval: 30s
      retries: 5
      timeout: 5s
    volumes:
      - authentik-db:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: authentik-password
      POSTGRES_USER: authentik
      POSTGRES_DB: authentik

  redis-authentik:
    image: docker.io/library/redis:alpine
    command: --save 60 1 --loglevel warning
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ping | grep PONG"]
      start_period: 20s
      interval: 30s
      retries: 5
      timeout: 3s
    volumes:
      - authentik-redis:/data

  authentik-server:
    image: ghcr.io/goauthentik/server:2024.2.2
    restart: unless-stopped
    command: server
    environment:
      AUTHENTIK_REDIS__HOST: redis-authentik
      AUTHENTIK_POSTGRESQL__HOST: postgresql-authentik
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: authentik-password
      AUTHENTIK_SECRET_KEY: test-secret-key-change-in-production
    volumes:
      - authentik-media:/media
      - authentik-templates:/templates
    ports:
      - "9000:9000"
      - "9443:9443"
    depends_on:
      - postgresql-authentik
      - redis-authentik

  authentik-worker:
    image: ghcr.io/goauthentik/server:2024.2.2
    restart: unless-stopped
    command: worker
    environment:
      AUTHENTIK_REDIS__HOST: redis-authentik
      AUTHENTIK_POSTGRESQL__HOST: postgresql-authentik
      AUTHENTIK_POSTGRESQL__USER: authentik
      AUTHENTIK_POSTGRESQL__NAME: authentik
      AUTHENTIK_POSTGRESQL__PASSWORD: authentik-password
      AUTHENTIK_SECRET_KEY: test-secret-key-change-in-production
    volumes:
      - authentik-media:/media
      - authentik-templates:/templates
    depends_on:
      - postgresql-authentik
      - redis-authentik

volumes:
  authentik-db:
  authentik-redis:
  authentik-media:
  authentik-templates:`}
            />
            <p class="text-sm text-muted-foreground mt-3">
                After starting, visit <code>http://localhost:9000</code> to set up the admin account,
                then create an OAuth2/OIDC application for LogWard.
            </p>
        </div>

        <div>
            <h3 id="test-openldap" class="text-lg font-semibold mb-3 scroll-mt-20">Test with OpenLDAP</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Create a <code>docker-compose.ldap.yml</code> file:
            </p>
            <CodeBlock
                lang="yaml"
                code={`# OpenLDAP for testing LDAP integration
# Run: docker compose -f docker-compose.ldap.yml up -d
# Admin UI: http://localhost:8090

services:
  openldap:
    image: osixia/openldap:1.5.0
    container_name: logward-openldap
    environment:
      LDAP_ORGANISATION: "Example Inc"
      LDAP_DOMAIN: "example.org"
      LDAP_ADMIN_PASSWORD: "adminpassword"
      LDAP_CONFIG_PASSWORD: "configpassword"
      LDAP_READONLY_USER: "true"
      LDAP_READONLY_USER_USERNAME: "readonly"
      LDAP_READONLY_USER_PASSWORD: "readonlypassword"
    ports:
      - "389:389"
      - "636:636"
    volumes:
      - ldap-data:/var/lib/ldap
      - ldap-config:/etc/ldap/slapd.d

  phpldapadmin:
    image: osixia/phpldapadmin:0.9.0
    container_name: logward-phpldapadmin
    environment:
      PHPLDAPADMIN_LDAP_HOSTS: openldap
      PHPLDAPADMIN_HTTPS: "false"
    ports:
      - "8090:80"
    depends_on:
      - openldap

volumes:
  ldap-data:
  ldap-config:`}
            />
        </div>

        <div>
            <h3 id="ldap-test-user" class="text-lg font-semibold mb-3 scroll-mt-20">Create LDAP Test User</h3>
            <p class="text-sm text-muted-foreground mb-3">
                Create a <code>test-user.ldif</code> file and apply it to create a test user:
            </p>
            <CodeBlock
                lang="ldif"
                code={`# test-user.ldif
dn: ou=users,dc=example,dc=org
objectClass: organizationalUnit
ou: users

dn: cn=testuser,ou=users,dc=example,dc=org
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
cn: testuser
sn: User
givenName: Test
uid: testuser
uidNumber: 1000
gidNumber: 1000
homeDirectory: /home/testuser
mail: testuser@example.org
userPassword: testpassword`}
            />
            <p class="text-sm text-muted-foreground mt-3">
                Apply with:
            </p>
            <CodeBlock
                lang="bash"
                code={`# Copy file to container
docker cp test-user.ldif logward-openldap:/tmp/test-user.ldif

# Apply LDIF
docker exec logward-openldap ldapadd -x -D "cn=admin,dc=example,dc=org" -w adminpassword -f /tmp/test-user.ldif`}
            />
            <p class="text-sm text-muted-foreground mt-3">
                Test credentials: <code>testuser</code> / <code>testpassword</code>
            </p>
        </div>

        <Card class="border-blue-500/30 bg-blue-500/5">
            <CardHeader>
                <div class="flex items-start gap-3">
                    <AlertCircle class="w-5 h-5 text-blue-500 mt-0.5" />
                    <div>
                        <CardTitle class="text-base">LogWard Provider Configuration</CardTitle>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="text-sm text-muted-foreground">
                <p class="mb-2">For the OpenLDAP test setup, use these values in LogWard:</p>
                <ul class="list-disc list-inside space-y-1">
                    <li><strong>Server URL:</strong> <code>ldap://localhost:389</code></li>
                    <li><strong>Bind DN:</strong> <code>cn=admin,dc=example,dc=org</code></li>
                    <li><strong>Bind Password:</strong> <code>adminpassword</code></li>
                    <li><strong>Search Base:</strong> <code>ou=users,dc=example,dc=org</code></li>
                    <li><strong>Search Filter:</strong> <code>(uid=&#123;&#123;username&#125;&#125;)</code></li>
                </ul>
            </CardContent>
        </Card>
    </div>
</div>

<style>
    .docs-content :global(code:not(pre code)) {
        @apply px-1.5 py-0.5 bg-muted rounded text-sm font-mono;
    }
</style>
