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
  import type {
    ActivityOverviewConfig,
    ActivityOverviewSeries,
  } from '@logtide/shared';

  interface ActivityOverviewPanelData {
    series: Array<{
      time: string;
      logs: number;
      log_errors: number;
      spans: number;
      span_errors: number;
      detections: number;
      alerts: number;
    }>;
    timeRange: string;
    bucket: 'hour' | 'day';
    enabled: ActivityOverviewSeries[];
  }

  interface Props {
    config: ActivityOverviewConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  const typedData = $derived(data as ActivityOverviewPanelData | null);

  const SERIES_META: Record<
    ActivityOverviewSeries,
    { label: string; color: string; key: keyof ActivityOverviewPanelData['series'][number] }
  > = {
    logs: { label: 'Logs', color: chartColors.series.blue, key: 'logs' },
    log_errors: { label: 'Log errors', color: chartColors.series.red, key: 'log_errors' },
    spans: { label: 'Spans', color: chartColors.series.green, key: 'spans' },
    span_errors: { label: 'Span errors', color: chartColors.series.amber, key: 'span_errors' },
    detections: { label: 'Detections', color: chartColors.series.purple ?? '#a855f7', key: 'detections' },
    alerts: { label: 'Alerts', color: chartColors.series.gray ?? '#9ca3af', key: 'alerts' },
  };

  function formatTimeLabel(time: string, bucket: 'hour' | 'day'): string {
    const d = new Date(time);
    if (bucket === 'day') {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();
    const series = typedData?.series ?? [];
    const bucket = typedData?.bucket ?? 'hour';
    const enabled = config.series;

    const chartSeries: echarts.SeriesOption[] = enabled.map((s) => {
      const meta = SERIES_META[s];
      return {
        name: meta.label,
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => Number(d[meta.key] ?? 0)),
        lineStyle: { color: meta.color },
        itemStyle: { color: meta.color },
      };
    });

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle },
      legend: { bottom: 0, ...legendStyle },
      grid: { left: '3%', right: '4%', top: 8, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: series.map((d) => formatTimeLabel(d.time, bucket)),
        ...axisStyle,
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        ...axisStyle,
      },
      series: chartSeries,
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
