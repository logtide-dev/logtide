<!--
  Renders a MetricQueryResponse in one of the display modes.

  Props:
    response       MetricQueryResponse | null (null while nothing was loaded yet)
    loading        true while a request is in flight (shows "Updating" over old data)
    error          error text of the whole request, or null
    display        'lines' | 'area' | 'bars' | 'split' | 'stat' | 'table' (default 'lines')
    metricNames    queryId -> metric name; lets "1" utilization ratios render as % (optional)
    sharedYAxis    split mode: all small charts share one y axis (bindable, default true)
    height         px height of the single chart (lines/area/bars), default 320
    thresholds     warning/critical percent for table meters (default CPU thresholds)
    showSpark      stat mode: draw a sparkline under the number (default true)
    onSeriesClick  called with the series when its name (or a line/bar) is clicked
    threshold      optional raw value drawn as a dashed horizontal line (lines/area/bars)

  Comparison series (compareTo) are drawn dashed with the color of their
  current series, and excluded from stat/table/split cards.
-->
<script lang="ts">
  import { formatMetricValue, type MetricDisplay, type MetricQueryResponse, type MetricSeries, type SignalThreshold } from '@logtide/shared';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Sparkline from '$lib/components/app/Sparkline.svelte';
  import SeriesChart from './SeriesChart.svelte';
  import {
    METER_TONE_CLASS,
    buildColorMap,
    meterTone,
    percentOf,
    seriesLabel,
    sortByLastDesc,
    valueRange,
  } from '$lib/utils/metrics-series';

  interface Props {
    response: MetricQueryResponse | null;
    loading?: boolean;
    error?: string | null;
    display?: MetricDisplay;
    metricNames?: Record<string, string>;
    sharedYAxis?: boolean;
    height?: number;
    thresholds?: SignalThreshold;
    showSpark?: boolean;
    onSeriesClick?: (series: MetricSeries) => void;
    threshold?: number | null;
  }

  let {
    response,
    loading = false,
    error = null,
    display = 'lines',
    metricNames = {},
    sharedYAxis = $bindable(true),
    height = 320,
    thresholds,
    showSpark = true,
    onSeriesClick,
    threshold = null,
  }: Props = $props();

  const allSeries = $derived(response?.series ?? []);
  const current = $derived(allSeries.filter((s) => !s.comparison));
  const colors = $derived(buildColorMap(allSeries));
  const hasData = $derived(allSeries.some((s) => s.points.some((p) => p.v !== null)) || current.length > 0);
  const queryErrors = $derived((response?.queries ?? []).filter((q) => q.error));
  const capped = $derived((response?.queries ?? []).filter((q) => q.seriesTotal > q.seriesShown));
  const warnings = $derived(response?.warnings ?? []);
  const splitSeries = $derived(sortByLastDesc(current));
  const sharedRange = $derived(sharedYAxis ? valueRange(splitSeries) : null);
  const chartMode = $derived(display === 'area' || display === 'bars' ? display : 'lines');
  const isChart = $derived(display === 'lines' || display === 'area' || display === 'bars');

  function fmt(s: MetricSeries, v: number | null): string {
    return formatMetricValue(v, s.unit, metricNames[s.queryId]);
  }

  function sparkValues(s: MetricSeries): number[] {
    return s.points.map((p) => p.v).filter((v): v is number => v !== null);
  }

  function meter(s: MetricSeries): { pct: number; tone: string } | null {
    const pct = percentOf(s.stats.last, s.unit, metricNames[s.queryId]);
    if (pct === null) return null;
    return { pct: Math.max(0, Math.min(100, pct)), tone: METER_TONE_CLASS[meterTone(pct, thresholds)] };
  }
</script>

