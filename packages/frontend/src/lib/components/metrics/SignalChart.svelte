<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import { getAxisStyle, getTooltipStyle } from '$lib/utils/echarts-theme';
  import { themeStore } from '$lib/stores/theme';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import Activity from '@lucide/svelte/icons/activity';

  interface SeriesData {
    label: string;
    color: string;
    values: Array<{ bucket: string; value: number }>;
  }

  interface Props {
    title: string;
    description: string;
    unit: string;
    series: SeriesData[];
    loading: boolean;
    empty: boolean;
    emptyHint: string;
  }

  let { title, description, unit, series, loading, empty, emptyHint }: Props = $props();

  let chartContainer = $state<HTMLDivElement | undefined>(undefined);
  let chart: echarts.ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let unsubTheme: (() => void) | null = null;

  onMount(() => {
    return () => {
      resizeObserver?.disconnect();
      unsubTheme?.();
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chartContainer && !chart) {
      chart = echarts.init(chartContainer);
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(chartContainer);
      unsubTheme = themeStore.subscribe(() => {
        if (chart && series.length > 0) chart.setOption(getOption(), true);
      });
    } else if (!chartContainer && chart) {
      resizeObserver?.disconnect();
      unsubTheme?.();
      chart.dispose();
      chart = null;
    }
  });

  $effect(() => {
    if (chart && series.length > 0) {
      chart.setOption(getOption(), true);
    } else if (chart) {
      chart.clear();
    }
  });

  function getOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();

    const allBuckets = [...new Set(series.flatMap(s => s.values.map(v => v.bucket)))].sort();

    const echartSeries: echarts.SeriesOption[] = series.map(s => {
      const bucketMap = new Map(s.values.map(v => [v.bucket, v.value]));
      return {
        name: s.label,
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: allBuckets.map(b => bucketMap.get(b) ?? null),
        lineStyle: { color: s.color, width: 2 },
        itemStyle: { color: s.color },
        areaStyle: series.length === 1
          ? {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: s.color + '30' },
                { offset: 1, color: s.color + '05' },
              ]),
            }
          : undefined,
      };
    });

    return {
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle,
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const lines = params.map((p: any) => {
            const val = typeof p.value === 'number' ? p.value.toFixed(2) : p.value;
            return `<div style="display:flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color}"></span>
              <span>${p.seriesName}:</span>
              <strong>${val} ${unit}</strong>
            </div>`;
          });
          return `<div style="font-size:12px">
            <div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>
            ${lines.join('')}
          </div>`;
        },
      },
      legend: series.length > 1
        ? { data: series.map(s => s.label), bottom: 0, textStyle: { fontSize: 11 } }
        : undefined,
      grid: { left: '3%', right: '4%', bottom: series.length > 1 ? '15%' : '5%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: allBuckets.map(b => {
          const d = new Date(b);
          return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        }),
        ...axisStyle,
      },
      yAxis: {
        type: 'value',
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => Number.isInteger(value) ? value.toString() : value.toFixed(1),
        },
      },
      series: echartSeries,
    };
  }
</script>

<Card class="h-full">
  <CardHeader class="pb-2">
    <CardTitle class="text-sm font-medium">{title}</CardTitle>
    <p class="text-xs text-muted-foreground">{description}</p>
  </CardHeader>
  <CardContent>
    {#if loading}
      <div class="flex items-center justify-center h-[200px]">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    {:else if empty}
      <div class="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
        <Activity class="w-8 h-8 mb-2 opacity-40" />
        <p class="text-xs text-center max-w-[200px]">{emptyHint}</p>
      </div>
    {:else}
      <div bind:this={chartContainer} class="h-[200px] w-full"></div>
    {/if}
  </CardContent>
</Card>
