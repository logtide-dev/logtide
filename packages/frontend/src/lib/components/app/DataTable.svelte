<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import * as Table from '$lib/components/ui/table';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { isMobile } from '$lib/stores/media-query';
  import type { DataTableColumn, DataTableSort } from './data-table';

  interface Props {
    columns: DataTableColumn<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    loading?: boolean;
    selectable?: boolean;
    selected?: string[];
    sort?: DataTableSort;
    empty?: Snippet;
    /** Phone layout: one card per row instead of the table. */
    mobileRow?: Snippet<[T]>;
    /** Accessible name of a row's checkbox in the phone layout. */
    rowLabel?: (row: T) => string;
  }

  let {
    columns,
    rows,
    rowKey,
    loading = false,
    selectable = false,
    selected = $bindable([]),
    sort = $bindable(undefined),
    empty,
    mobileRow,
    rowLabel,
  }: Props = $props();

  const SKELETON_ROWS = 5;

  const colCount = $derived(columns.length + (selectable ? 1 : 0));
  const renderedKeys = $derived(rows.map((r) => rowKey(r)));
  const selectedSet = $derived(new Set(selected));
  const selectedVisible = $derived(renderedKeys.filter((k) => selectedSet.has(k)).length);
  const allSelected = $derived(renderedKeys.length > 0 && selectedVisible === renderedKeys.length);
  const someSelected = $derived(selectedVisible > 0 && !allSelected);

  function ariaSort(col: DataTableColumn<T>): 'ascending' | 'descending' | 'none' | undefined {
    if (!col.sortable) return undefined;
    if (sort?.key !== col.key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  }

  // none -> asc -> desc -> asc
  function cycleSort(col: DataTableColumn<T>) {
    if (sort?.key === col.key && sort.dir === 'asc') {
      sort = { key: col.key, dir: 'desc' };
    } else {
      sort = { key: col.key, dir: 'asc' };
    }
  }

  function toggleAll(checked: boolean) {
    const visible = new Set(renderedKeys);
    if (checked) {
      const next = [...selected];
      for (const k of renderedKeys) if (!selectedSet.has(k)) next.push(k);
      selected = next;
    } else {
      selected = selected.filter((k) => !visible.has(k));
    }
  }

  // Phones have no column headers, so sorting moves to a select.
  const sortOptions = $derived(
    columns
      .filter((c) => c.sortable)
      .flatMap((c) => [
        { value: `${c.key}:asc`, label: `${c.header}, ascending` },
        { value: `${c.key}:desc`, label: `${c.header}, descending` },
      ])
  );

  function chooseSort(value: string) {
    if (!value) return;
    const [key, dir] = value.split(':');
    sort = { key, dir: dir === 'desc' ? 'desc' : 'asc' };
  }

  function toggleRow(key: string, checked: boolean) {
    if (checked) {
      if (!selectedSet.has(key)) selected = [...selected, key];
    } else {
      selected = selected.filter((k) => k !== key);
    }
  }
</script>

{#if mobileRow && $isMobile}
  <div class="space-y-3">
    {#if sortOptions.length > 0 || selectable}
      <div class="flex items-end gap-3">
        {#if sortOptions.length > 0}
          <label class="grid flex-1 gap-1 text-xs font-medium text-muted-foreground">
            Sort by
            <select
              class="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={sort ? `${sort.key}:${sort.dir}` : ''}
              onchange={(e) => chooseSort(e.currentTarget.value)}
            >
              {#if !sort}<option value="">Default</option>{/if}
              {#each sortOptions as o (o.value)}
                <option value={o.value}>{o.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        {#if selectable}
          <label class="ml-auto flex h-11 shrink-0 items-center gap-2 rounded-md border bg-background px-3 text-sm">
            <Checkbox
              aria-label="Select all rows"
              checked={allSelected}
              indeterminate={someSelected}
              disabled={loading || rows.length === 0}
              onCheckedChange={(v) => toggleAll(v === true)}
            />
            All
          </label>
        {/if}
      </div>
    {/if}
    {#if loading}
      <div class="space-y-2" aria-busy="true">
        {#each Array(SKELETON_ROWS) as _, i (i)}
          <div data-testid="skeleton-row" class="h-20 animate-pulse rounded-lg border bg-muted/40"></div>
        {/each}
      </div>
    {:else if rows.length === 0}
      <div class="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
        {#if empty}
          {@render empty()}
        {:else}
          No results
        {/if}
      </div>
    {:else}
      <ul data-testid="data-table-list" class="overflow-hidden rounded-lg border bg-card">
        {#each rows as row (rowKey(row))}
          {@const key = rowKey(row)}
          <li class="flex items-start gap-3 border-b px-3 py-3 last:border-b-0 {selectedSet.has(key) ? 'bg-muted/50' : ''}">
            {#if selectable}
              <Checkbox
                class="mt-0.5"
                aria-label={rowLabel ? `Select ${rowLabel(row)}` : 'Select row'}
                checked={selectedSet.has(key)}
                onCheckedChange={(v) => toggleRow(key, v === true)}
              />
            {/if}
            <div class="min-w-0 flex-1">
              {@render mobileRow(row)}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
<Table.Root>
  <Table.Header>
    <Table.Row class="hover:bg-transparent">
      {#if selectable}
        <Table.Head class="w-10">
          <Checkbox
            aria-label="Select all rows"
            checked={allSelected}
            indeterminate={someSelected}
            disabled={loading || rows.length === 0}
            onCheckedChange={(v) => toggleAll(v === true)}
          />
        </Table.Head>
      {/if}
      {#each columns as col (col.key)}
        <Table.Head class={col.class} aria-sort={ariaSort(col)}>
          {#if col.sortable}
            <button
              type="button"
              class="-mx-2 inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onclick={() => cycleSort(col)}
            >
              {col.header}
              {#if sort?.key === col.key}
                {#if sort.dir === 'asc'}
                  <ChevronUp class="size-3.5" aria-hidden="true" />
                {:else}
                  <ChevronDown class="size-3.5" aria-hidden="true" />
                {/if}
              {:else}
                <ChevronsUpDown class="size-3.5 opacity-50" aria-hidden="true" />
              {/if}
            </button>
          {:else}
            {col.header}
          {/if}
        </Table.Head>
      {/each}
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#if loading}
      {#each Array(SKELETON_ROWS) as _, i (i)}
        <Table.Row data-testid="skeleton-row" class="hover:bg-transparent">
          <Table.Cell colspan={colCount}>
            <Skeleton height="1.25rem" width="100%" />
          </Table.Cell>
        </Table.Row>
      {/each}
    {:else if rows.length === 0}
      <Table.Row class="hover:bg-transparent">
        <Table.Cell colspan={colCount} class="h-24 text-center text-muted-foreground">
          {#if empty}
            {@render empty()}
          {:else}
            No results
          {/if}
        </Table.Cell>
      </Table.Row>
    {:else}
      {#each rows as row (rowKey(row))}
        {@const key = rowKey(row)}
        <Table.Row data-state={selectedSet.has(key) ? 'selected' : undefined}>
          {#if selectable}
            <Table.Cell class="w-10">
              <Checkbox
                aria-label="Select row"
                checked={selectedSet.has(key)}
                onCheckedChange={(v) => toggleRow(key, v === true)}
              />
            </Table.Cell>
          {/if}
          {#each columns as col (col.key)}
            <Table.Cell class={col.class}>
              {@render col.cell(row)}
            </Table.Cell>
          {/each}
        </Table.Row>
      {/each}
    {/if}
  </Table.Body>
</Table.Root>
{/if}
