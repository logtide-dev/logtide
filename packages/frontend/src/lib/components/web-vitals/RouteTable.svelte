<script lang="ts">
  import type { WebVitalName } from '@logtide/shared';
  import type { WebVitalRouteRow } from '$lib/api/web-vitals';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import { ratingTone, formatVitalValue, RATING_LABELS } from './format';

  interface Props {
    rows: WebVitalRouteRow[];
  }

  let { rows }: Props = $props();

  // The snippet type resolved from this file differs nominally from the one in
  // DataTableColumn (two copies of the svelte types), hence the cast.
  const asCell = (snippet: unknown) => snippet as DataTableColumn<WebVitalRouteRow>['cell'];

  const columns = $derived<DataTableColumn<WebVitalRouteRow>[]>([
    { key: 'route', header: 'Route', class: 'max-w-[320px]', cell: asCell(routeCell) },
    { key: 'samples', header: 'Samples', class: 'text-right', cell: asCell(samplesCell) },
    { key: 'LCP', header: 'LCP', cell: asCell(lcpCell) },
    { key: 'INP', header: 'INP', cell: asCell(inpCell) },
    { key: 'CLS', header: 'CLS', cell: asCell(clsCell) },
    { key: 'FCP', header: 'FCP', cell: asCell(fcpCell) },
    { key: 'TTFB', header: 'TTFB', cell: asCell(ttfbCell) },
  ]);
</script>

{#snippet routeCell(r: WebVitalRouteRow)}
  <span class="block truncate font-mono text-xs" title={r.route}>{r.route}</span>
{/snippet}

{#snippet samplesCell(r: WebVitalRouteRow)}
  <span class="tabular-nums">{r.samples.toLocaleString('en-US')}</span>
{/snippet}

{#snippet vital(r: WebVitalRouteRow, name: WebVitalName)}
  {@const m = r.metrics[name]}
  {#if m}
    <span
      data-testid="route-vital"
      data-rating={m.rating}
      title="{RATING_LABELS[m.rating]}, {m.samples.toLocaleString('en-US')} samples"
      class="inline-flex rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums {ratingTone(m.rating).badge}"
    >
      {formatVitalValue(name, m.p75)}
    </span>
  {:else}
    <span class="text-muted-foreground" aria-label="No data">-</span>
  {/if}
{/snippet}

{#snippet lcpCell(r: WebVitalRouteRow)}{@render vital(r, 'LCP')}{/snippet}
{#snippet inpCell(r: WebVitalRouteRow)}{@render vital(r, 'INP')}{/snippet}
{#snippet clsCell(r: WebVitalRouteRow)}{@render vital(r, 'CLS')}{/snippet}
{#snippet fcpCell(r: WebVitalRouteRow)}{@render vital(r, 'FCP')}{/snippet}
{#snippet ttfbCell(r: WebVitalRouteRow)}{@render vital(r, 'TTFB')}{/snippet}

<DataTable {columns} {rows} rowKey={(r: WebVitalRouteRow) => r.route} />
