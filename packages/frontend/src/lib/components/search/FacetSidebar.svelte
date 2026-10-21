<script lang="ts">
  import { LOG_LEVELS } from '@logtide/shared';
  import * as Popover from '$lib/components/ui/popover';
  import Button from '$lib/components/ui/button/button.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import Plus from '@lucide/svelte/icons/plus';
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
  import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
  import type { LogFacet } from '$lib/api/logs';
  import { getFieldValues } from './query-edit';
  import { BUILTIN_FACET_KEYS, MAX_METADATA_FACETS } from './facet-keys';

  type Mode = 'include' | 'exclude';
  type ValueState = 'included' | 'excluded' | 'none';

  interface Props {
    facets: LogFacet[];
    loading: boolean;
    error: string | null;
    /** The committed query: included and excluded values are read from it. */
    q: string;
    pinnedKeys: string[];
    /** Discovered metadata keys usable as facets (see `facetCandidates`). */
    candidateKeys: string[];
    collapsed?: boolean;
    onToggle: (key: string, value: string, mode: Mode) => void;
    onPin: (key: string) => void;
    onUnpin: (key: string) => void;
  }

  let {
    facets,
    loading,
    error,
    q,
    pinnedKeys,
    candidateKeys,
    collapsed = $bindable(false),
    onToggle,
    onPin,
    onUnpin,
  }: Props = $props();

  const uid = $props.id();

  const TITLES: Record<string, string> = { level: 'Level', service: 'Service', host: 'Host' };
  const BUILTINS: readonly string[] = BUILTIN_FACET_KEYS;
  const LEVEL_ORDER: readonly string[] = LOG_LEVELS;

  const ordered = $derived([
    ...BUILTINS.map((key) => facets.find((f) => f.field === key)).filter((f): f is LogFacet => f !== undefined),
    ...facets.filter((f) => !BUILTINS.includes(f.field)),
  ]);
  const shown = $derived(new Set(ordered.map((f) => f.field)));
  const addable = $derived(candidateKeys.filter((k) => !shown.has(k) && !BUILTINS.includes(k)));
  const pinsFull = $derived(pinnedKeys.length >= MAX_METADATA_FACETS);
  const selections = $derived(new Map(ordered.map((f) => [f.field, getFieldValues(q, f.field)])));

  let openMenu = $state<string | null>(null);
  let addOpen = $state(false);

  function stateOf(field: string, value: string): ValueState {
    const sel = selections.get(field);
    if (!sel) return 'none';
    const v = field === 'level' ? value.toLowerCase() : value;
    if (sel.include.includes(v)) return 'included';
    if (sel.exclude.includes(v)) return 'excluded';
    return 'none';
  }

  function levelRank(value: string): number {
    const i = LEVEL_ORDER.indexOf(value.toLowerCase());
    return i < 0 ? LEVEL_ORDER.length : i;
  }

  function sortedValues(facet: LogFacet): LogFacet['values'] {
    const values = [...facet.values];
    if (facet.field === 'level') {
      return values.sort((a, b) => levelRank(a.value) - levelRank(b.value) || b.count - a.count);
    }
    return values.sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  }

  const fmt = (n: number) => n.toLocaleString('en-US');
  const countLabel = (n: number) => (n === 1 ? '1 log' : `${fmt(n)} logs`);
  const valueText = (value: string) => (value === '' ? '(empty)' : value);
  const menuId = (field: string, value: string) => JSON.stringify([field, value]);

  function setMenu(id: string, open: boolean) {
    if (open) openMenu = id;
    else if (openMenu === id) openMenu = null;
  }

  function choose(field: string, value: string, mode: Mode) {
    openMenu = null;
    onToggle(field, value, mode);
  }

  function addFacet(key: string) {
    addOpen = false;
    onPin(key);
  }
</script>

<aside
  aria-label="Facets"
  class="shrink-0 {collapsed ? 'w-10' : 'w-full lg:w-64'}"
  aria-busy={loading}
