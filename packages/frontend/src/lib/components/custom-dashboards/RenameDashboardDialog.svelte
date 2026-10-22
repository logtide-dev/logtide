<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';

  interface Props {
    open: boolean;
    name: string;
    description: string | null;
    onSave: (input: { name: string; description: string | null }) => void | Promise<void>;
    onOpenChange: (open: boolean) => void;
  }

  let { open = $bindable(), name, description, onSave, onOpenChange }: Props = $props();

  let draftName = $state('');
  let draftDescription = $state('');
  let saving = $state(false);

  // Each time the dialog opens it starts from the current values.
  $effect(() => {
    if (open) {
      draftName = name;
      draftDescription = description ?? '';
    }
  });

  const canSave = $derived(draftName.trim().length > 0 && !saving);

  async function handleSave() {
    if (!canSave) return;
    saving = true;
    try {
      await onSave({
        name: draftName.trim(),
        description: draftDescription.trim() || null,
      });
      onOpenChange(false);
    } catch {
      // The owner reports the failure; the dialog stays open for a retry.
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => onOpenChange(o)}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Rename dashboard</Dialog.Title>
      <Dialog.Description>Change the name and description of this dashboard.</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-2">
      <div class="space-y-1.5">
        <Label for="rd-name">Name</Label>
        <Input
          id="rd-name"
          type="text"
          maxlength={200}
          value={draftName}
          oninput={(e) => (draftName = (e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="space-y-1.5">
        <Label for="rd-desc">Description (optional)</Label>
        <Textarea
          id="rd-desc"
          rows={2}
          value={draftDescription}
          oninput={(e) => (draftDescription = (e.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!canSave} onclick={handleSave}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
