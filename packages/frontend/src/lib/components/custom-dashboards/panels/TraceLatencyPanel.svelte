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
  import type { TraceLatencyConfig } from '@logtide/shared';

  interface TraceLatencyRow {
    time: string;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    spanCount: number;
    errorRate: number;
  }

  interface TraceLatencyData {
    series: TraceLatencyRow[];
    serviceName: string | null;
  }

  interface Props {
    config: TraceLatencyConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  const typed = $derived(data as TraceLatencyData | null);

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
    const xData = series.map((d) => fmtTime(d.time));

    const lineSeries: echarts.SeriesOption[] = [];
    if (config.showPercentiles.includes('p50')) {
      lineSeries.push({
        name: 'p50',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.p50),
        lineStyle: { color: chartColors.series.green },
        itemStyle: { color: chartColors.series.green },
      });
    }
    if (config.showPercentiles.includes('p95')) {
      lineSeries.push({
        name: 'p95',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.p95),
        lineStyle: { color: chartColors.series.amber },
        itemStyle: { color: chartColors.series.amber },
      });
    }
    if (config.showPercentiles.includes('p99')) {
      lineSeries.push({
        name: 'p99',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.p99),
        lineStyle: { color: chartColors.series.red },
        itemStyle: { color: chartColors.series.red },
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        valueFormatter: (v) => (v == null ? '-' : `${Number(v).toFixed(0)} ms`),
        ...tooltipStyle,
      },
      legend: { bottom: 0, ...legendStyle },
      grid: { left: '3%', right: '4%', top: 8, bottom: 32, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: xData, ...axisStyle },
      yAxis: {
        type: 'value',
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (v: number) => `${v} ms`,
        },
      },
      series: lineSeries,
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
