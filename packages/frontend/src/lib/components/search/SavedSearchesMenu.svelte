<script lang="ts">
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus';
  import Save from '@lucide/svelte/icons/save';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Users from '@lucide/svelte/icons/users';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import * as Popover from '$lib/components/ui/popover';
  import Button from '$lib/components/ui/button/button.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import SaveSearchDialog from './SaveSearchDialog.svelte';
  import { toastStore } from '$lib/stores/toast';
  import {
    savedSearchesAPI,
    type SavedSearch,
    type SavedSearchInput,
    type SavedSearchState,
    type SavedSearchVisibility,
  } from '$lib/api/saved-searches';

  interface Props {
    organizationId: string;
    currentUserId: string | null;
    currentState: SavedSearchState;
    openSavedId: string | null;
    onOpen: (saved: SavedSearch) => void;
    /** A search was created or the open one was updated with the current state. */
    onSaved: (saved: SavedSearch) => void;
    /** A search was deleted (the page drops `saved` when it was the open one). */
    onDeleted?: (id: string) => void;
  }

  let { organizationId, currentUserId, currentState, openSavedId, onOpen, onSaved, onDeleted }: Props =
    $props();

  let menuOpen = $state(false);
  let searches = $state<SavedSearch[]>([]);
  let loading = $state(false);
  let loadError = $state(false);
  let loadedFor = $state<string | null>(null);
  let loadSeq = 0;

  let dialogOpen = $state(false);
  let dialogMode = $state<'create' | 'rename'>('create');
  let renameTarget = $state<SavedSearch | null>(null);
  let busy = $state(false);

  let confirmOpen = $state(false);
  let deleteTarget = $state<SavedSearch | null>(null);

  const isMine = (s: SavedSearch) => currentUserId !== null && s.createdBy === currentUserId;
  const mine = $derived(searches.filter(isMine));
  const others = $derived(searches.filter((s) => !isMine(s)));
  const openSaved = $derived(
    openSavedId ? (searches.find((s) => s.id === openSavedId && s.canEdit) ?? null) : null,
  );

  const errorMessage = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

  async function load() {
    const seq = ++loadSeq;
    const org = organizationId;
    loading = true;
    loadError = false;
    try {
      const list = await savedSearchesAPI.list(org);
      if (seq !== loadSeq) return;
      searches = list;
      loadedFor = org;
    } catch {
      if (seq !== loadSeq) return;
      loadError = true;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  // Another organization: forget the list, load again on the next open.
  $effect(() => {
    if (loadedFor !== null && loadedFor !== organizationId) {
      loadSeq++;
      searches = [];
      loadedFor = null;
      loadError = false;
      loading = false;
    }
  });

  function setMenuOpen(next: boolean) {
    menuOpen = next;
    if (next && loadedFor !== organizationId && !loading) void load();
  }

  function open(saved: SavedSearch) {
    menuOpen = false;
    onOpen(saved);
  }

  function startCreate() {
    menuOpen = false;
    dialogMode = 'create';
    renameTarget = null;
    dialogOpen = true;
  }

  function startRename(saved: SavedSearch) {
    menuOpen = false;
    dialogMode = 'rename';
    renameTarget = saved;
    dialogOpen = true;
  }

  function startDelete(saved: SavedSearch) {
    menuOpen = false;
    deleteTarget = saved;
    confirmOpen = true;
  }

  async function submitDialog(input: { name: string; visibility: SavedSearchVisibility }) {
    if (busy) return;
    busy = true;
    try {
      if (dialogMode === 'create') {
        const created = await savedSearchesAPI.create(organizationId, {
          name: input.name,
          visibility: input.visibility,
          state: currentState,
        });
        toastStore.success('Search saved');
        dialogOpen = false;
        onSaved(created);
      } else if (renameTarget) {
        const patch: Partial<SavedSearchInput> = { name: input.name };
        if (isMine(renameTarget)) patch.visibility = input.visibility;
        await savedSearchesAPI.update(renameTarget.id, organizationId, patch);
        toastStore.success('Search renamed');
        dialogOpen = false;
      }
      void load();
    } catch (err) {
      toastStore.error(errorMessage(err, 'Could not save the search'));
    } finally {
      busy = false;
    }
  }

  async function updateOpen() {
    const target = openSaved;
    if (!target || busy) return;
    menuOpen = false;
    busy = true;
    try {
      const updated = await savedSearchesAPI.update(target.id, organizationId, { state: currentState });
      toastStore.success('Search updated');
      onSaved(updated);
      void load();
    } catch (err) {
      toastStore.error(errorMessage(err, 'Could not update the search'));
    } finally {
      busy = false;
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    try {
      await savedSearchesAPI.remove(target.id, organizationId);
    } catch (err) {
      toastStore.error(errorMessage(err, 'Could not delete the search'));
      // keeps the confirmation open so the user can retry or cancel
      throw err;
    }
    toastStore.success('Search deleted');
    onDeleted?.(target.id);
    void load();
  }
</script>

{#snippet row(saved: SavedSearch, showCreator: boolean)}
  <li class="group flex items-center gap-1">
    <button
      type="button"
      class="flex min-w-0 flex-1 flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none aria-[current=true]:bg-accent/60"
      aria-current={saved.id === openSavedId ? 'true' : undefined}
      title={saved.state.q || saved.name}
      onclick={() => open(saved)}
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate font-medium">{saved.name}</span>
        {#if !showCreator && saved.visibility === 'organization'}
          <span class="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
            <Users class="size-3" aria-hidden="true" />
            Shared
          </span>
        {/if}
      </span>
      {#if showCreator && saved.createdByName}
        <span class="truncate text-xs text-muted-foreground">by {saved.createdByName}</span>
      {/if}
    </button>
    {#if saved.canEdit}
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0"
        aria-label="Rename {saved.name}"
        title="Rename"
        onclick={() => startRename(saved)}
      >
        <Pencil class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Delete {saved.name}"
        title="Delete"
        onclick={() => startDelete(saved)}
      >
        <Trash2 class="size-3.5" />
      </Button>
    {/if}
  </li>
{/snippet}

<Popover.Root bind:open={() => menuOpen, setMenuOpen}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm" class="gap-1.5">
        <Bookmark class="size-4" aria-hidden="true" />
        <span class="sr-only md:not-sr-only">Saved searches</span>
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-80 p-1" align="end">
    <div class="flex flex-col gap-0.5 border-b p-1 pb-1.5">
      <Button variant="ghost" size="sm" class="justify-start gap-1.5" onclick={startCreate}>
        <BookmarkPlus class="size-4" aria-hidden="true" />
        Save search
      </Button>
      {#if openSaved}
        <Button
          variant="ghost"
          size="sm"
          class="justify-start gap-1.5"
          disabled={busy}
          title="Replace the saved state with the current query, scope and columns"
          onclick={updateOpen}
        >
          <Save class="size-4" aria-hidden="true" />
          <span class="truncate">Update "{openSaved.name}"</span>
        </Button>
      {/if}
    </div>

    <div class="max-h-80 overflow-y-auto p-1">
      {#if loading && loadedFor !== organizationId}
        <p class="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground" role="status">
          <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
          Loading saved searches
        </p>
      {:else if loadError && loadedFor !== organizationId}
        <div class="flex items-center justify-between gap-2 px-2 py-2 text-sm">
          <span class="text-muted-foreground">Could not load saved searches</span>
          <Button variant="outline" size="sm" onclick={() => load()}>Retry</Button>
        </div>
      {:else if searches.length === 0}
        <p class="px-2 py-3 text-sm text-muted-foreground">No saved searches yet</p>
      {:else}
        {#if mine.length > 0}
          <section aria-label="Your searches" class="py-1">
            <h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">Your searches</h3>
            <ul class="flex flex-col">
              {#each mine as saved (saved.id)}
                {@render row(saved, false)}
              {/each}
            </ul>
          </section>
        {/if}
        {#if others.length > 0}
          <section aria-label="Organization" class="py-1">
            <h3 class="px-2 pb-1 text-xs font-medium text-muted-foreground">Organization</h3>
            <ul class="flex flex-col">
              {#each others as saved (saved.id)}
                {@render row(saved, true)}
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>

<SaveSearchDialog
  bind:open={dialogOpen}
  mode={dialogMode}
  initialName={dialogMode === 'rename' ? (renameTarget?.name ?? '') : ''}
  initialVisibility={dialogMode === 'rename' ? (renameTarget?.visibility ?? 'private') : 'private'}
  showVisibility={dialogMode === 'create' || (renameTarget !== null && isMine(renameTarget))}
  {busy}
  onSubmit={submitDialog}
/>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete saved search"
  description={deleteTarget ? `"${deleteTarget.name}" will be removed for everyone who can see it.` : undefined}
  confirmLabel="Delete"
  onConfirm={confirmDelete}
/>
