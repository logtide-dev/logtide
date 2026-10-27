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
    /** Pass a phone row snippet (used only when the phone layout is active). */
    withMobileRow?: boolean;
  }

  let { rows, selectable = false, loading = false, initialSelected = [], withMobileRow = false }: Props = $props();

  const mobileRow = createRawSnippet<[Row]>((row) => ({
    render: () => `<span data-testid="mobile-row">${row().name} (${row().id})</span>`,
  }));

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
  mobileRow={withMobileRow ? mobileRow : undefined}
  rowLabel={(r: Row) => r.name}
/>
<pre data-testid="state">{JSON.stringify({ selected, sort })}</pre>
