<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import type { SavedSearchVisibility } from '$lib/api/saved-searches';

  const NAME_MAX = 100;

  interface Props {
    open: boolean;
    mode: 'create' | 'rename';
    initialName?: string;
    initialVisibility?: SavedSearchVisibility;
    /** Only the creator of a search may change who sees it. */
    showVisibility?: boolean;
    busy?: boolean;
    onSubmit: (input: { name: string; visibility: SavedSearchVisibility }) => void | Promise<void>;
  }

  let {
    open = $bindable(false),
    mode,
    initialName = '',
    initialVisibility = 'private',
    showVisibility = true,
    busy = false,
    onSubmit,
  }: Props = $props();

  let name = $state('');
  let visibility = $state<SavedSearchVisibility>('private');
  let wasOpen = false;

  const uid = $props.id();
  const nameId = `save-search-name-${uid}`;
  const trimmed = $derived(name.trim());
  const valid = $derived(trimmed.length > 0 && trimmed.length <= NAME_MAX);

  // Every opening starts from the initial values.
  $effect.pre(() => {
    if (open && !wasOpen) {
      name = initialName;
      visibility = initialVisibility;
    }
    wasOpen = open;
  });

  function setOpen(next: boolean) {
    // Escape and overlay clicks must not drop an in-flight save.
    if (!next && busy) return;
    open = next;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    void onSubmit({ name: trimmed, visibility });
  }

  const title = $derived(mode === 'create' ? 'Save search' : 'Rename saved search');
  const submitLabel = $derived(mode === 'create' ? 'Save' : 'Rename');
</script>

<Dialog.Root bind:open={() => open, setOpen}>
  <Dialog.Content class="max-w-md">
    <form class="space-y-4" onsubmit={submit}>
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
        {#if mode === 'create'}
          <Dialog.Description>
            Saves the current query, projects, time range, view and columns.
          </Dialog.Description>
        {/if}
      </Dialog.Header>

      <div class="space-y-1.5">
        <Label for={nameId}>Name</Label>
        <Input
          id={nameId}
          bind:value={name}
          maxlength={NAME_MAX}
          autocomplete="off"
          placeholder="e.g. Checkout errors"
          disabled={busy}
          required
        />
      </div>

      {#if showVisibility}
        <fieldset class="space-y-2" disabled={busy}>
          <legend class="text-sm font-medium">Visibility</legend>
          <label class="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary">
            <input type="radio" class="mt-0.5" name="visibility-{uid}" value="private" bind:group={visibility} />
            <span>
              <span class="block font-medium">Private</span>
              <span class="block text-xs text-muted-foreground">Only you can see it</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm has-[:checked]:border-primary">
            <input type="radio" class="mt-0.5" name="visibility-{uid}" value="organization" bind:group={visibility} />
            <span>
              <span class="block font-medium">Organization</span>
              <span class="block text-xs text-muted-foreground">Everyone in the organization can see it</span>
            </span>
          </label>
        </fieldset>
      {/if}

      <Dialog.Footer>
        <Button type="button" variant="outline" disabled={busy} onclick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" disabled={!valid || busy}>
          {#if busy}
            <LoaderCircle class="animate-spin" aria-hidden="true" />
          {/if}
          {submitLabel}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
