<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import Ban from '@lucide/svelte/icons/ban';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import { Button } from '$lib/components/ui/button';
  import CopyButton from './CopyButton.svelte';

  interface Props {
    data: Record<string, unknown>;
    onFilter?: (path: string, value: unknown, negate: boolean) => void;
    onAddColumn?: (path: string) => void;
  }

  let { data, onFilter, onAddColumn }: Props = $props();

  /** Objects nested deeper than this render as a JSON string leaf. */
  const MAX_DEPTH = 8;
  /** Rows at this depth and shallower start expanded. */
  const DEFAULT_EXPANDED_DEPTH = 1;

  // Paths whose expansion differs from the default for their depth.
  const toggled = new SvelteSet<string>();

  function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
    return typeof value === 'object' && value !== null;
  }

  function isPrimitive(value: unknown): boolean {
    return !isContainer(value);
  }

  function entriesOf(value: Record<string, unknown> | unknown[]): [string, unknown][] {
    return Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value);
  }

  /** A container row that can be expanded into child rows. */
  function expandable(value: unknown, depth: number): value is Record<string, unknown> | unknown[] {
    if (!isContainer(value) || depth >= MAX_DEPTH) return false;
    if (Array.isArray(value)) return value.length > 0 && !value.every(isPrimitive);
    return Object.keys(value).length > 0;
  }

  function isExpanded(path: string, depth: number): boolean {
    return (depth <= DEFAULT_EXPANDED_DEPTH) !== toggled.has(path);
  }

  function toggle(path: string) {
    if (toggled.has(path)) toggled.delete(path);
    else toggled.add(path);
  }

  function joinPath(parent: string, key: string): string {
    return parent ? `${parent}.${key}` : key;
  }

  function safeJson(value: unknown, space: number): string {
    try {
      return JSON.stringify(value, null, space) ?? String(value);
    } catch {
      return String(value);
    }
  }

  function display(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return safeJson(value, 0);
  }

  function copyText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (isContainer(value)) return safeJson(value, 2);
    return String(value);
  }

  const rows = $derived(entriesOf(data ?? {}));
</script>

<!-- `underArray`: the row sits below an array (errors.0.code). No engine matches such paths, so those rows offer Copy only. -->
{#snippet node(key: string, value: unknown, path: string, depth: number, underArray: boolean)}
  {#if expandable(value, depth)}
    {@const open = isExpanded(path, depth)}
    <tr class="border-b border-border/60 last:border-0">
      <td colspan="3" class="py-1 pr-2" style="padding-left: {depth * 16}px">
        <button
          type="button"
          class="flex items-center gap-1 rounded-sm font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          onclick={() => toggle(path)}
        >
          <ChevronRight class="size-3.5 shrink-0 transition-transform {open ? 'rotate-90' : ''}" aria-hidden="true" />
          <span>{key}</span>
          <span class="text-muted-foreground">{Array.isArray(value) ? `[${value.length}]` : '{...}'}</span>
        </button>
      </td>
    </tr>
    {#if open}
      {#each entriesOf(value) as [childKey, childValue] (childKey)}
        {@render node(childKey, childValue, joinPath(path, childKey), depth + 1, underArray || Array.isArray(value))}
      {/each}
    {/if}
  {:else}
    <tr class="group border-b border-border/60 align-top last:border-0">
      <td class="py-1 pr-3 font-mono text-xs text-muted-foreground" style="padding-left: {depth * 16 + 18}px">
        <span class="break-all">{key}</span>
      </td>
      <td class="py-1 pr-2 font-mono text-xs">
        {#if value === null}
          <span class="text-muted-foreground">null</span>
        {:else}
          <span class="line-clamp-3 break-all">{display(value)}</span>
        {/if}
      </td>
      <td class="w-px whitespace-nowrap py-0.5 text-right">
        <span class="inline-flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton value={copyText(value)} ariaLabel="Copy value" />
          <CopyButton value={path} ariaLabel="Copy path" />
          {#if onFilter && !underArray}
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              aria-label="Filter by {path}"
              onclick={() => onFilter(path, value, false)}
            >
              <ListFilter />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              aria-label="Exclude {path}"
              onclick={() => onFilter(path, value, true)}
            >
              <Ban />
            </Button>
          {/if}
          {#if onAddColumn && !underArray}
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              aria-label="Add {path} as column"
              onclick={() => onAddColumn(path)}
            >
              <Columns3 />
            </Button>
          {/if}
        </span>
      </td>
    </tr>
  {/if}
{/snippet}

{#if rows.length === 0}
  <p class="py-2 text-sm text-muted-foreground">No metadata</p>
{:else}
  <table class="w-full border-collapse text-left">
    <tbody>
      {#each rows as [key, value] (key)}
        {@render node(key, value, key, 0, false)}
      {/each}
    </tbody>
  </table>
{/if}
