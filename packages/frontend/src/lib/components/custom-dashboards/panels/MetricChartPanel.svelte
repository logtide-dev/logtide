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
  import type { MetricChartConfig } from '@logtide/shared';

  interface MetricChartData {
    metricName: string;
    metricType: string;
    series: Array<{ time: string; value: number; labels?: Record<string, string> }>;
    aggregation: string;
    interval: string;
  }

  interface Props {
    config: MetricChartConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  const typed = $derived(data as MetricChartData | null);

  function fmtTime(t: string): string {
    return new Date(t).toLocaleTimeString('en-US', {
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
        boundaryGap: false,
        data: series.map((d) => fmtTime(d.time)),
        ...axisStyle,
      },
      yAxis: { type: 'value', ...axisStyle },
      series: [
        {
          name: `${config.aggregation}(${config.metricName})`,
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: series.map((d) => d.value),
          areaStyle: { opacity: 0.15 },
          lineStyle: { color: chartColors.series.blue },
          itemStyle: { color: chartColors.series.blue },
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

<div class="w-full h-full p-3">
  <div bind:this={chartContainer} class="w-full h-full"></div>
</div>
