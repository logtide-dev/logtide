<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import ProjectSelect from './pickers/ProjectSelect.svelte';
  import type { DashboardTemplateSummary } from '$lib/api/custom-dashboards';

  interface Props {
    open: boolean;
    templates: DashboardTemplateSummary[];
    loading: boolean;
    /** Set when loading the templates failed. */
    error?: string | null;
    onCreate: (input: {
      templateId: string;
      name?: string;
      projectId: string | null;
    }) => void | Promise<void>;
    /** Called when the dialog opens so the owner can load the templates. */
    onOpen?: () => void;
    onOpenChange: (open: boolean) => void;
  }

  let {
    open = $bindable(),
    templates,
    loading,
    error = null,
    onCreate,
    onOpen,
    onOpenChange,
  }: Props = $props();

  let selectedId = $state<string | null>(null);
  let name = $state('');
  let projectId = $state<string | null>(null);
  let submitting = $state(false);
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) {
      selectedId = null;
      name = '';
      projectId = null;
      onOpen?.();
    }
    wasOpen = open;
  });

  const selected = $derived(templates.find((t) => t.id === selectedId) ?? null);

  async function handleCreate() {
    if (!selected || submitting) return;
    submitting = true;
    try {
      await onCreate({
        templateId: selected.id,
        name: name.trim() || undefined,
        projectId,
      });
      onOpenChange(false);
    } catch {
      // The owner reports the failure; the dialog stays open for a retry.
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => onOpenChange(o)}>
  <Dialog.Content class="max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Create from template</Dialog.Title>
      <Dialog.Description>
        Start from a ready-made dashboard. You can change every panel afterwards.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-2 max-h-[60vh] overflow-y-auto" data-dialog-scroll-body>
      {#if loading}
        <div class="grid gap-3 sm:grid-cols-2" data-testid="templates-loading">
          {#each Array(4) as _, i (i)}
            <Skeleton class="h-24 w-full rounded-lg" />
          {/each}
        </div>
      {:else if error}
        <p role="alert" class="text-sm text-destructive-text">{error}</p>
      {:else if templates.length === 0}
        <p class="text-sm text-muted-foreground">No templates available.</p>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Template">
          {#each templates as template (template.id)}
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === template.id}
              class="rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedId ===
              template.id
                ? 'border-primary bg-accent'
                : 'border-border'}"
              onclick={() => (selectedId = template.id)}
            >
              <span class="block text-sm font-medium">{template.name}</span>
              <span class="mt-1 block text-xs text-muted-foreground">{template.description}</span>
              <span class="mt-2 block text-xs text-muted-foreground">
                {template.panelCount.toLocaleString('en-US')}
                {template.panelCount === 1 ? 'panel' : 'panels'}
              </span>
            </button>
          {/each}
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="cft-project">Project</Label>
            <ProjectSelect id="cft-project" value={projectId} onChange={(v) => (projectId = v)} />
          </div>
          <div class="space-y-1.5">
            <Label for="cft-name">Name (optional)</Label>
            <Input
              id="cft-name"
              type="text"
              maxlength={200}
              placeholder={selected?.name ?? 'Template name'}
              value={name}
              oninput={(e) => (name = (e.currentTarget as HTMLInputElement).value)}
            />
          </div>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!selected || submitting} onclick={handleCreate}>Create dashboard</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
