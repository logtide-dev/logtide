<script lang="ts">
  import { onMount } from "svelte";
  import * as echarts from "echarts";
  import { chartColors, getTooltipStyle } from "$lib/utils/echarts-theme";
  import { themeStore } from "$lib/stores/theme";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import type { MetricAggregateResult, MetricType } from "$lib/api/metrics";

  interface Props {
    title: string;
    metricType: MetricType;
    value: number;
    unit?: string;
    timeseries: MetricAggregateResult | null;
    loading?: boolean;
    color?: string;
  }

  let {
    title,
    metricType,
    value,
    unit = '',
    timeseries,
    loading = false,
    color = chartColors.series.blue,
  }: Props = $props();

  let chartContainer = $state<HTMLDivElement | undefined>(undefined);
  let chart: echarts.ECharts | null = null;

  onMount(() => {
    return () => {
      resizeObserver?.disconnect();
      unsubTheme?.();
      chart?.dispose();
    };
  });

  let resizeObserver: ResizeObserver | null = null;
  let unsubTheme: (() => void) | null = null;

  $effect(() => {
    if (chartContainer && !chart) {
      chart = echarts.init(chartContainer);
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(chartContainer);
      unsubTheme = themeStore.subscribe(() => {
        if (chart && timeseries) chart.setOption(getOption(), true);
      });
    } else if (!chartContainer && chart) {
      resizeObserver?.disconnect();
      unsubTheme?.();
      chart.dispose();
      chart = null;
    }
  });

  $effect(() => {
    if (chart && timeseries) {
      chart.setOption(getOption(), true);
    } else if (chart && !timeseries) {
      chart.clear();
    }
  });

  function getOption(): echarts.EChartsOption {
    if (!timeseries) return {};
    const tooltipStyle = getTooltipStyle();
    const buckets = timeseries.timeseries.map(p => {
      const d = typeof p.bucket === 'string' ? new Date(p.bucket) : p.bucket;
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    });
    const values = timeseries.timeseries.map(p => p.value);

    return {
      tooltip: { trigger: 'axis', ...tooltipStyle },
      grid: { left: 8, right: 8, top: 8, bottom: 24, containLabel: false },
      xAxis: { type: 'category', data: buckets, show: false, boundaryGap: false },
      yAxis: { type: 'value', show: false },
      series: [{
        type: 'line',
        data: values,
        smooth: true,
        showSymbol: false,
        lineStyle: { color, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + '40' },
            { offset: 1, color: color + '05' },
          ]),
        },
      }],
    };
  }

  function formatValue(v: number): string {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(2);
  }
</script>

<Card class="relative overflow-hidden">
  <CardHeader class="pb-2">
    <div class="flex items-center justify-between">
      <CardTitle class="text-sm font-medium text-muted-foreground truncate">{title}</CardTitle>
      <Badge variant="outline" class="text-[10px] shrink-0">{metricType}</Badge>
    </div>
  </CardHeader>
  <CardContent>
    <div class="text-2xl font-bold mb-2">
      {formatValue(value)}{#if unit}<span class="text-sm font-normal text-muted-foreground ml-1">{unit}</span>{/if}
    </div>
    {#if loading}
      <div class="h-[80px] flex items-center justify-center">
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
      </div>
    {:else}
      <div bind:this={chartContainer} class="h-[80px] w-full"></div>
    {/if}
  </CardContent>
</Card>
