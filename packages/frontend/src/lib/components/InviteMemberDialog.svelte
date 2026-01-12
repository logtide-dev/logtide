<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
    import Spinner from './Spinner.svelte';
  import UserPlus from '@lucide/svelte/icons/user-plus';
  import Mail from '@lucide/svelte/icons/mail';
  import type { OrgRole } from '@logtide/shared';

  interface Props {
    onSubmit: (data: { email: string; role: OrgRole }) => Promise<{ type: 'direct_add' | 'email_sent'; message: string }>;
    open?: boolean;
  }

  let { onSubmit, open = $bindable(false) }: Props = $props();
  let email = $state('');
  let role = $state<OrgRole>('member');
  let submitting = $state(false);
  let error = $state('');
  let successMessage = $state('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';
    successMessage = '';

    submitting = true;
    try {
      const result = await onSubmit({
        email: email.trim().toLowerCase(),
        role,
      });

      successMessage = result.message;

      // Reset form after short delay to show success
      setTimeout(() => {
        email = '';
        role = 'member';
        successMessage = '';
        open = false;
      }, 2000);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to invite member';
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    if (!open) {
      error = '';
      successMessage = '';
    }
  });

</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[500px]">
    <DialogHeader>
      <DialogTitle class="flex items-center gap-2">
        <UserPlus class="w-5 h-5" />
        Invite Team Member
      </DialogTitle>
      <DialogDescription>
        Invite someone to join your organization. They'll receive a notification and can accept the invitation when ready.
      </DialogDescription>
    </DialogHeader>

    <form onsubmit={handleSubmit} class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="member-email">Email Address</Label>
        <div class="relative">
          <Mail class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            id="member-email"
            type="email"
            placeholder="colleague@logtide.dev"
            bind:value={email}
            disabled={submitting || !!successMessage}
            required
            autofocus
            class="pl-10"
          />
        </div>
      </div>

      <div class="space-y-2">
        <Label for="member-role">Role</Label>
        <select
          id="member-role"
          bind:value={role}
          disabled={submitting || !!successMessage}
          class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <p class="text-xs text-muted-foreground">
          {#if role === 'admin'}
            Admins can invite members, manage roles, and remove members (except the owner).
          {:else}
            Members can view and use all organization resources but cannot manage team settings.
          {/if}
        </p>
      </div>

      {#if error}
        <div class="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
          {error}
        </div>
      {/if}

      {#if successMessage}
        <div class="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 p-3 rounded-md">
          {successMessage}
        </div>
      {/if}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onclick={() => open = false}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting || !email.trim() || !!successMessage}
          class="gap-2"
        >
          {#if submitting}
            <Spinner size="sm" />
            Inviting...
          {:else}
            <UserPlus class="w-4 h-4" />
            Send Invitation
          {/if}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
