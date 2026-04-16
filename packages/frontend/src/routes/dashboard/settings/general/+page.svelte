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
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from '$lib/components/ui/alert-dialog';
  import type { OrganizationWithRole } from '@logtide/shared';
  import Save from '@lucide/svelte/icons/save';
  import Clock from '@lucide/svelte/icons/clock';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let user: any = null;
  let token: string | null = null;
  let currentOrg = $state<OrganizationWithRole | null>(null);
  let saving = $state(false);
  let deleting = $state(false);

  let orgName = $state('');
  let orgSlug = $state('');
  let orgDescription = $state('');

  const unsubAuthStore = authStore.subscribe((state) => {
    user = state.user;
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
    try {
      const api = new OrganizationsAPI(() => token);
      const response = await api.updateOrganization(currentOrg.id, {
        name: orgName,
        description: orgDescription || undefined,
      });

      organizationStore.updateOrganization(response.organization.id, response.organization);
      orgSlug = response.organization.slug;

      toastStore.success('Organization settings updated successfully');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to update organization settings';
      toastStore.error(errorMsg);
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

    deleting = true;
    try {
      const api = new OrganizationsAPI(() => token);
      await api.deleteOrganization(currentOrg.id);

      organizationStore.removeOrganization(currentOrg.id);

      toastStore.success('Organization deleted successfully');
      goto('/dashboard');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to delete organization';
      toastStore.error(errorMsg);
    } finally {
      deleting = false;
    }
  }

  let isOwner = $derived(currentOrg?.role === 'owner');
</script>

<svelte:head>
  <title>Organization Settings - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <Card>
    <CardHeader>
      <CardTitle>Organization Information</CardTitle>
      <CardDescription>Update your organization details</CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={(e) => { e.preventDefault(); saveOrganization(); }} class="space-y-4">
        <div class="space-y-2">
          <Label for="org-name">Organization Name</Label>
          <Input
            id="org-name"
            type="text"
            placeholder="My Organization"
            bind:value={orgName}
            disabled={saving || !isOwner}
            required
          />
          {#if !isOwner}
            <p class="text-sm text-muted-foreground">Only the owner can edit the organization name</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="org-slug">Slug (URL-friendly identifier)</Label>
          <Input
            id="org-slug"
            type="text"
            value={orgSlug}
            disabled
            class="bg-muted"
          />
          <p class="text-sm text-muted-foreground">
            Auto-generated from organization name. This cannot be edited manually.
          </p>
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

        <Separator />

        <Button type="submit" disabled={saving || !isOwner} class="gap-2">
          <Save class="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <div class="flex items-center gap-2">
        <Clock class="w-5 h-5 text-primary" />
        <div>
          <CardTitle>Log Retention Policy</CardTitle>
          <CardDescription>How long logs are retained for this organization</CardDescription>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div class="space-y-4">
        <div class="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
          <div class="flex-1">
            <div class="text-2xl font-bold">{currentOrg?.retentionDays || 90} days</div>
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
    </CardContent>
  </Card>

  {#if isOwner}
    <Card class="border-destructive">
      <CardHeader>
        <CardTitle class="text-destructive">Danger Zone</CardTitle>
        <CardDescription>Irreversible and destructive actions</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-start justify-between gap-4">
          <div>
            <h4 class="font-medium mb-1">Delete Organization</h4>
            <p class="text-sm text-muted-foreground">
              Permanently delete this organization and all associated projects and logs. This action cannot be undone.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-10 px-4 py-2 flex-shrink-0">
              <Trash2 class="w-4 h-4" />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Organization?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete <strong>{currentOrg?.name}</strong>?
                  This will permanently delete:
                  <ul class="list-disc list-inside mt-2 space-y-1">
                    <li>All projects in this organization</li>
                    <li>All logs and data</li>
                    <li>All members will lose access</li>
                  </ul>
                  <p class="mt-4 font-semibold text-destructive">This action cannot be undone!</p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onclick={deleteOrganization}
                  class="bg-destructive hover:bg-destructive/90"
                >
                  {deleting ? 'Deleting...' : 'Delete Organization'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
