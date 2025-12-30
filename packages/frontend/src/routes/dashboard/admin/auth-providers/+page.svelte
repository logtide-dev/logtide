<script lang="ts">
  import { onMount } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { toastStore } from '$lib/stores/toast';
  import { AdminAuthAPI, type AuthProviderConfig, type CreateProviderInput } from '$lib/api/admin-auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Plus, Settings, Trash2, Pencil, Building2, Server, Mail, Check, X } from 'lucide-svelte';

  let token = $state<string | null>(null);
  let adminAuthAPI = $derived(new AdminAuthAPI(() => token));

  authStore.subscribe((state) => {
    token = state.token;
  });

  let providers = $state<AuthProviderConfig[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Dialog states
  let showCreateDialog = $state(false);
  let showEditDialog = $state(false);
  let editingProvider = $state<AuthProviderConfig | null>(null);
  let dialogLoading = $state(false);

  // Create form state
  let createForm = $state<CreateProviderInput>({
    type: 'oidc',
    name: '',
    slug: '',
    enabled: true,
    config: {},
  });

  // OIDC config fields
  let oidcIssuerUrl = $state('');
  let oidcClientId = $state('');
  let oidcClientSecret = $state('');
  let oidcRedirectUri = $state('');

  // LDAP config fields
  let ldapUrl = $state('');
  let ldapBindDn = $state('');
  let ldapBindPassword = $state('');
  let ldapSearchBase = $state('');
  let ldapSearchFilter = $state('(uid={{username}})');

  onMount(async () => {
    await loadProviders();
  });

  async function loadProviders() {
    try {
      loading = true;
      error = null;
      const response = await adminAuthAPI.getProviders();
      providers = response.providers;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load providers';
    } finally {
      loading = false;
    }
  }

  function getProviderIcon(type: string) {
    switch (type) {
      case 'local':
        return Mail;
      case 'oidc':
        return Building2;
      case 'ldap':
        return Server;
      default:
        return Settings;
    }
  }

  function resetCreateForm() {
    createForm = {
      type: 'oidc',
      name: '',
      slug: '',
      enabled: true,
      config: {},
    };
    oidcIssuerUrl = '';
    oidcClientId = '';
    oidcClientSecret = '';
    oidcRedirectUri = '';
    ldapUrl = '';
    ldapBindDn = '';
    ldapBindPassword = '';
    ldapSearchBase = '';
    ldapSearchFilter = '(uid={{username}})';
  }

  function generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async function handleCreate() {
    try {
      dialogLoading = true;

      // Build config based on type
      let config: Record<string, unknown> = {};
      if (createForm.type === 'oidc') {
        config = {
          issuerUrl: oidcIssuerUrl,
          clientId: oidcClientId,
          clientSecret: oidcClientSecret,
          redirectUri: oidcRedirectUri || undefined,
          allowAutoRegister: true,
        };
      } else if (createForm.type === 'ldap') {
        config = {
          url: ldapUrl,
          bindDn: ldapBindDn,
          bindPassword: ldapBindPassword,
          searchBase: ldapSearchBase,
          searchFilter: ldapSearchFilter,
          allowAutoRegister: true,
        };
      }

      await adminAuthAPI.createProvider({
        ...createForm,
        config,
      });

      toastStore.success('Provider created successfully');
      showCreateDialog = false;
      resetCreateForm();
      await loadProviders();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to create provider');
    } finally {
      dialogLoading = false;
    }
  }

  async function handleToggleEnabled(provider: AuthProviderConfig) {
    try {
      await adminAuthAPI.updateProvider(provider.id, {
        enabled: !provider.enabled,
      });
      toastStore.success(provider.enabled ? 'Provider disabled' : 'Provider enabled');
      await loadProviders();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to update provider');
    }
  }

  async function handleDelete(provider: AuthProviderConfig) {
    if (!confirm(`Are you sure you want to delete the "${provider.name}" provider? This cannot be undone.`)) {
      return;
    }

    try {
      await adminAuthAPI.deleteProvider(provider.id);
      toastStore.success('Provider deleted');
      await loadProviders();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete provider');
    }
  }

  function openEditDialog(provider: AuthProviderConfig) {
    editingProvider = provider;
    createForm = {
      type: provider.type as 'oidc' | 'ldap',
      name: provider.name,
      slug: provider.slug,
      enabled: provider.enabled,
      config: provider.config,
    };

    // Populate type-specific fields
    if (provider.type === 'oidc') {
      const config = provider.config as { issuerUrl?: string; clientId?: string; clientSecret?: string; redirectUri?: string };
      oidcIssuerUrl = config.issuerUrl || '';
      oidcClientId = config.clientId || '';
      oidcClientSecret = config.clientSecret || '';
      oidcRedirectUri = config.redirectUri || '';
    } else if (provider.type === 'ldap') {
      const config = provider.config as { url?: string; bindDn?: string; bindPassword?: string; searchBase?: string; searchFilter?: string };
      ldapUrl = config.url || '';
      ldapBindDn = config.bindDn || '';
      ldapBindPassword = config.bindPassword || '';
      ldapSearchBase = config.searchBase || '';
      ldapSearchFilter = config.searchFilter || '(uid={{username}})';
    }

    showEditDialog = true;
  }

  async function handleUpdate() {
    if (!editingProvider) return;

    try {
      dialogLoading = true;

      // Build config based on type
      let config: Record<string, unknown> = {};
      if (createForm.type === 'oidc') {
        config = {
          issuerUrl: oidcIssuerUrl,
          clientId: oidcClientId,
          clientSecret: oidcClientSecret,
          redirectUri: oidcRedirectUri || undefined,
          allowAutoRegister: true,
        };
      } else if (createForm.type === 'ldap') {
        config = {
          url: ldapUrl,
          bindDn: ldapBindDn,
          bindPassword: ldapBindPassword,
          searchBase: ldapSearchBase,
          searchFilter: ldapSearchFilter,
          allowAutoRegister: true,
        };
      }

      await adminAuthAPI.updateProvider(editingProvider.id, {
        name: createForm.name,
        enabled: createForm.enabled,
        config,
      });

      toastStore.success('Provider updated successfully');
      showEditDialog = false;
      editingProvider = null;
      resetCreateForm();
      await loadProviders();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to update provider');
    } finally {
      dialogLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Authentication Providers - Admin - LogWard</title>
</svelte:head>

<div class="container mx-auto py-6 space-y-6">
  <div class="flex justify-between items-center">
    <div>
      <h1 class="text-2xl font-bold">Authentication Providers</h1>
      <p class="text-muted-foreground">Configure SSO providers for your organization</p>
    </div>
    <Button onclick={() => { resetCreateForm(); showCreateDialog = true; }}>
      <Plus class="h-4 w-4 mr-2" />
      Add Provider
    </Button>
  </div>

  {#if loading}
    <div class="flex justify-center py-12">
      <Spinner size="lg" />
    </div>
  {:else if error}
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  {:else}
    <div class="grid gap-4">
      {#each providers as provider}
        <Card>
          <CardContent class="p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div class="p-2 rounded-lg bg-muted">
                  <svelte:component this={getProviderIcon(provider.type)} class="h-5 w-5" />
                </div>
                <div>
                  <div class="font-medium flex items-center gap-2">
                    {provider.name}
                    {#if provider.type === 'local'}
                      <span class="text-xs bg-muted px-2 py-0.5 rounded">Built-in</span>
                    {/if}
                    {#if !provider.enabled}
                      <span class="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded">Disabled</span>
                    {/if}
                  </div>
                  <p class="text-sm text-muted-foreground">
                    {provider.type.toUpperCase()} &middot; {provider.slug}
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-2">
                {#if provider.type !== 'local'}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => openEditDialog(provider)}
                    title="Edit"
                  >
                    <Pencil class="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => handleToggleEnabled(provider)}
                    title={provider.enabled ? 'Disable' : 'Enable'}
                  >
                    {#if provider.enabled}
                      <Check class="h-4 w-4 text-green-500" />
                    {:else}
                      <X class="h-4 w-4 text-muted-foreground" />
                    {/if}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => handleDelete(provider)}
                    title="Delete"
                  >
                    <Trash2 class="h-4 w-4 text-destructive" />
                  </Button>
                {/if}
              </div>
            </div>
          </CardContent>
        </Card>
      {/each}
    </div>
  {/if}
</div>

<!-- Create Provider Dialog -->
<Dialog.Root bind:open={showCreateDialog}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add Authentication Provider</Dialog.Title>
      <Dialog.Description>
        Configure a new SSO provider for user authentication
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="type">Provider Type</Label>
        <select
          id="type"
          bind:value={createForm.type}
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="oidc">OpenID Connect (OIDC)</option>
          <option value="ldap">LDAP / Active Directory</option>
        </select>
      </div>

      <div class="space-y-2">
        <Label for="name">Display Name</Label>
        <Input
          id="name"
          placeholder="e.g., Authentik SSO"
          bind:value={createForm.name}
          oninput={() => { createForm.slug = generateSlug(createForm.name); }}
        />
      </div>

      <div class="space-y-2">
        <Label for="slug">Slug (URL identifier)</Label>
        <Input
          id="slug"
          placeholder="e.g., authentik"
          bind:value={createForm.slug}
        />
        <p class="text-xs text-muted-foreground">Used in URLs, lowercase letters and hyphens only</p>
      </div>

      {#if createForm.type === 'oidc'}
        <div class="space-y-4 pt-4 border-t">
          <h4 class="font-medium">OIDC Configuration</h4>

          <div class="space-y-2">
            <Label for="issuerUrl">Issuer URL</Label>
            <Input
              id="issuerUrl"
              placeholder="https://auth.example.com"
              bind:value={oidcIssuerUrl}
            />
          </div>

          <div class="space-y-2">
            <Label for="clientId">Client ID</Label>
            <Input
              id="clientId"
              placeholder="your-client-id"
              bind:value={oidcClientId}
            />
          </div>

          <div class="space-y-2">
            <Label for="clientSecret">Client Secret</Label>
            <Input
              id="clientSecret"
              type="password"
              placeholder="your-client-secret"
              bind:value={oidcClientSecret}
            />
          </div>

          <div class="space-y-2">
            <Label for="redirectUri">Redirect URI (optional)</Label>
            <Input
              id="redirectUri"
              placeholder={`http://localhost:8080/api/v1/auth/providers/${createForm.slug || 'your-slug'}/callback`}
              bind:value={oidcRedirectUri}
            />
            <p class="text-xs text-muted-foreground">Leave empty to auto-generate. Must match the URI configured in your IdP.</p>
          </div>
        </div>
      {:else if createForm.type === 'ldap'}
        <div class="space-y-4 pt-4 border-t">
          <h4 class="font-medium">LDAP Configuration</h4>

          <div class="space-y-2">
            <Label for="ldapUrl">LDAP URL</Label>
            <Input
              id="ldapUrl"
              placeholder="ldap://dc.example.com:389"
              bind:value={ldapUrl}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapBindDn">Bind DN (Service Account)</Label>
            <Input
              id="ldapBindDn"
              placeholder="CN=Service,OU=Users,DC=example,DC=com"
              bind:value={ldapBindDn}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapBindPassword">Bind Password</Label>
            <Input
              id="ldapBindPassword"
              type="password"
              placeholder="service-account-password"
              bind:value={ldapBindPassword}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapSearchBase">Search Base DN</Label>
            <Input
              id="ldapSearchBase"
              placeholder="OU=Users,DC=example,DC=com"
              bind:value={ldapSearchBase}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapSearchFilter">Search Filter</Label>
            <Input
              id="ldapSearchFilter"
              placeholder="(uid={{username}})"
              bind:value={ldapSearchFilter}
            />
            <p class="text-xs text-muted-foreground">Use {'{{username}}'} as placeholder for user input</p>
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => { showCreateDialog = false; }}>
        Cancel
      </Button>
      <Button onclick={handleCreate} disabled={dialogLoading}>
        {#if dialogLoading}
          <Spinner size="sm" class="mr-2" />
        {/if}
        Create Provider
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Edit Provider Dialog -->
<Dialog.Root bind:open={showEditDialog}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Edit Provider: {editingProvider?.name}</Dialog.Title>
      <Dialog.Description>
        Update the configuration for this authentication provider
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="edit-name">Display Name</Label>
        <Input
          id="edit-name"
          placeholder="e.g., Authentik SSO"
          bind:value={createForm.name}
        />
      </div>

      <div class="space-y-2">
        <Label>Slug</Label>
        <p class="text-sm text-muted-foreground bg-muted px-3 py-2 rounded">{editingProvider?.slug}</p>
        <p class="text-xs text-muted-foreground">Slug cannot be changed after creation</p>
      </div>

      {#if editingProvider?.type === 'oidc'}
        <div class="space-y-4 pt-4 border-t">
          <h4 class="font-medium">OIDC Configuration</h4>

          <div class="space-y-2">
            <Label for="edit-issuerUrl">Issuer URL</Label>
            <Input
              id="edit-issuerUrl"
              placeholder="https://auth.example.com"
              bind:value={oidcIssuerUrl}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-clientId">Client ID</Label>
            <Input
              id="edit-clientId"
              placeholder="your-client-id"
              bind:value={oidcClientId}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-clientSecret">Client Secret</Label>
            <Input
              id="edit-clientSecret"
              type="password"
              placeholder="your-client-secret"
              bind:value={oidcClientSecret}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-redirectUri">Redirect URI (optional)</Label>
            <Input
              id="edit-redirectUri"
              placeholder={`http://localhost:8080/api/v1/auth/providers/${editingProvider?.slug || 'your-slug'}/callback`}
              bind:value={oidcRedirectUri}
            />
            <p class="text-xs text-muted-foreground">Leave empty to auto-generate. Must match the URI configured in your IdP.</p>
          </div>
        </div>
      {:else if editingProvider?.type === 'ldap'}
        <div class="space-y-4 pt-4 border-t">
          <h4 class="font-medium">LDAP Configuration</h4>

          <div class="space-y-2">
            <Label for="edit-ldapUrl">LDAP URL</Label>
            <Input
              id="edit-ldapUrl"
              placeholder="ldap://dc.example.com:389"
              bind:value={ldapUrl}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapBindDn">Bind DN (Service Account)</Label>
            <Input
              id="edit-ldapBindDn"
              placeholder="CN=Service,OU=Users,DC=example,DC=com"
              bind:value={ldapBindDn}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapBindPassword">Bind Password</Label>
            <Input
              id="edit-ldapBindPassword"
              type="password"
              placeholder="service-account-password"
              bind:value={ldapBindPassword}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapSearchBase">Search Base DN</Label>
            <Input
              id="edit-ldapSearchBase"
              placeholder="OU=Users,DC=example,DC=com"
              bind:value={ldapSearchBase}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapSearchFilter">Search Filter</Label>
            <Input
              id="edit-ldapSearchFilter"
              placeholder="(uid={{username}})"
              bind:value={ldapSearchFilter}
            />
            <p class="text-xs text-muted-foreground">Use {'{{username}}'} as placeholder for user input</p>
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => { showEditDialog = false; editingProvider = null; }}>
        Cancel
      </Button>
      <Button onclick={handleUpdate} disabled={dialogLoading}>
        {#if dialogLoading}
          <Spinner size="sm" class="mr-2" />
        {/if}
        Save Changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
