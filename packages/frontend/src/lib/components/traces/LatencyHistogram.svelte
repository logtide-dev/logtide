<script lang="ts">
  import * as echarts from 'echarts';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import type { LatencyHistogram as LatencyHistogramData } from '$lib/api/traces';
  import { themeStore } from '$lib/stores/theme';
  import { getEChartsTheme, getTooltipStyle, getAxisStyle } from '$lib/utils/echarts-theme';
  import { levelTone } from '$lib/utils/severity';
  import { escapeHtml } from '$lib/utils/html';
  import { bucketAxisLabel, bucketInSelection, bucketLabel, brushToRange } from './histogram';

  interface Props {
    data: LatencyHistogramData | null;
    loading: boolean;
    selection: { minMs: number | null; maxMs: number | null };
    onBrush: (range: { minMs: number; maxMs: number | null } | null) => void;
  }

  let { data, loading, selection, onBrush }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let chart = $state.raw<echarts.ECharts | null>(null);

  const total = $derived(
    data ? data.counts.reduce((sum, c) => sum + (Number.isFinite(c) ? c : 0), 0) : 0,
  );
  const hasSelection = $derived(selection.minMs !== null || selection.maxMs !== null);

  let lastEmitted = '';

  function buildOption() {
    if (!data) return {};
    const theme = getEChartsTheme();
    const axis = getAxisStyle();
    const color = levelTone('info').chart;
    const bounds = data.bounds;
    const items = data.counts.map((count, i) => ({
      value: Number.isFinite(count) ? count : 0,
      itemStyle: {
        color,
        opacity: !hasSelection || bucketInSelection(bounds, i, selection) ? 1 : 0.3,
      },
    }));
    return {
      backgroundColor: theme.backgroundColor,
      grid: { left: 44, right: 16, top: 16, bottom: 40 },
      tooltip: {
        ...getTooltipStyle(),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = p?.dataIndex ?? 0;
          const count = Number(p?.value ?? 0);
          return `${escapeHtml(bucketLabel(bounds, idx))}<br/><b>${escapeHtml(count.toLocaleString('en-US'))}</b> requests`;
        },
      },
      brush: {
        toolbox: [],
        xAxisIndex: 0,
        brushType: 'lineX',
        brushMode: 'single',
        throttleType: 'debounce',
        throttleDelay: 200,
        brushStyle: { color: `${color}33`, borderColor: color },
      },
      xAxis: {
        type: 'category',
        data: data.counts.map((_, i) => bucketAxisLabel(bounds, i)),
        ...axis,
        axisLabel: { ...axis.axisLabel, interval: 0, rotate: 0, fontSize: 10 },
      },
      yAxis: { type: 'value', minInterval: 1, ...axis },
      series: [{ type: 'bar', data: items, barCategoryGap: '15%' }],
    };
  }

  // Create the chart whenever the container is mounted, dispose when it goes.
  $effect(() => {
    const el = container;
    if (!el) return;
    const instance = echarts.init(el);
    instance.on('brushSelected', (params: any) => {
      const area = params?.batch?.[0]?.areas?.[0];
      const range = area?.coordRange;
      if (!data || !Array.isArray(range) || range.length < 2) return;
      const mapped = brushToRange(data.bounds, range[0], range[1]);
      const key = `${mapped.minMs}:${mapped.maxMs}`;
      if (key === lastEmitted) return;
      lastEmitted = key;
      onBrush(mapped);
    });
    instance.dispatchAction({
      type: 'takeGlobalCursor',
      key: 'brush',
      brushOption: { brushType: 'lineX', brushMode: 'single' },
    });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => instance.resize());
      observer.observe(el);
    }
    chart = instance;
    return () => {
      observer?.disconnect();
      instance.dispose();
      chart = null;
    };
  });

  // Redraw on data, selection and theme changes.
  $effect(() => {
    void $themeStore;
    const instance = chart;
    if (!instance || !data) return;
    instance.setOption(buildOption());
  });

  // When the selection is removed from outside (duration chip, clear all, URL change),
  // forget the dedup key and wipe the drawn brush area so the same range can be re-brushed.
  let hadSelection = false;
  $effect(() => {
    const has = hasSelection;
    const instance = chart;
    if (hadSelection && !has) {
      lastEmitted = '';
      instance?.dispatchAction({ type: 'brush', areas: [] });
    }
    hadSelection = has;
  });

  function clearSelection() {
    lastEmitted = '';
    chart?.dispatchAction({ type: 'brush', areas: [] });
    onBrush(null);
  }
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between gap-2">
    <h3 class="text-sm font-medium">Latency distribution</h3>
    {#if hasSelection}
      <Button variant="ghost" size="sm" onclick={clearSelection}>Clear selection</Button>
    {:else if total > 0}
      <span class="text-xs text-muted-foreground">Drag across the bars to filter by duration</span>
    {/if}
  </div>
  {#if loading && !data}
    <Skeleton height="12rem" width="100%" />
  {:else if !data || total === 0}
    <EmptyState variant="no-data" title="No requests in this range" />
  {:else}
    <div bind:this={container} class="h-48 w-full" data-testid="latency-histogram"></div>
  {/if}
</div>
