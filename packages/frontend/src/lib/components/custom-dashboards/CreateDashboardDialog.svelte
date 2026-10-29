<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';

  interface Props {
    open: boolean;
    onCreate: (input: { name: string; description?: string; isPersonal: boolean }) => void;
    onOpenChange: (open: boolean) => void;
  }

  let { open = $bindable(), onCreate, onOpenChange }: Props = $props();

  let name = $state('');
  let description = $state('');
  let isPersonal = $state(false);

  function reset() {
    name = '';
    description = '';
    isPersonal = false;
  }

  function handleCreate() {
    if (name.trim().length === 0) return;
    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      isPersonal,
    });
    reset();
    onOpenChange(false);
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(o) => {
    if (!o) reset();
    onOpenChange(o);
  }}
>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>New dashboard</Dialog.Title>
      <Dialog.Description>
        Create a new empty dashboard. You can add panels after it's created.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4 py-2">
      <div class="space-y-1.5">
        <Label for="cd-name">Name</Label>
        <Input
          id="cd-name"
          type="text"
          placeholder="e.g. Backend overview"
          value={name}
          oninput={(e) => (name = (e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="space-y-1.5">
        <Label for="cd-desc">Description (optional)</Label>
        <Textarea
          id="cd-desc"
          rows={2}
          value={description}
          oninput={(e) => (description = (e.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPersonal}
          onchange={(e) => (isPersonal = (e.currentTarget as HTMLInputElement).checked)}
          class="h-4 w-4"
        />
        <span>Personal - only visible to me</span>
      </label>
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={name.trim().length === 0} onclick={handleCreate}>Create dashboard</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
