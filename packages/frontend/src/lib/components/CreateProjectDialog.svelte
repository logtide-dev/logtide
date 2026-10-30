<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Spinner from './Spinner.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import { checklistStore } from '$lib/stores/checklist';

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
      checklistStore.completeItem('create-project');

      name = '';
      description = '';
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create project';
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    if (!open) {
      error = '';
    }
  });
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[500px]">
    <DialogHeader>
      <DialogTitle>Create project</DialogTitle>
      <DialogDescription>
        Create a project to organize your logs, traces and metrics.
      </DialogDescription>
    </DialogHeader>

    <form onsubmit={handleSubmit} class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="project-name">Project name</Label>
        <Input
          id="project-name"
          type="text"
          placeholder="My project"
          bind:value={name}
          disabled={submitting}
          required
          autofocus
        />
      </div>

      <div class="space-y-2">
        <Label for="project-description">Description (optional)</Label>
        <Textarea
          id="project-description"
          placeholder="A brief description of your project"
          bind:value={description}
          disabled={submitting}
          rows={3}
        />
      </div>

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
          disabled={submitting || !name.trim()}
          class="gap-2"
        >
          {#if submitting}
            <Spinner size="sm" />
            Creating...
          {:else}
            <Plus class="w-4 h-4" />
            Create project
          {/if}
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
