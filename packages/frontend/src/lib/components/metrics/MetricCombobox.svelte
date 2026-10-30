<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';

  interface Props {
    options: { name: string; type: string }[];
    value: string | null;
    loading?: boolean;
    onSelect: (name: string) => void;
  }

  let { options, value, loading = false, onSelect }: Props = $props();

  const uid = $props.id();
  const listId = `metric-combobox-${uid}`;

  let open = $state(false);
  let query = $state('');
  let active = $state(0);

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  });

  function openList() {
    open = true;
    query = '';
    active = 0;
  }

  function close() {
    open = false;
    query = '';
  }

  function choose(name: string) {
    onSelect(name);
    close();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      else active = Math.min(active + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const hit = filtered[active];
      if (hit) choose(hit.name);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  }
</script>

<div class="relative w-full min-w-[220px]">
  <input
    type="text"
    role="combobox"
    aria-label="Metric"
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    autocomplete="off"
    placeholder={loading ? 'Loading metrics' : 'Select metric'}
    class="flex h-9 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    value={open ? query : (value ?? '')}
    oninput={(e) => {
      query = e.currentTarget.value;
      active = 0;
      open = true;
    }}
    onfocus={openList}
    onblur={close}
    onkeydown={onKeydown}
  />
  <ChevronsUpDown
    class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50"
    aria-hidden="true"
  />

  {#if open}
    <ul
      id={listId}
      role="listbox"
      aria-label="Metrics"
      class="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {#each filtered as option, i (option.name)}
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={option.name === value}
            class="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted {i === active ? 'bg-muted' : ''}"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => choose(option.name)}
          >
            <span class="truncate">{option.name}</span>
            <Badge variant="outline" class="shrink-0 text-xs">{option.type}</Badge>
          </button>
        </li>
      {:else}
        <li class="px-2 py-1.5 text-sm text-muted-foreground">
          {loading ? 'Loading metrics' : 'No metrics found'}
        </li>
      {/each}
    </ul>
  {/if}
</div>
