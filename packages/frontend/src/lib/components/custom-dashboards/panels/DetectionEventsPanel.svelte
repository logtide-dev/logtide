<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import { themeStore } from '$lib/stores/theme';
  import {
    chartColors,
    getAxisStyle,
    getTooltipStyle,
    getLegendStyle,
  } from '$lib/utils/echarts-theme';
  import type { DetectionEventsConfig } from '@logtide/shared';

  interface DetectionEventsData {
    series: Array<{ time: string; count: number }>;
    totalDetections: number;
    bySeverity: Array<{ severity: string; count: number }>;
  }

  interface Props {
    config: DetectionEventsConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  const typed = $derived(data as DetectionEventsData | null);

  function fmtTime(t: string): string {
    return new Date(t).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();
    const series = typed?.series ?? [];
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle },
      legend: { bottom: 0, ...legendStyle },
      grid: { left: '3%', right: '4%', top: 8, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: true,
        data: series.map((d) => fmtTime(d.time)),
        ...axisStyle,
      },
      yAxis: { type: 'value', minInterval: 1, ...axisStyle },
      series: [
        {
          name: 'Detections',
          type: 'bar',
          data: series.map((d) => d.count),
          itemStyle: { color: chartColors.series.purple },
        },
      ],
    };
  }

  onMount(() => {
    chart = echarts.init(chartContainer);
    chart.setOption(buildOption());
    const observer = new ResizeObserver(() => chart?.resize());
    observer.observe(chartContainer);
    const unsub = themeStore.subscribe(() => {
      if (chart) chart.setOption(buildOption(), true);
    });
    return () => {
      observer.disconnect();
      unsub();
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chart && typed) {
      chart.setOption(buildOption(), true);
    }
  });
</script>

<div class="w-full h-full flex flex-col">
  <div class="px-3 pt-2 pb-1 flex items-center justify-between text-xs text-muted-foreground">
    <span>Total: <strong class="text-foreground">{typed?.totalDetections ?? 0}</strong></span>
    {#if typed?.bySeverity}
      <span class="flex gap-2">
        {#each typed.bySeverity as sev}
          <span class="capitalize">{sev.severity}: {sev.count}</span>
        {/each}
      </span>
    {/if}
  </div>
  <div class="flex-1 min-h-0 p-3 pt-0">
    <div bind:this={chartContainer} class="w-full h-full"></div>
  </div>
</div>
