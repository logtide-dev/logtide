<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { DetectionEvent } from '@logtide/shared';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import Pagination from '$lib/components/app/Pagination.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { logLink } from '$lib/components/siem/shared/log-link';

  interface Props {
    matches: DetectionEvent[];
    total: number;
    loading: boolean;
    onPage: (offset: number) => void;
    pageSize?: number;
  }

  let { matches, total, loading, onPage, pageSize = 20 }: Props = $props();

  let pageNumber = $state(1);

  function goTo(next: number) {
    pageNumber = next;
    onPage((next - 1) * pageSize);
  }

  const snip = (s: unknown) => s as Snippet<[DetectionEvent]>;

  const columns = $derived.by<DataTableColumn<DetectionEvent>[]>(() => [
    { key: 'time', header: 'Time', class: 'whitespace-nowrap', cell: snip(timeCell) },
    { key: 'service', header: 'Service', cell: snip(serviceCell) },
    { key: 'message', header: 'Message', class: 'max-w-md', cell: snip(messageCell) },
    { key: 'severity', header: 'Severity', cell: snip(severityCell) },
    { key: 'incident', header: 'Incident', cell: snip(incidentCell) },
    { key: 'log', header: 'Log', cell: snip(logCell) },
  ]);
</script>

{#snippet timeCell(m: DetectionEvent)}
  <Timestamp value={m.time} precision="second" />
{/snippet}

{#snippet serviceCell(m: DetectionEvent)}
  <span class="font-mono text-xs">{m.service}</span>
{/snippet}

{#snippet messageCell(m: DetectionEvent)}
  <span class="block max-w-md truncate text-sm" title={m.logMessage}>{m.logMessage}</span>
{/snippet}

{#snippet severityCell(m: DetectionEvent)}
  <SeverityBadge kind="severity" value={m.severity} />
{/snippet}

{#snippet incidentCell(m: DetectionEvent)}
  {#if m.incidentId}
    <a href="/dashboard/incidents/{m.incidentId}" class="text-sm underline underline-offset-2 hover:text-foreground">
      Open incident
    </a>
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet logCell(m: DetectionEvent)}
  {#if m.logId}
    <a
      href={logLink({ logId: m.logId, projectId: m.projectId, time: m.time })}
      class="text-sm underline underline-offset-2 hover:text-foreground"
    >
      View log
    </a>
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

<div class="space-y-3">
  <DataTable {columns} rows={matches} rowKey={(m: DetectionEvent) => m.id} {loading}>
    {#snippet empty()}No matches in the last 7 days{/snippet}
  </DataTable>
  <Pagination page={pageNumber} {pageSize} {total} onPageChange={goTo} />
</div>
