<script lang="ts">
  import type { HardwareHostSummary } from '@logtide/shared';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import { Badge } from '$lib/components/ui/badge';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import ComponentChips from './ComponentChips.svelte';
  import HardwareStatusBadge from './HardwareStatusBadge.svelte';

  interface Props {
    hosts: HardwareHostSummary[];
    loading?: boolean;
  }

  let { hosts, loading = false }: Props = $props();

  type Cell = DataTableColumn<HardwareHostSummary>['cell'];

  const columns: DataTableColumn<HardwareHostSummary>[] = [
    { key: 'status', header: 'Status', cell: statusCell as unknown as Cell },
    { key: 'host', header: 'Host', class: 'min-w-[10rem]', cell: hostCell as unknown as Cell },
    { key: 'components', header: 'Components', class: 'min-w-[16rem]', cell: componentsCell as unknown as Cell },
    { key: 'findings', header: 'Findings', class: 'hidden sm:table-cell', cell: findingsCell as unknown as Cell },
    { key: 'seen', header: 'Last seen', class: 'hidden md:table-cell', cell: seenCell as unknown as Cell },
  ];

  const plural = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'finding' : 'findings'}`;
</script>

{#snippet statusCell(h: HardwareHostSummary)}
  <HardwareStatusBadge status={h.status} isVirtual={h.isVirtual} />
{/snippet}

{#snippet hostName(h: HardwareHostSummary)}
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <a href="/dashboard/hardware/{encodeURIComponent(h.id)}" class="font-medium hover:text-primary hover:underline">
      {h.hostName}
    </a>
    {#if h.isVirtual}
      <Badge variant="outline" class="py-0 text-[11px]" title="Virtual machine: hardware sensors are not available">VM</Badge>
    {/if}
    {#if h.muted}
      <span class="inline-flex text-muted-foreground" title="Muted: no notifications or incidents" data-testid="muted-icon">
        <BellOff class="h-3.5 w-3.5" aria-label="Muted" />
      </span>
    {/if}
  </div>
{/snippet}

{#snippet hostCell(h: HardwareHostSummary)}
  <div class="min-w-0">
    {@render hostName(h)}
    {#if h.info.vendor || h.info.model}
      <p class="truncate text-xs text-muted-foreground">
        {[h.info.vendor, h.info.model].filter(Boolean).join(' ')}
      </p>
    {/if}
  </div>
{/snippet}

{#snippet componentsCell(h: HardwareHostSummary)}
  <ComponentChips components={h.components} />
{/snippet}

{#snippet findingsCell(h: HardwareHostSummary)}
  {#if h.findingsCount > 0}
    <span class="text-sm font-medium">{h.findingsCount.toLocaleString('en-US')}</span>
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet seenCell(h: HardwareHostSummary)}
  <span class="text-xs text-muted-foreground">
    {#if h.lastSeenAt}
      <Timestamp value={h.lastSeenAt} relative />
    {:else}
      Never
    {/if}
  </span>
{/snippet}

{#snippet mobileRow(h: HardwareHostSummary)}
  <div class="space-y-2">
    <div class="flex items-start justify-between gap-2">
      {@render hostName(h)}
      <HardwareStatusBadge status={h.status} isVirtual={h.isVirtual} />
    </div>
    <ComponentChips components={h.components} />
    <p class="text-xs text-muted-foreground">
      {#if h.findingsCount > 0}{plural(h.findingsCount)} · {/if}
      {#if h.lastSeenAt}
        Seen <Timestamp value={h.lastSeenAt} relative />
      {:else}
        Never seen
      {/if}
    </p>
  </div>
{/snippet}

<div class="rounded-lg border bg-card">
  <DataTable {columns} rows={hosts} rowKey={(h: HardwareHostSummary) => h.id} {loading} mobileRow={mobileRow as never} />
</div>
