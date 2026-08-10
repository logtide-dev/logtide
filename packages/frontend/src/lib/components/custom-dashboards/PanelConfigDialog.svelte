<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { PanelConfig, PanelInstance } from '@logtide/shared';
  import { getPanelDefinition } from './panel-registry';

  interface Props {
    open: boolean;
    panel: PanelInstance | null;
    onSave: (config: PanelConfig) => void;
    onOpenChange: (open: boolean) => void;
  }

  let { open = $bindable(), panel, onSave, onOpenChange }: Props = $props();

  // Local mutable copy so the user can cancel without affecting state
  let draft = $state<PanelConfig | null>(null);

  $effect(() => {
    if (panel) {
      draft = { ...panel.config };
    } else {
      draft = null;
    }
  });

  const def = $derived(panel ? getPanelDefinition(panel.config.type) : null);
  const FormComponent = $derived(def?.configForm);

  function handleSave() {
    if (draft) {
      onSave(draft);
      onOpenChange(false);
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => onOpenChange(o)}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Configure panel</Dialog.Title>
      <Dialog.Description>
        {def?.description ?? 'Adjust the panel settings.'}
      </Dialog.Description>
    </Dialog.Header>
    {#if FormComponent && draft}
      <!-- Config forms vary a lot in length (log_table is the tallest), so the
           form scrolls and Save/Cancel stay pinned. -->
      <div data-dialog-scroll-body class="py-2 max-h-[60vh] overflow-y-auto pr-1">
        <FormComponent
          config={draft as any}
          onChange={(updated: PanelConfig) => {
            draft = updated;
          }}
        />
      </div>
    {/if}
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button onclick={handleSave}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
