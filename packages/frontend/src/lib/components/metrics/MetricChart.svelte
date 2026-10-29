<script lang="ts">
  import { untrack } from 'svelte';
  import * as echarts from 'echarts';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { chartColors, getAxisStyle, getTooltipStyle, getLegendStyle } from '$lib/utils/echarts-theme';
  import { themeStore } from '$lib/stores/theme';
  import { formatTimestamp } from '$lib/utils/datetime';
  import { formatMetricValue, type MetricUnit } from '$lib/utils/metrics-query';
  import type { MetricAggregateResult } from '$lib/api/metrics';

  interface Props {
    result: MetricAggregateResult | null;
    unit: MetricUnit;
    loading: boolean;
    error: string | null;
    onBucketClick?: (bucketStart: Date, bucketSeconds: number) => void;
    /** Hint shown in the tooltip when clicking a bucket does something. */
    clickHint?: string;
  }

  let { result, unit, loading, error, onBucketClick, clickHint }: Props = $props();

  const palette = [
    chartColors.series.blue,
    chartColors.series.green,
    chartColors.series.amber,
    chartColors.series.purple,
    chartColors.series.orange,
    chartColors.series.red,
    chartColors.series.yellow,
    chartColors.series.gray,
  ];

  let container = $state<HTMLDivElement | undefined>(undefined);
  let chart: echarts.ECharts | null = null;

  let capped = $derived(
    result !== null &&
      typeof result.seriesTotal === 'number' &&
      typeof result.seriesShown === 'number' &&
      result.seriesTotal > result.seriesShown
  );

  let hasData = $derived(result !== null && result.timeseries.length > 0);

  function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  function buildOption(data: MetricAggregateResult): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();
    const legendStyle = getLegendStyle();

    const groups = new Map<string, [number, number][]>();
    for (const point of data.timeseries) {
      const name = point.labels && Object.keys(point.labels).length > 0
        ? Object.entries(point.labels).map(([k, v]) => `${k}=${v}`).join(', ')
        : data.metricName;
      const list = groups.get(name) ?? [];
      list.push([new Date(point.bucket).getTime(), point.value]);
      groups.set(name, list);
    }
    const names = [...groups.keys()];

    const series: echarts.SeriesOption[] = names.map((name, i) => {
      const color = palette[i % palette.length];
      return {
        name,
        type: 'line',
        smooth: false,
        showSymbol: false,
        cursor: onBucketClick ? 'pointer' : 'default',
        data: groups.get(name)!.sort((a, b) => a[0] - b[0]),
        lineStyle: { color },
        itemStyle: { color },
        areaStyle: names.length === 1 ? { color, opacity: 0.12 } : undefined,
      };
    });

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        ...tooltipStyle,
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? (params as any[]) : [];
          if (list.length === 0) return '';
          const rows = list
            .map((p) => {
              const v = Array.isArray(p.value) ? p.value[1] : p.value;
              const text = typeof v === 'number' ? formatMetricValue(v, unit) : String(v);
              return `<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color}"></span><span>${escapeHtml(String(p.seriesName))}:</span><strong>${escapeHtml(text)}</strong></div>`;
            })
            .join('');
          const when = Array.isArray(list[0].value) ? formatTimestamp(list[0].value[0]) : '';
          const hint = onBucketClick && clickHint
            ? `<div style="color:#888;font-size:11px;margin-top:6px;border-top:1px solid rgba(128,128,128,0.2);padding-top:4px">${escapeHtml(clickHint)}</div>`
            : '';
          return `<div style="font-size:12px"><div style="font-weight:600;margin-bottom:4px">${escapeHtml(when)}</div>${rows}${hint}</div>`;
        },
      },
      legend: { data: names, bottom: 0, type: 'scroll', ...legendStyle },
      grid: { left: '3%', right: '4%', bottom: '12%', containLabel: true },
      xAxis: {
        type: 'time',
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => formatTimestamp(value, { precision: 'minute' }),
        },
      },
      yAxis: {
        type: 'value',
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => formatMetricValue(value, unit),
        },
      },
      series,
    };
  }

  function render() {
    if (!chart) return;
    if (result && result.timeseries.length > 0) chart.setOption(buildOption(result), true);
    else chart.clear();
  }

  $effect(() => {
    const el = container;
    if (!el) return;

    const teardown = untrack(() => {
      chart = echarts.init(el);
      chart.on('click', (params: any) => {
        if (!onBucketClick || !params?.value || !Array.isArray(params.value)) return;
        onBucketClick(new Date(params.value[0]), result?.bucketSeconds ?? 0);
      });

      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => chart?.resize()) : null;
      observer?.observe(el);
      const unsubTheme = themeStore.subscribe(() => render());
      render();


      return () => {
        observer?.disconnect();
        unsubTheme();
        chart?.dispose();
        chart = null;
      };
    });
    return teardown;
  });

  // Re-render on data or unit changes.
  $effect(() => {
    void result;
    void unit;
    render();
  });
</script>

<div class="space-y-2">
  {#if capped && result}
    <p class="text-sm text-muted-foreground" role="status">
      Showing {result.seriesShown?.toLocaleString('en-US')} of {result.seriesTotal?.toLocaleString('en-US')} series, the ones with the highest values
    </p>
  {/if}

  {#if loading && !hasData}
    <div class="flex h-[350px] items-center justify-center text-sm text-muted-foreground" role="status">
      Loading chart
    </div>
  {:else if error}
    <div class="h-[350px]">
      <EmptyState variant="error" title="Could not load the chart" description={error} />
    </div>
  {:else if !hasData}
    <div class="h-[350px]">
      <EmptyState
        variant="no-data"
        title="No data for this query"
        description="Try a wider time range or remove a filter."
      />
    </div>
  {:else}
    <div class="relative">
      <div bind:this={container} class="h-[350px] w-full" aria-label="Metric chart" role="img"></div>
      {#if loading}
        <div class="absolute right-2 top-2 text-xs text-muted-foreground" role="status">Updating</div>
      {/if}
    </div>
  {/if}
</div>
