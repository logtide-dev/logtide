<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import { themeStore } from '$lib/stores/theme';
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { formatTimestamp } from '$lib/utils/format-time';
  import {
    chartColors,
    getAxisStyle,
    getTooltipStyle,
    getLegendStyle,
  } from '$lib/utils/echarts-theme';
  import type { MetricChartConfig } from '@logtide/shared';
  import { shapeMetricSeries } from './metric-series';

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

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();
    const prefs = displayPreferences.get();
    const shaped = shapeMetricSeries(
      typed?.series ?? [],
      `${config.aggregation}(${config.metricName})`
    );
    const palette = Object.values(chartColors.series);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle },
      legend: { bottom: 0, ...legendStyle },
      grid: { left: '3%', right: '4%', top: 8, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: shaped.times.map((t) => formatTimestamp(t, 'time', prefs)),
        ...axisStyle,
      },
      yAxis: { type: 'value', ...axisStyle },
      series: shaped.series.map((line, i) => {
        const color = palette[i % palette.length];
        return {
          name: line.name,
          type: 'line' as const,
          smooth: true,
          showSymbol: false,
          connectNulls: true,
          data: line.data,
          areaStyle: { opacity: shaped.grouped ? 0.05 : 0.15 },
          lineStyle: { color },
          itemStyle: { color },
        };
      }),
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
    // Axis labels are built inside buildOption(), not in markup, so the clock
    // preference has to trigger a redraw explicitly.
    const unsubPrefs = displayPreferences.subscribe(() => {
      if (chart) chart.setOption(buildOption(), true);
    });
    return () => {
      observer.disconnect();
      unsub();
      unsubPrefs();
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