<div class="space-y-3">
  {#each queryErrors as q (q.id)}
    <p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text" role="alert">
      Query {q.id}: {q.error}
    </p>
  {/each}
  {#each warnings as w, i (i)}
    <p class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-text" role="status">{w}</p>
  {/each}
  {#each capped as q (q.id)}
    <p class="text-sm text-muted-foreground" role="status">
      Query {q.id}: showing {q.seriesShown.toLocaleString('en-US')} of {q.seriesTotal.toLocaleString('en-US')} series, the ones with the highest values
    </p>
  {/each}

  {#if loading && !response}
    <div class="flex items-center justify-center text-sm text-muted-foreground" style:height="{height}px" role="status">
      Loading metrics
    </div>
  {:else if error}
    <EmptyState variant="error" title="Could not load metrics" description={error} />
  {:else if !response || !hasData}
    <EmptyState
      variant="no-data"
      title="No data for this query"
      description="Try a wider time range, another metric or fewer filters."
    />
  {:else}
    <div class="relative">
      {#if loading}
        <div class="absolute right-2 top-0 z-10 text-xs text-muted-foreground" role="status">Updating</div>
      {/if}

      {#if isChart}
        <SeriesChart
          series={allSeries}
          mode={chartMode}
          {colors}
          {metricNames}
          {height}
          {onSeriesClick}
          {threshold}
        />
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm" aria-label="Series legend">
            <thead>
              <tr class="text-left text-xs text-muted-foreground">
                <th class="py-1 pr-3 font-medium">Series</th>
                <th class="px-3 py-1 text-right font-medium">Min</th>
                <th class="px-3 py-1 text-right font-medium">Avg</th>
                <th class="px-3 py-1 text-right font-medium">Max</th>
                <th class="py-1 pl-3 text-right font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {#each allSeries as s (s.id)}
                <tr class="border-t border-border/60">
                  <td class="py-1 pr-3">
                    <span class="inline-flex items-center gap-2">
                      <span
                        class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style:background={colors.get(s.id.endsWith('|cmp') ? s.id.slice(0, -4) : s.id)}
                        style:opacity={s.comparison ? 0.5 : 1}
                        aria-hidden="true"
                      ></span>
                      {#if onSeriesClick}
                        <button type="button" class="truncate text-left hover:underline" onclick={() => onSeriesClick(s)}>
                          {seriesLabel(s)}
                        </button>
                      {:else}
                        <span class="truncate">{seriesLabel(s)}</span>
                      {/if}
                    </span>
                  </td>
                  <td class="px-3 py-1 text-right tabular-nums">{fmt(s, s.stats.min)}</td>
                  <td class="px-3 py-1 text-right tabular-nums">{fmt(s, s.stats.avg)}</td>
                  <td class="px-3 py-1 text-right tabular-nums">{fmt(s, s.stats.max)}</td>
                  <td class="py-1 pl-3 text-right font-medium tabular-nums">{fmt(s, s.stats.last)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if display === 'split'}
        <div class="mb-2 flex items-center justify-end">
          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" bind:checked={sharedYAxis} class="h-3.5 w-3.5" />
            Shared y axis
          </label>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="split-grid">
          {#each splitSeries as s (s.id)}
            {@const base = allSeries.filter((x) => x.comparison && x.id === `${s.id}|cmp`)}
            <div class="rounded-lg border border-border bg-card p-3" data-testid="split-card">
              <div class="flex items-baseline justify-between gap-2">
                {#if onSeriesClick}
                  <button type="button" class="truncate text-left text-sm font-medium hover:underline" onclick={() => onSeriesClick(s)}>
                    {seriesLabel(s)}
                  </button>
                {:else}
                  <span class="truncate text-sm font-medium">{seriesLabel(s)}</span>
                {/if}
                <span class="shrink-0 text-sm font-semibold tabular-nums">{fmt(s, s.stats.last)}</span>
              </div>
              <SeriesChart
                series={[s, ...base]}
                mode={display === 'split' ? 'area' : chartMode}
                {colors}
                {metricNames}
                height={110}
                compact
                yRange={sharedRange}
              />
            </div>
          {/each}
        </div>
      {:else if display === 'stat'}
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="stat-grid">
          {#each current as s (s.id)}
            <div class="rounded-lg border border-border bg-card p-4" data-testid="stat-card">
              {#if onSeriesClick}
                <button type="button" class="block max-w-full truncate text-left text-xs text-muted-foreground hover:underline" onclick={() => onSeriesClick(s)}>
                  {seriesLabel(s)}
                </button>
              {:else}
                <p class="truncate text-xs text-muted-foreground">{seriesLabel(s)}</p>
              {/if}
              <p class="mt-1 text-3xl font-semibold tabular-nums">{fmt(s, s.stats.last)}</p>
              {#if showSpark}
                <div class="mt-2">
                  <Sparkline values={sparkValues(s)} label="{seriesLabel(s)} trend" width={140} height={28} />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm" aria-label="Series table">
            <thead>
              <tr class="text-left text-xs text-muted-foreground">
                <th class="py-1 pr-3 font-medium">Series</th>
                <th class="px-3 py-1 text-right font-medium">Min</th>
                <th class="px-3 py-1 text-right font-medium">Avg</th>
                <th class="px-3 py-1 text-right font-medium">Max</th>
                <th class="py-1 pl-3 font-medium">Last</th>
              </tr>
            </thead>
            <tbody>
              {#each current as s (s.id)}
                {@const m = meter(s)}
                <tr class="border-t border-border/60">
                  <td class="py-1.5 pr-3">
                    {#if onSeriesClick}
                      <button type="button" class="truncate text-left hover:underline" onclick={() => onSeriesClick(s)}>{seriesLabel(s)}</button>
                    {:else}
                      {seriesLabel(s)}
                    {/if}
                  </td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{fmt(s, s.stats.min)}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{fmt(s, s.stats.avg)}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums">{fmt(s, s.stats.max)}</td>
                  <td class="py-1.5 pl-3">
                    <div class="flex items-center gap-2">
                      {#if m}
                        <div
                          class="h-2 w-24 overflow-hidden rounded-full bg-muted"
                          role="meter"
                          aria-label="{seriesLabel(s)} last value"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(m.pct)}
                        >
                          <div class="h-full rounded-full {m.tone}" style:width="{m.pct}%"></div>
                        </div>
                      {/if}
                      <span class="font-medium tabular-nums">{fmt(s, s.stats.last)}</span>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
