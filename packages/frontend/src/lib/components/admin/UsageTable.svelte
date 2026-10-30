<script lang="ts" module>
  export interface UsageCell {
    text: string;
    /** Muted second line, e.g. the raw metric id. */
    sub?: string;
  }

  export interface UsageTableRow {
    key: string;
    cells: Array<string | UsageCell>;
  }

  export interface UsageTableHeader {
    label: string;
    align?: 'left' | 'right';
  }
</script>

<script lang="ts">
  import * as Table from '$lib/components/ui/table';
  import { Skeleton } from '$lib/components/ui/skeleton';

  interface Props {
    headers: UsageTableHeader[];
    rows: UsageTableRow[];
    loading?: boolean;
    empty?: string;
    caption?: string;
  }

  let { headers, rows, loading = false, empty = 'No data for this period.', caption }: Props = $props();

  function cellOf(c: string | UsageCell): UsageCell {
    return typeof c === 'string' ? { text: c } : c;
  }
</script>

{#if loading}
  <div class="space-y-2 p-4" aria-busy="true">
    <Skeleton class="h-6 w-full" />
    <Skeleton class="h-6 w-full" />
    <Skeleton class="h-6 w-2/3" />
  </div>
{:else if rows.length === 0}
  <p class="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
{:else}
  <Table.Root>
    {#if caption}<caption class="sr-only">{caption}</caption>{/if}
    <Table.Header>
      <Table.Row class="hover:bg-transparent">
        {#each headers as h (h.label)}
          <Table.Head class={h.align === 'right' ? 'text-right' : ''}>{h.label}</Table.Head>
        {/each}
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each rows as row (row.key)}
        <Table.Row>
          {#each row.cells as raw, i (i)}
            {@const cell = cellOf(raw)}
            <Table.Cell class={headers[i]?.align === 'right' ? 'text-right tabular-nums' : ''}>
              {cell.text}
              {#if cell.sub}<span class="block font-mono text-xs text-muted-foreground">{cell.sub}</span>{/if}
            </Table.Cell>
          {/each}
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
{/if}
