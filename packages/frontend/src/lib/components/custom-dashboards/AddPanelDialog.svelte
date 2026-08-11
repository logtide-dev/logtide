<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import { getAllPanelDefinitions, createPanelInstance } from './panel-registry';
  import type { PanelInstance, PanelType } from '@logtide/shared';

  interface Props {
    open: boolean;
    onAdd: (panel: PanelInstance) => void;
    onOpenChange: (open: boolean) => void;
  }

  let { open = $bindable(), onAdd, onOpenChange }: Props = $props();

  let selected = $state<PanelType | null>(null);

  const definitions = getAllPanelDefinitions();

  function handleAdd() {
    if (!selected) return;
    onAdd(createPanelInstance(selected));
    selected = null;
    onOpenChange(false);
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) selected = null; onOpenChange(o); }}>
  <Dialog.Content class="max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Add panel</Dialog.Title>
      <Dialog.Description>
        Choose a panel type to add to the dashboard. You can edit its settings after.
      </Dialog.Description>
    </Dialog.Header>

    <!-- The list grows with every new panel type, so it scrolls on its own and
         the footer actions stay reachable on short viewports. -->
    <div
      data-dialog-scroll-body
      class="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 max-h-[60vh] overflow-y-auto"
    >
      {#each definitions as def}
        {@const Icon = def.icon}
        <button
          type="button"
          class="text-left rounded-lg border p-4 transition-colors {selected === def.type ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-accent/30'}"
          onclick={() => (selected = def.type)}
        >
          <div class="flex items-center gap-2 mb-1">
            <Icon class="w-4 h-4 text-primary" />
            <h4 class="text-sm font-semibold">{def.label}</h4>
          </div>
          <p class="text-xs text-muted-foreground">{def.description}</p>
        </button>
      {/each}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!selected} onclick={handleAdd}>Add panel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
