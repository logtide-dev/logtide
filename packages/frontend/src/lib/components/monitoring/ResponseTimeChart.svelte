<script lang="ts">
  import { untrack } from 'svelte';
  import * as echarts from 'echarts';
  import type { ResponseTimePoint, ResponseTimeRange } from '$lib/api/monitoring';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { themeStore } from '$lib/stores/theme';
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { formatTimestamp } from '$lib/utils/datetime';
  import {
    chartColors,
    getAxisStyle,
    getLegendStyle,
    getTooltipStyle,
  } from '$lib/utils/echarts-theme';

  interface Props {
    points: ResponseTimePoint[];
    range: ResponseTimeRange;
    onRangeChange: (range: ResponseTimeRange) => void;
  }

  let { points, range, onRangeChange }: Props = $props();

  const RANGES: { value: ResponseTimeRange; label: string }[] = [
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
  ];

  const hasData = $derived(points.some((p) => p.avgMs !== null));

  let container = $state<HTMLDivElement>();
  let chart: echarts.ECharts | null = null;

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const withDate = range !== '24h';
    return {
      tooltip: { trigger: 'axis', ...getTooltipStyle() },
      legend: { bottom: 0, ...getLegendStyle() },
      grid: { left: '3%', right: '4%', top: 8, bottom: 36, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => formatTimestamp(p.time, { precision: 'minute', withDate })),
        ...axisStyle,
      },
      yAxis: {
        type: 'value',
        name: 'ms',
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (v: number) => v.toLocaleString('en-US'),
        },
      },
      series: [
        {
          name: 'Average',
          type: 'line',
          showSymbol: false,
          connectNulls: false,
          data: points.map((p) => p.avgMs),
          lineStyle: { color: chartColors.series.blue },
          itemStyle: { color: chartColors.series.blue },
        },
        {
          name: 'p95',
          type: 'line',
          showSymbol: false,
          connectNulls: false,
          data: points.map((p) => p.p95Ms),
          lineStyle: { color: chartColors.series.amber, type: 'dashed' },
          itemStyle: { color: chartColors.series.amber },
        },
      ],
    };
  }

  function render() {
    chart?.setOption(buildOption(), true);
  }

  $effect(() => {
    if (!container) return;
    const el = container;
    const instance = echarts.init(el);
    chart = instance;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => instance.resize()) : null;
    observer?.observe(el);
    const unsubTheme = themeStore.subscribe(() => untrack(render));
    const unsubPrefs = displayPreferences.subscribe(() => untrack(render));
    untrack(render);
    return () => {
      observer?.disconnect();
      unsubTheme();
      unsubPrefs();
      instance.dispose();
      chart = null;
    };
  });

  $effect(() => {
    // Redraw whenever the data or the range changes.
    points;
    range;
    if (chart) untrack(render);
  });
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between gap-2">
    <h2 class="text-sm font-medium">Response time</h2>
    <div class="flex gap-1" role="group" aria-label="Response time range">
      {#each RANGES as r (r.value)}
        <Button
          variant={range === r.value ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={range === r.value}
          onclick={() => onRangeChange(r.value)}
        >
          {r.label}
        </Button>
      {/each}
    </div>
  </div>

  {#if hasData}
    <div bind:this={container} class="h-64 w-full" data-testid="response-time-chart"></div>
  {:else}
    <EmptyState
      variant="no-data"
      title="No response times yet"
      description="Response times appear after the first successful checks in this range."
    />
  {/if}
</div>
