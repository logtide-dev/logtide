<script lang="ts">
  import { authStore } from '$lib/stores/auth';
  import { toastStore } from '$lib/stores/toast';
  import { onboardingStore } from '$lib/stores/onboarding';
  import { UsersAPI } from '$lib/api/users';
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import DialogContent from '$lib/components/ui/dialog/dialog-content.svelte';
  import DialogDescription from '$lib/components/ui/dialog/dialog-description.svelte';
  import DialogFooter from '$lib/components/ui/dialog/dialog-footer.svelte';
  import DialogHeader from '$lib/components/ui/dialog/dialog-header.svelte';
  import DialogTitle from '$lib/components/ui/dialog/dialog-title.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Separator } from '$lib/components/ui/separator';
  import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from '$lib/components/ui/alert-dialog';
  import Save from '@lucide/svelte/icons/save';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { goto } from '$app/navigation';

  const Dialog = DialogPrimitive.Root;
  const DialogTrigger = DialogPrimitive.Trigger;

  interface Props {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  let { open = $bindable(false), onOpenChange }: Props = $props();

  let user = $state<any>(null);
  let token = $state<string | null>(null);
  let saving = $state(false);
  let deleting = $state(false);
  let showDeleteDialog = $state(false);

  let name = $state('');
  let email = $state('');

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');

  let deletePassword = $state('');

  authStore.subscribe((state) => {
    user = state.user;
    token = state.token;
    if (user) {
      name = user.name || '';
      email = user.email || '';
    }
  });

  $effect(() => {
    if (onOpenChange) {
      onOpenChange(open);
    }
  });

  async function saveProfile() {
    if (!token) {
      toastStore.error('Not authenticated');
      return;
    }

    if (newPassword || confirmPassword || currentPassword) {
      if (!currentPassword) {
        toastStore.error('Current password is required to change password');
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
    }

    saving = true;
    try {
      const api = new UsersAPI(() => token);
      const response = await api.updateCurrentUser({
        name,
        email,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });

      authStore.updateUser(response.user);

      toastStore.success('Profile updated successfully');

      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to update profile';
      toastStore.error(errorMsg);
    } finally {
      saving = false;
    }
  }

  async function deleteAccount() {
    if (!token) {
      toastStore.error('Not authenticated');
      return;
    }

    if (!deletePassword) {
      toastStore.error('Password is required to delete account');
      return;
    }

    deleting = true;
    try {
      const api = new UsersAPI(() => token);
      await api.deleteCurrentUser({ password: deletePassword });

      toastStore.success('Account deleted successfully');
      authStore.clearAuth();
      goto('/login');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to delete account';
      toastStore.error(errorMsg);
    } finally {
      deleting = false;
      showDeleteDialog = false;
      deletePassword = '';
    }
  }

  function restartTutorial() {
    onboardingStore.reset();
    open = false;
    toastStore.success('Tutorial restarted! Redirecting...');
    goto('/onboarding');
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-2xl max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>User Settings</DialogTitle>
      <DialogDescription>Manage your account settings and preferences</DialogDescription>
    </DialogHeader>

    <div class="space-y-6 py-4">
      <div class="space-y-4">
        <h3 class="text-lg font-semibold">Profile Information</h3>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="name">Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="Your name"
              bind:value={name}
              disabled={saving}
              required
            />
          </div>

          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              bind:value={email}
              disabled={saving}
              required
            />
          </div>
        </div>
      </div>

      <Separator />

      <div class="space-y-4">
        <h3 class="text-lg font-semibold">Change Password</h3>
        <p class="text-sm text-muted-foreground">Leave blank to keep current password</p>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="current-password">Current Password</Label>
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
            <Label for="new-password">New Password</Label>
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
            <Label for="confirm-password">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Confirm new password"
              bind:value={confirmPassword}
              disabled={saving}
              autocomplete="new-password"
            />
          </div>
        </div>
      </div>

      <Separator />

      <Button onclick={saveProfile} disabled={saving} class="gap-2 w-full">
        <Save class="w-4 h-4" />
        {saving ? 'Saving...' : 'Save Changes'}
      </Button>

      <Separator />

      <div class="space-y-4">
        <div>
          <h3 class="text-lg font-semibold">Onboarding Tutorial</h3>
          <p class="text-sm text-muted-foreground mt-1">
            Restart the onboarding tutorial to learn about LogTide features
          </p>
        </div>

        <Button
          variant="outline"
          onclick={restartTutorial}
          class="gap-2 w-full"
        >
          <RotateCcw class="w-4 h-4" />
          Restart Tutorial
        </Button>
      </div>

      <Separator />

      <div class="space-y-4">
        <div>
          <h3 class="text-lg font-semibold text-destructive">Danger Zone</h3>
          <p class="text-sm text-muted-foreground mt-1">
            Permanently delete your account and all associated data
          </p>
        </div>

        <Button
          variant="destructive"
          onclick={() => (showDeleteDialog = true)}
          class="gap-2 w-full"
        >
          <Trash2 class="w-4 h-4" />
          Delete Account
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>

<AlertDialog bind:open={showDeleteDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Account?</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete your account? This will permanently delete:
        <ul class="list-disc list-inside mt-2 space-y-1">
          <li>Your profile and settings</li>
          <li>All organizations you own</li>
          <li>All projects and logs in those organizations</li>
          <li>Your access to shared organizations</li>
        </ul>
        <p class="mt-4 font-semibold text-destructive">This action cannot be undone!</p>
      </AlertDialogDescription>
    </AlertDialogHeader>

    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="delete-password">Confirm your password</Label>
        <Input
          id="delete-password"
          type="password"
          placeholder="Enter your password to confirm"
          bind:value={deletePassword}
          disabled={deleting}
          autocomplete="current-password"
        />
      </div>
    </div>

    <AlertDialogFooter>
      <Button
        variant="outline"
        onclick={() => {
          showDeleteDialog = false;
          deletePassword = '';
        }}
        disabled={deleting}
      >
        Cancel
      </Button>
      <Button variant="destructive" onclick={deleteAccount} disabled={deleting || !deletePassword}>
        {deleting ? 'Deleting...' : 'Delete Account'}
      </Button>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
