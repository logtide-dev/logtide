<script lang="ts">
  import type { HardwareHostSummary } from '@logtide/shared';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import { Badge } from '$lib/components/ui/badge';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ComponentChips from './ComponentChips.svelte';
  import HardwareStatusBadge from './HardwareStatusBadge.svelte';
  import { hardwareHostHref } from './hardware-meta';

  interface Props {
    hosts: HardwareHostSummary[];
    loading?: boolean;
    /** project id -> name; when set, a Project column tells hosts of several projects apart. */
    projectNames?: Map<string, string> | null;
  }

  let { hosts, loading = false, projectNames = null }: Props = $props();

  type Cell = DataTableColumn<HardwareHostSummary>['cell'];

  const columns = $derived<DataTableColumn<HardwareHostSummary>[]>([
    { key: 'status', header: 'Status', cell: statusCell as unknown as Cell },
    { key: 'host', header: 'Host', class: 'min-w-[10rem]', cell: hostCell as unknown as Cell },
    ...(projectNames
      ? [{ key: 'project', header: 'Project', class: 'hidden lg:table-cell', cell: projectCell as unknown as Cell }]
      : []),
    { key: 'components', header: 'Components', class: 'min-w-[16rem]', cell: componentsCell as unknown as Cell },
    { key: 'findings', header: 'Findings', class: 'hidden sm:table-cell', cell: findingsCell as unknown as Cell },
    { key: 'seen', header: 'Last seen', class: 'hidden md:table-cell', cell: seenCell as unknown as Cell },
    { key: 'open', header: '', class: 'w-8 pr-3 text-right', cell: openCell as unknown as Cell },
  ]);

  // A row opens the Hardware tab of the host page.
  const hostHref = (h: HardwareHostSummary) => hardwareHostHref(h);

  const plural = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'finding' : 'findings'}`;
</script>

{#snippet statusCell(h: HardwareHostSummary)}
  <HardwareStatusBadge status={h.status} isVirtual={h.isVirtual} />
{/snippet}

{#snippet hostName(h: HardwareHostSummary)}
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <a href={hostHref(h)} class="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
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

{#snippet projectCell(h: HardwareHostSummary)}
  <span class="text-sm text-muted-foreground">{projectNames?.get(h.projectId) ?? '-'}</span>
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

{#snippet openCell(_h: HardwareHostSummary)}
  <ChevronRight class="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
{/snippet}

{#snippet mobileRow(h: HardwareHostSummary)}
  <div class="space-y-2">
    <div class="flex items-start justify-between gap-2">
      {@render hostName(h)}
      <div class="flex shrink-0 items-center gap-1">
        <HardwareStatusBadge status={h.status} isVirtual={h.isVirtual} />
        <ChevronRight class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
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
  <DataTable {columns} rows={hosts} rowKey={(h: HardwareHostSummary) => h.id} rowHref={hostHref} {loading} mobileRow={mobileRow as never} />
</div>
