<script lang="ts">
    import PageHeader from "$lib/components/app/PageHeader.svelte";
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
  import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
  import { Plus, Settings, Trash2, Pencil, Building2, Server, Mail, Check, X } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import { UsersAPI } from '$lib/api/users';
  import { get } from 'svelte/store';
  import { Switch } from '$lib/components/ui/switch';
  import { buildProviderConfig } from '$lib/utils/auth-provider-form';

  let adminAuthAPI = $derived(new AdminAuthAPI(() => $authStore.token));

  const usersAPI = new UsersAPI(() => get(authStore).token);

  $effect(() => {
    if (browser && $authStore.user) {
      if ($authStore.user.is_admin === undefined) {
        untrack(() => {
          usersAPI
            .getCurrentUser()
            .then(({ user }) => {
              const currentUser = get(authStore).user;
              if (currentUser) {
                authStore.updateUser({ ...currentUser, ...user });
                if (user.is_admin) loadProviders();
              }
            })
            .catch(() => goto('/dashboard'));
        });
      } else if ($authStore.user.is_admin === false) {
        untrack(() => goto('/dashboard'));
      }
    }
  });

  let providers = $state<AuthProviderConfig[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Delete dialog state
  let showDeleteProviderDialog = $state(false);
  let deleteTarget = $state<AuthProviderConfig | null>(null);
  let deletingProvider = $state(false);

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

  // Shared by both types: create users on first sign-in
  let allowAutoRegister = $state(true);

  function formFields() {
    return {
      oidc: {
        issuerUrl: oidcIssuerUrl,
        clientId: oidcClientId,
        clientSecret: oidcClientSecret,
        redirectUri: oidcRedirectUri,
        allowAutoRegister,
      },
      ldap: {
        url: ldapUrl,
        bindDn: ldapBindDn,
        bindPassword: ldapBindPassword,
        searchBase: ldapSearchBase,
        searchFilter: ldapSearchFilter,
        allowAutoRegister,
      },
    };
  }

  onMount(async () => {
    if ($authStore.user?.is_admin) await loadProviders();
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
    allowAutoRegister = true;
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

      const config = buildProviderConfig(createForm.type as 'oidc' | 'ldap', formFields(), 'create');

      await adminAuthAPI.createProvider({
        ...createForm,
        config,
      });

      toastStore.success('Provider created');
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

  function confirmDeleteProvider(provider: AuthProviderConfig) {
    deleteTarget = provider;
    showDeleteProviderDialog = true;
  }

  async function handleDeleteProvider() {
    if (!deleteTarget) return;
    deletingProvider = true;
    try {
      await adminAuthAPI.deleteProvider(deleteTarget.id);
      toastStore.success('Provider deleted');
      showDeleteProviderDialog = false;
      deleteTarget = null;
      await loadProviders();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete provider');
      throw e;
    } finally {
      deletingProvider = false;
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

    allowAutoRegister = (provider.config as { allowAutoRegister?: boolean }).allowAutoRegister !== false;

    // Populate type-specific fields
    if (provider.type === 'oidc') {
      const config = provider.config as { issuerUrl?: string; clientId?: string; clientSecret?: string; redirectUri?: string };
      oidcIssuerUrl = config.issuerUrl || '';
      oidcClientId = config.clientId || '';
      // Never load the masked secret into the field: blank means "keep current"
      oidcClientSecret = '';
      oidcRedirectUri = config.redirectUri || '';
    } else if (provider.type === 'ldap') {
      const config = provider.config as { url?: string; bindDn?: string; bindPassword?: string; searchBase?: string; searchFilter?: string };
      ldapUrl = config.url || '';
      ldapBindDn = config.bindDn || '';
      ldapBindPassword = '';
      ldapSearchBase = config.searchBase || '';
      ldapSearchFilter = config.searchFilter || '(uid={{username}})';
    }

    showEditDialog = true;
  }

  async function handleUpdate() {
    if (!editingProvider) return;

    try {
      dialogLoading = true;

      // Secrets are only sent when a new value was typed; the backend keeps
      // the stored one otherwise. allowAutoRegister keeps its current value.
      const config = buildProviderConfig(createForm.type as 'oidc' | 'ldap', formFields(), 'edit');

      await adminAuthAPI.updateProvider(editingProvider.id, {
        name: createForm.name,
        enabled: createForm.enabled,
        config,
      });

      toastStore.success('Provider updated');
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
  <title>Auth providers - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Auth providers"
    appliesTo="instance"
    description="Sign-in providers apply to the whole instance, not to a single organization."
  >
    {#snippet actions()}
      <Button onclick={() => { resetCreateForm(); showCreateDialog = true; }}>
        <Plus class="h-4 w-4 mr-2" />
        Add provider
      </Button>
    {/snippet}
  </PageHeader>

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
        {@const ProviderIcon = getProviderIcon(provider.type)}
        <Card>
          <CardContent class="p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-4">
                <div class="p-2 rounded-lg bg-muted">
                  <ProviderIcon class="h-5 w-5" />
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
                      <Check class="h-4 w-4 text-success-text" />
                    {:else}
                      <X class="h-4 w-4 text-muted-foreground" />
                    {/if}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => confirmDeleteProvider(provider)}
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

<!-- Create provider dialog -->
<Dialog.Root bind:open={showCreateDialog}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add authentication provider</Dialog.Title>
      <Dialog.Description>
        Configure a new SSO provider for user authentication
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="type">Provider type</Label>
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
        <Label for="name">Display name</Label>
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
          <h4 class="font-medium">OIDC configuration</h4>

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
            <Label for="clientSecret">Client secret</Label>
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
          <h4 class="font-medium">LDAP configuration</h4>

          <div class="space-y-2">
            <Label for="ldapUrl">LDAP URL</Label>
            <Input
              id="ldapUrl"
              placeholder="ldap://dc.example.com:389"
              bind:value={ldapUrl}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapBindDn">Bind DN (service account)</Label>
            <Input
              id="ldapBindDn"
              placeholder="CN=Service,OU=Users,DC=example,DC=com"
              bind:value={ldapBindDn}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapBindPassword">Bind password</Label>
            <Input
              id="ldapBindPassword"
              type="password"
              placeholder="service-account-password"
              bind:value={ldapBindPassword}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapSearchBase">Search base DN</Label>
            <Input
              id="ldapSearchBase"
              placeholder="OU=Users,DC=example,DC=com"
              bind:value={ldapSearchBase}
            />
          </div>

          <div class="space-y-2">
            <Label for="ldapSearchFilter">Search filter</Label>
            <Input
              id="ldapSearchFilter"
              placeholder={'(uid={{username}})'}
              bind:value={ldapSearchFilter}
            />
            <p class="text-xs text-muted-foreground">Use {'{{username}}'} as placeholder for user input</p>
          </div>
        </div>
      {/if}

      <div class="flex items-center justify-between gap-4 pt-4 border-t">
        <div class="space-y-0.5">
          <Label for="allowAutoRegister">Create accounts on first sign-in</Label>
          <p class="text-xs text-muted-foreground">When off, only users who already have an account can sign in with this provider.</p>
        </div>
        <Switch
          id="allowAutoRegister"
          checked={allowAutoRegister}
          onCheckedChange={(checked) => (allowAutoRegister = checked)}
        />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => { showCreateDialog = false; }}>
        Cancel
      </Button>
      <Button onclick={handleCreate} disabled={dialogLoading}>
        {#if dialogLoading}
          <Spinner size="sm" class="mr-2" />
        {/if}
        Create provider
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Edit provider dialog -->
<Dialog.Root bind:open={showEditDialog}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Edit provider: {editingProvider?.name}</Dialog.Title>
      <Dialog.Description>
        Update the configuration for this authentication provider
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="edit-name">Display name</Label>
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
          <h4 class="font-medium">OIDC configuration</h4>

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
            <Label for="edit-clientSecret">Client secret</Label>
            <Input
              id="edit-clientSecret"
              type="password"
              placeholder="Leave blank to keep current"
              autocomplete="new-password"
              bind:value={oidcClientSecret}
            />
            <p class="text-xs text-muted-foreground">Leave blank to keep the current secret.</p>
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
          <h4 class="font-medium">LDAP configuration</h4>

          <div class="space-y-2">
            <Label for="edit-ldapUrl">LDAP URL</Label>
            <Input
              id="edit-ldapUrl"
              placeholder="ldap://dc.example.com:389"
              bind:value={ldapUrl}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapBindDn">Bind DN (service account)</Label>
            <Input
              id="edit-ldapBindDn"
              placeholder="CN=Service,OU=Users,DC=example,DC=com"
              bind:value={ldapBindDn}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapBindPassword">Bind password</Label>
            <Input
              id="edit-ldapBindPassword"
              type="password"
              placeholder="Leave blank to keep current"
              autocomplete="new-password"
              bind:value={ldapBindPassword}
            />
            <p class="text-xs text-muted-foreground">Leave blank to keep the current password.</p>
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapSearchBase">Search base DN</Label>
            <Input
              id="edit-ldapSearchBase"
              placeholder="OU=Users,DC=example,DC=com"
              bind:value={ldapSearchBase}
            />
          </div>

          <div class="space-y-2">
            <Label for="edit-ldapSearchFilter">Search filter</Label>
            <Input
              id="edit-ldapSearchFilter"
              placeholder={'(uid={{username}})'}
              bind:value={ldapSearchFilter}
            />
            <p class="text-xs text-muted-foreground">Use {'{{username}}'} as placeholder for user input</p>
          </div>
        </div>
      {/if}
      {#if editingProvider?.type === 'oidc' || editingProvider?.type === 'ldap'}
      <div class="flex items-center justify-between gap-4 pt-4 border-t">
        <div class="space-y-0.5">
          <Label for="edit-allowAutoRegister">Create accounts on first sign-in</Label>
          <p class="text-xs text-muted-foreground">When off, only users who already have an account can sign in with this provider.</p>
        </div>
        <Switch
          id="edit-allowAutoRegister"
          checked={allowAutoRegister}
          onCheckedChange={(checked) => (allowAutoRegister = checked)}
        />
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
        Save changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete Provider Dialog -->
<ConfirmDialog
  bind:open={showDeleteProviderDialog}
  title="Delete provider"
  description={`Users who sign in through ${deleteTarget?.name ?? 'this provider'} will no longer be able to log in. This cannot be undone.`}
  confirmLabel="Delete provider"
  busy={deletingProvider}
  onConfirm={handleDeleteProvider}
/>
