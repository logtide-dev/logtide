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
  import type { TimeSeriesConfig } from '@logtide/shared';

  interface TimeSeriesPanelData {
    series: Array<{
      time: string;
      total: number;
      debug: number;
      info: number;
      warn: number;
      error: number;
      critical: number;
    }>;
    interval: string;
  }

  interface Props {
    config: TimeSeriesConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  const typedData = $derived(data as TimeSeriesPanelData | null);

  function formatTimeLabel(time: string): string {
    return new Date(time).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();
    const series = typedData?.series ?? [];
    const showDebug = config.levels.includes('debug');
    const showInfo = config.levels.includes('info');
    const showWarn = config.levels.includes('warn');
    const showError = config.levels.includes('error');
    const showCritical = config.levels.includes('critical');

    const lineSeries: echarts.SeriesOption[] = [];
    if (showDebug) {
      lineSeries.push({
        name: 'Debug',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.debug),
        lineStyle: { color: chartColors.series.gray ?? '#9ca3af' },
        itemStyle: { color: chartColors.series.gray ?? '#9ca3af' },
      });
    }
    if (showInfo) {
      lineSeries.push({
        name: 'Info',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.info),
        lineStyle: { color: chartColors.series.green },
        itemStyle: { color: chartColors.series.green },
      });
    }
    if (showWarn) {
      lineSeries.push({
        name: 'Warn',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.warn),
        lineStyle: { color: chartColors.series.amber },
        itemStyle: { color: chartColors.series.amber },
      });
    }
    if (showError) {
      lineSeries.push({
        name: 'Error',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.error),
        lineStyle: { color: chartColors.series.red },
        itemStyle: { color: chartColors.series.red },
      });
    }
    if (showCritical) {
      lineSeries.push({
        name: 'Critical',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.critical),
        lineStyle: { color: chartColors.series.purple ?? '#a855f7' },
        itemStyle: { color: chartColors.series.purple ?? '#a855f7' },
      });
    }

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle },
      legend: { bottom: 0, ...legendStyle },
      grid: { left: '3%', right: '4%', top: 8, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: series.map((d) => formatTimeLabel(d.time)),
        ...axisStyle,
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        ...axisStyle,
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
    if (chart && typedData) {
      chart.setOption(buildOption(), true);
    }
  });
</script>

<div class="w-full h-full p-3">
  <div bind:this={chartContainer} class="w-full h-full"></div>
</div>
