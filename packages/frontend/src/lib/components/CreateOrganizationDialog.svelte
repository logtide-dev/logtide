<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Spinner from './Spinner.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import { checklistStore } from '$lib/stores/checklist';
  import { organizationsAPI } from '$lib/api/organizations';
  import {
    organizationLimitLines,
    organizationLimitMessage,
    type UserOrganizationLimits,
  } from '$lib/utils/limits';

  interface Props {
    onSubmit: (data: { name: string; description?: string }) => Promise<void>;
    open?: boolean;
  }

  let { onSubmit, open = $bindable(false) }: Props = $props();
  let name = $state('');
  let description = $state('');
  let submitting = $state(false);
  let error = $state('');

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    submitting = true;
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
      });

      // Mark checklist item as complete
      checklistStore.completeItem('create-organization');

      name = '';
      description = '';
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create organization';
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    if (!open) {
      error = '';
    }
  });

  // Where the user stands against their organization limits, loaded each
  // time the dialog opens. Advisory: when it cannot be loaded the form works
  // as before and the server still enforces the limits.
  let limits = $state<UserOrganizationLimits | null>(null);

  $effect(() => {
    if (!open) return;
    let cancelled = false;
    organizationsAPI
      .getLimits()
      .then((res) => {
        if (!cancelled) limits = res?.limits ?? null;
      })
      .catch(() => {
        if (!cancelled) limits = null;
      });
    return () => {
      cancelled = true;
    };
  });

  const limitLines = $derived(organizationLimitLines(limits));
  const blockedMessage = $derived(organizationLimitMessage(limits));
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[500px]">
    <DialogHeader>
      <DialogTitle>Create organization</DialogTitle>
      <DialogDescription>
        Create a new organization to group your projects and manage team access.
      </DialogDescription>
    </DialogHeader>

    <form onsubmit={handleSubmit} class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="org-name">Organization name</Label>
        <Input
          id="org-name"
          type="text"
          placeholder="My Company"
          bind:value={name}
          disabled={submitting}
          required
          autofocus
        />
        <p class="text-xs text-muted-foreground">
          A URL-friendly identifier will be automatically generated from the name.
        </p>
      </div>

      <div class="space-y-2">
        <Label for="org-description">Description (optional)</Label>
        <Textarea
          id="org-description"
          placeholder="A brief description of your organization"
          bind:value={description}
          disabled={submitting}
          rows={3}
        />
      </div>

      {#if blockedMessage}
        <div
          class="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
          role="status"
          data-testid="org-limit-reached"
        >
          {blockedMessage}
        </div>
      {:else if limitLines.length > 0}
        <p class="text-xs text-muted-foreground" data-testid="org-limit-usage">
          {limitLines.join(' ')}
        </p>
      {/if}

      {#if error}
        <div class="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
          {error}
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
          disabled={submitting || !name.trim() || blockedMessage !== null}
          class="gap-2"
        >
          {#if submitting}
            <Spinner size="sm" />
            Creating...
          {:else}
            <Plus class="w-4 h-4" />
            Create organization
          {/if}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
