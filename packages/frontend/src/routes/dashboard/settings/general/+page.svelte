<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import { OrganizationsAPI } from '$lib/api/organizations';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import DangerZone from '$lib/components/app/DangerZone.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import ReadOnlyNotice from '$lib/components/settings/ReadOnlyNotice.svelte';
  import type { OrganizationWithRole } from '@logtide/shared';
  import Save from '@lucide/svelte/icons/save';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let token: string | null = null;
  let currentOrg = $state<OrganizationWithRole | null>(null);
  let saving = $state(false);
  let deleteOpen = $state(false);

  let orgName = $state('');
  let orgSlug = $state('');
  let orgDescription = $state('');
  let slugError = $state<string | null>(null);

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
  });

  const unsubOrgStore = organizationStore.subscribe((state) => {
    currentOrg = state.currentOrganization;
    if (currentOrg) {
      orgName = currentOrg.name;
      orgSlug = currentOrg.slug;
      orgDescription = currentOrg.description || '';
    }
  });

  onDestroy(() => {
    unsubAuthStore();
    unsubOrgStore();
  });

  onMount(() => {
    if (!token) {
      goto('/login');
      return;
    }
  });

  async function saveOrganization() {
    if (!currentOrg || !token) {
      toastStore.error('No organization selected');
      return;
    }

    if (currentOrg.role !== 'owner') {
      toastStore.error('Only the organization owner can update settings');
      return;
    }

    saving = true;
    slugError = null;
    try {
      const api = new OrganizationsAPI(() => token);
      const response = await api.updateOrganization(currentOrg.id, {
        name: orgName.trim(),
        slug: orgSlug,
        description: orgDescription || undefined,
      });

      organizationStore.updateOrganization(response.organization.id, response.organization);
      orgSlug = response.organization.slug;

      toastStore.success('Organization updated');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to update organization settings';
      if (errorMsg.toLowerCase().includes('slug')) {
        slugError = errorMsg;
      } else {
        toastStore.error(errorMsg);
      }
    } finally {
      saving = false;
    }
  }

  async function deleteOrganization() {
    if (!currentOrg || !token) return;

    if (currentOrg.role !== 'owner') {
      toastStore.error('Only the organization owner can delete the organization');
      return;
    }

    const orgId = currentOrg.id;
    try {
      const api = new OrganizationsAPI(() => token);
      await api.deleteOrganization(orgId);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete organization');
      // Rethrow so the dialog stays open for a retry.
      throw e;
    }

    organizationStore.removeOrganization(orgId);
    toastStore.success('Organization deleted');
    goto('/dashboard');
  }

  let isOwner = $derived(currentOrg?.role === 'owner');
</script>

<svelte:head>
  <title>General - LogTide</title>
</svelte:head>

<div class="space-y-8">
  <PageHeader
    title="General"
    appliesTo="organization"
    description="Name, URL slug and description of this organization."
  />

  {#if !isOwner}
    <ReadOnlyNotice requiredRole="owner" what="the organization name, URL slug and description" />
  {/if}

  <SettingsSection title="Organization information" description="Update your organization details">
    <form onsubmit={(e) => { e.preventDefault(); saveOrganization(); }} class="space-y-4">
      <div class="space-y-2">
        <Label for="org-name">Organization name</Label>
        <Input
          id="org-name"
          type="text"
          placeholder="My organization"
          bind:value={orgName}
          disabled={saving || !isOwner}
          required
        />
      </div>

      <div class="space-y-2">
        <Label for="org-slug">URL slug</Label>
        <Input
          id="org-slug"
          type="text"
          bind:value={orgSlug}
          disabled={saving || !isOwner}
        />
        <p class="text-sm text-muted-foreground">
          Used in URLs like <code>/status/{orgSlug || 'your-slug'}/...</code>. Changing this breaks any existing status-page links and embed badges.
        </p>
        {#if slugError}
          <p class="text-sm text-destructive-text">{slugError}</p>
        {/if}
      </div>

      <div class="space-y-2">
        <Label for="org-description">Description</Label>
        <Textarea
          id="org-description"
          placeholder="A brief description of your organization"
          bind:value={orgDescription}
          disabled={saving || !isOwner}
          rows={3}
        />
      </div>

      <Button type="submit" disabled={saving || !isOwner} class="gap-2">
        <Save class="w-4 h-4" aria-hidden="true" />
        {saving ? 'Saving...' : 'Save changes'}
      </Button>
    </form>
  </SettingsSection>

  <SettingsSection title="Log retention policy" description="How long logs are retained for this organization">
    <div class="space-y-4">
      <div class="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
        <div class="flex-1">
          <div class="text-2xl font-bold">
            {#if currentOrg?.retentionDays != null}
              {currentOrg.retentionDays} days
            {:else}
              <span class="text-muted-foreground">...</span>
            {/if}
          </div>
          <p class="text-sm text-muted-foreground">
            Logs older than this will be automatically deleted
          </p>
        </div>
      </div>
      <p class="text-sm text-muted-foreground">
        The log retention policy is configured by your system administrator.
        Contact your admin if you need to change this setting.
      </p>
    </div>
  </SettingsSection>

  {#if isOwner}
    <p class="text-sm text-muted-foreground" data-testid="transfer-pointer">
      To hand the organization to someone else, use Transfer ownership on the
      <a href="/dashboard/settings/members" class="text-primary hover:underline">Members page</a>.
    </p>

    <DangerZone>
      <div class="flex items-start justify-between gap-4">
        <div>
          <h3 class="font-medium mb-1">Delete organization</h3>
          <p class="text-sm text-muted-foreground">
            Permanently delete this organization and all associated projects and logs. This action cannot be undone.
          </p>
        </div>
        <Button variant="destructive" class="gap-2 flex-shrink-0" onclick={() => (deleteOpen = true)}>
          <Trash2 class="w-4 h-4" aria-hidden="true" />
          Delete organization
        </Button>
      </div>
    </DangerZone>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete organization"
  description="This permanently deletes all projects, logs and data in this organization, and every member loses access. This cannot be undone."
  confirmLabel="Delete organization"
  requireText={currentOrg?.name}
  onConfirm={deleteOrganization}
/>
