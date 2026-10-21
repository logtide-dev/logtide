<script lang="ts">
  // Test harness: binds `selected` and `sort` so tests can observe them.
  import { createRawSnippet, untrack } from 'svelte';
  import DataTable from './DataTable.svelte';
  import type { DataTableColumn, DataTableSort } from './data-table';

  type Row = { id: string; name: string };

  interface Props {
    rows: Row[];
    selectable?: boolean;
    loading?: boolean;
    initialSelected?: string[];
  }

  let { rows, selectable = false, loading = false, initialSelected = [] }: Props = $props();

  let selected = $state<string[]>(untrack(() => [...initialSelected]));
  let sort = $state<DataTableSort | undefined>(undefined);

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: createRawSnippet<[Row]>((row) => ({ render: () => `<span>${row().name}</span>` })),
    },
    {
      key: 'id',
      header: 'Identifier',
      cell: createRawSnippet<[Row]>((row) => ({ render: () => `<span>${row().id}</span>` })),
    },
  ];
</script>

<DataTable
  {columns}
  {rows}
  rowKey={(r: Row) => r.id}
  {selectable}
  {loading}
  bind:selected
  bind:sort
/>
<pre data-testid="state">{JSON.stringify({ selected, sort })}</pre>
