<script lang="ts" module>
  export interface PickedOrg {
    id: string;
    name: string;
    slug: string;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { adminAPI } from '$lib/api/admin';
  import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
  import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
  } from '$lib/components/ui/command';
  import Building2 from '@lucide/svelte/icons/building-2';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { formatCount } from '$lib/utils/format-number';
  import { createLatestGuard } from './latest-request';

  interface Props {
    selected: PickedOrg | null;
    onSelect: (org: PickedOrg) => void;
    /** When set, the list starts with an "All organizations" entry that calls it. */
    onClear?: () => void;
    placeholder?: string;
    id?: string;
    class?: string;
  }

  let {
    selected,
    onSelect,
    onClear,
    placeholder = 'Select an organization',
    id = 'usage-org-picker',
    class: className = 'w-72',
  }: Props = $props();

  const PAGE_SIZE = 25;
  const SEARCH_DEBOUNCE_MS = 250;

  let open = $state(false);
  let query = $state('');
  let results = $state<PickedOrg[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');

  const guard = createLatestGuard();

  async function search(q: string) {
    const ticket = guard.begin();
    loading = true;
    error = '';
    try {
      const res = await adminAPI.getOrganizations({
        page: 1,
        limit: PAGE_SIZE,
        search: q.trim() || undefined,
        sort: 'name',
        order: 'asc',
      });
      if (!guard.isCurrent(ticket)) return;
      results = res.organizations.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));
      total = res.total;
    } catch (e) {
      if (!guard.isCurrent(ticket)) return;
      results = [];
      total = 0;
      error = e instanceof Error ? e.message : 'Failed to search organizations';
    } finally {
      if (guard.isCurrent(ticket)) loading = false;
    }
  }

  // Server-side search: the list is never capped by a client-side page size.
  $effect(() => {
    if (!open) return;
    const q = query;
    const timer = setTimeout(() => void search(q), untrack(() => results.length) === 0 && q === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  function pick(org: PickedOrg) {
    onSelect(org);
    open = false;
  }

  function clear() {
    onClear?.();
    open = false;
  }
</script>

<Popover bind:open>
  <PopoverTrigger
    {id}
    role="combobox"
    aria-expanded={open}
    aria-label="Organization"
    class="inline-flex h-9 {className} items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span class="flex min-w-0 items-center gap-2">
      <Building2 class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate {selected ? '' : 'text-muted-foreground'}">{selected?.name ?? placeholder}</span>
    </span>
    <ChevronDown class="size-4 shrink-0 opacity-50" />
  </PopoverTrigger>
  <PopoverContent class="w-72 p-0" align="start">
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search by name or slug" bind:value={query} />
      <CommandList>
        {#if error}
          <p class="px-3 py-6 text-center text-sm text-destructive" role="alert">{error}</p>
        {:else if loading && results.length === 0}
          <p class="px-3 py-6 text-center text-sm text-muted-foreground">Searching...</p>
        {:else}
          <CommandEmpty>No organization found.</CommandEmpty>
          <CommandGroup>
            {#if onClear && !query.trim()}
              <CommandItem value="__all__" onSelect={clear} class="cursor-pointer">
                <div class="flex w-full items-center gap-2">
                  <span class="flex-1 text-sm">{placeholder}</span>
                  {#if !selected}<Check class="size-4 shrink-0 text-primary" />{/if}
                </div>
              </CommandItem>
            {/if}
            {#each results as org (org.id)}
              <CommandItem value={org.id} onSelect={() => pick(org)} class="cursor-pointer">
                <div class="flex w-full items-center gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{org.name}</div>
                    <div class="truncate font-mono text-xs text-muted-foreground">{org.slug}</div>
                  </div>
                  {#if selected?.id === org.id}<Check class="size-4 shrink-0 text-primary" />{/if}
                </div>
              </CommandItem>
            {/each}
          </CommandGroup>
          {#if total > results.length}
            <p class="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing {formatCount(results.length)} of {formatCount(total)}. Type to narrow the list.
            </p>
          {/if}
        {/if}
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
