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
  import type { TraceVolumeConfig } from '@logtide/shared';

  interface TraceVolumePanelData {
    series: Array<{ time: string; total: number; errors: number }>;
    serviceName: string | null;
    timeRange: string;
    bucket: 'hour' | 'day';
  }

  interface Props {
    config: TraceVolumeConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  const typedData = $derived(data as TraceVolumePanelData | null);

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();
    const prefs = displayPreferences.get();
    const series = typedData?.series ?? [];
    const bucket = typedData?.bucket ?? 'hour';
    const labelStyle = bucket === 'day' ? 'monthDay' : 'time';

    const chartSeries: echarts.SeriesOption[] = [
      {
        name: 'Spans',
        type: 'line',
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.08 },
        data: series.map((d) => d.total),
        lineStyle: { color: chartColors.series.blue },
        itemStyle: { color: chartColors.series.blue },
      },
    ];

    if (config.showErrors) {
      chartSeries.push({
        name: 'Errors',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: series.map((d) => d.errors),
        lineStyle: { color: chartColors.series.red },
        itemStyle: { color: chartColors.series.red },
      });
    }

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, ...tooltipStyle },
      legend: { bottom: 0, ...legendStyle },
      grid: { left: '3%', right: '4%', top: 8, bottom: 32, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: series.map((d) => formatTimestamp(d.time, labelStyle, prefs)),
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
    if (chart && typedData) {
      chart.setOption(buildOption(), true);
    }
  });
</script>

<div class="w-full h-full p-3">
  <div bind:this={chartContainer} class="w-full h-full"></div>
</div>
