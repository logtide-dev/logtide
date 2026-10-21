<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { toastStore } from '$lib/stores/toast';
  import { UsersAPI } from '$lib/api/users';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import DangerZone from '$lib/components/app/DangerZone.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import Save from '@lucide/svelte/icons/save';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let token = $state<string | null>(null);
  let userEmail = $state('');
  let saving = $state(false);
  let showDeleteDialog = $state(false);

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let deletePassword = $state('');

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
    userEmail = state.user?.email || '';
  });

  onDestroy(() => {
    unsubAuthStore();
  });

  async function changePassword() {
    if (!token) {
      toastStore.error('Not authenticated');
      return;
    }
    if (!currentPassword) {
      toastStore.error('Current password is required');
      return;
    }
    if (!newPassword) {
      toastStore.error('New password is required');
      return;
    }
    if (newPassword !== confirmPassword) {
      toastStore.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toastStore.error('Password must be at least 8 characters');
      return;
    }

    saving = true;
    try {
      const api = new UsersAPI(() => token);
      await api.updateCurrentUser({ currentPassword, newPassword });
      toastStore.success('Password changed');
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      saving = false;
    }
  }

  async function deleteAccount() {
    if (!token) {
      toastStore.error('Not authenticated');
      throw new Error('Not authenticated');
    }
    try {
      const api = new UsersAPI(() => token);
      await api.deleteCurrentUser({ password: deletePassword });
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to delete account');
      throw e;
    }
    toastStore.success('Account deleted');
    deletePassword = '';
    authStore.clearAuth();
    goto('/login');
  }
</script>

<svelte:head>
  <title>Security - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Security"
    appliesTo="you"
    description="Change your password or delete your account."
  />

  <SettingsSection title="Change password" description="Use at least 8 characters">
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        changePassword();
      }}
    >
      <div class="space-y-2">
        <Label for="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          placeholder="Enter current password"
          bind:value={currentPassword}
          disabled={saving}
          autocomplete="current-password"
        />
      </div>
      <div class="space-y-2">
        <Label for="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          placeholder="Enter new password (min 8 characters)"
          bind:value={newPassword}
          disabled={saving}
          autocomplete="new-password"
        />
      </div>
      <div class="space-y-2">
        <Label for="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          placeholder="Confirm new password"
          bind:value={confirmPassword}
          disabled={saving}
          autocomplete="new-password"
        />
      </div>
      <Button type="submit" disabled={saving} class="gap-2">
        <Save class="w-4 h-4" aria-hidden="true" />
        {saving ? 'Saving...' : 'Change password'}
      </Button>
    </form>
  </SettingsSection>

  <DangerZone>
    <div class="space-y-1">
      <h3 class="font-medium">Delete account</h3>
      <p class="text-sm text-muted-foreground">
        Permanently delete your account, the organizations you own and everything in them.
      </p>
    </div>
    <div class="space-y-2">
      <Label for="delete-password">Confirm your password</Label>
      <Input
        id="delete-password"
        type="password"
        placeholder="Enter your password"
        bind:value={deletePassword}
        autocomplete="current-password"
      />
    </div>
    <Button
      variant="destructive"
      class="gap-2"
      disabled={!deletePassword}
      onclick={() => (showDeleteDialog = true)}
    >
      <Trash2 class="w-4 h-4" aria-hidden="true" />
      Delete account
    </Button>
  </DangerZone>
</div>

<ConfirmDialog
  bind:open={showDeleteDialog}
  title="Delete account"
  description="This permanently deletes your profile, all organizations you own with their projects and logs, and your access to shared organizations. This cannot be undone."
  confirmLabel="Delete account"
  requireText={userEmail}
  destructive
  onConfirm={deleteAccount}
/>
