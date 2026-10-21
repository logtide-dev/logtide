<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import * as Table from '$lib/components/ui/table';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Skeleton } from '$lib/components/ui/skeleton';
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

  function toggleRow(key: string, checked: boolean) {
    if (checked) {
      if (!selectedSet.has(key)) selected = [...selected, key];
    } else {
      selected = selected.filter((k) => k !== key);
    }
  }
</script>

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