>
  <div class="flex items-center justify-between gap-2 pb-2">
    {#if !collapsed}
      <span class="text-sm font-medium text-muted-foreground">Facets</span>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class="size-8"
      aria-label={collapsed ? 'Expand facets' : 'Collapse facets'}
      title={collapsed ? 'Expand facets' : 'Collapse facets'}
      aria-expanded={!collapsed}
      aria-controls={collapsed ? undefined : `${uid}-lists`}
      onclick={() => (collapsed = !collapsed)}
    >
      {#if collapsed}<PanelLeftOpen />{:else}<PanelLeftClose />{/if}
    </Button>
  </div>

  {#if !collapsed}
    <div id="{uid}-lists" class="space-y-4">
      {#if error}
        <div role="alert" class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p class="font-medium text-destructive-text">Could not load facets</p>
          <p class="mt-1 break-words text-xs text-muted-foreground">{error}</p>
        </div>
      {:else if loading && ordered.length === 0}
        <p class="text-sm text-muted-foreground" role="status">Loading facets</p>
      {:else}
        {#each ordered as facet, i (facet.field)}
          {@const builtin = BUILTINS.includes(facet.field)}
          {@const pinned = pinnedKeys.includes(facet.field)}
          {@const values = sortedValues(facet)}
          <section aria-labelledby="{uid}-h{i}" class="space-y-1 {loading ? 'opacity-60' : ''}">
            <div class="flex items-center justify-between gap-1">
              <h3
                id="{uid}-h{i}"
                class="truncate text-xs font-semibold text-foreground {builtin ? '' : 'font-mono'}"
                title={facet.field}
              >
                {TITLES[facet.field] ?? facet.field}
              </h3>
              {#if !builtin}
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-6"
                  aria-label="{pinned ? 'Unpin' : 'Pin'} {facet.field}"
                  title={pinned ? 'Unpin facet' : 'Pin facet'}
                  onclick={() => (pinned ? onUnpin(facet.field) : onPin(facet.field))}
                >
                  {#if pinned}<PinOff class="size-3.5" />{:else}<Pin class="size-3.5" />{/if}
                </Button>
              {/if}
            </div>
            {#if values.length === 0 && facet.otherCount <= 0}
              <p class="px-2 text-xs text-muted-foreground">No values</p>
            {:else}
              <ul class="space-y-0.5">
                {#each values as item (item.value)}
                  {@const state = stateOf(facet.field, item.value)}
                  {@const id = menuId(facet.field, item.value)}
                  <li
                    data-state={state}
                    class="group flex items-center gap-0.5 rounded-md {state === 'included' ? 'bg-primary/10' : 'hover:bg-muted/60'}"
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={state === 'included'}
                      aria-label="{facet.field} {valueText(item.value)} ({countLabel(item.count)})"
                      title={item.value}
                      onclick={() => onToggle(facet.field, item.value, 'include')}
                    >
                      {#if facet.field === 'level'}
                        <span class={state === 'excluded' ? 'line-through opacity-60' : ''}>
                          <SeverityBadge kind="level" value={item.value} />
                        </span>
                      {:else}
                        <span
                          class="truncate {builtin ? '' : 'font-mono text-xs'} {item.value === '' ? 'italic text-muted-foreground' : ''} {state === 'excluded' ? 'line-through text-muted-foreground' : ''} {state === 'included' ? 'font-medium' : ''}"
                        >
                          {valueText(item.value)}
                        </span>
                      {/if}
                      <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(item.count)}</span>
                    </button>
                    <Popover.Root
                      bind:open={() => openMenu === id, (open) => setMenu(id, open)}
                    >
                      <Popover.Trigger>
                        {#snippet child({ props })}
                          <Button
                            {...props}
                            variant="ghost"
                            size="icon"
                            class="size-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                            aria-label="More actions for {facet.field} {valueText(item.value)}"
                          >
                            <Ellipsis class="size-3.5" />
                          </Button>
                        {/snippet}
                      </Popover.Trigger>
                      <Popover.Content class="w-36 p-1" align="end">
                        <div class="flex flex-col">
                          <button
                            type="button"
                            class="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            onclick={() => choose(facet.field, item.value, 'include')}
                          >
                            Include
                          </button>
                          <button
                            type="button"
                            class="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            onclick={() => choose(facet.field, item.value, 'exclude')}
                          >
                            Exclude
                          </button>
                        </div>
                      </Popover.Content>
                    </Popover.Root>
                  </li>
                {/each}
                {#if facet.otherCount > 0}
                  <li class="flex items-center justify-between gap-2 px-2 py-1 text-sm text-muted-foreground">
                    <span class="italic">Other</span>
                    <span class="text-xs tabular-nums">{fmt(facet.otherCount)}</span>
                  </li>
                {/if}
              </ul>
            {/if}
          </section>
        {/each}

        <Popover.Root bind:open={addOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="sm"
                class="w-full justify-start gap-1.5 text-muted-foreground"
                aria-label="Add facet"
                disabled={pinsFull}
                title={pinsFull ? `Up to ${MAX_METADATA_FACETS} pinned facets` : 'Add facet'}
              >
                <Plus class="size-4" />
                Add facet
              </Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-64 p-1" align="start">
            {#if addable.length === 0}
              <p class="px-2 py-1.5 text-sm text-muted-foreground">No more fields in this range</p>
            {:else}
              <div class="flex max-h-64 flex-col overflow-y-auto">
                {#each addable as key (key)}
                  <button
                    type="button"
                    class="truncate rounded-sm px-2 py-1.5 text-left font-mono text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    title={key}
                    onclick={() => addFacet(key)}
                  >
                    {key}
                  </button>
                {/each}
              </div>
            {/if}
          </Popover.Content>
        </Popover.Root>
      {/if}
    </div>
  {/if}
</aside>
