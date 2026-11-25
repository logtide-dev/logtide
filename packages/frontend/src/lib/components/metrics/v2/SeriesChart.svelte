<!--
  One ECharts chart for a list of MetricSeries (internal building block of
  MetricSeriesView, also usable on its own).

  Props:
    series        series to draw (comparison copies are drawn dashed)
    mode          'lines' | 'area' | 'bars'
    colors        Map base series id -> color (buildColorMap)
    metricNames   queryId -> metric name, lets "1" utilization ratios show as %
    height        px
    compact       small multiple: no legend, few axis labels
    yRange        fixed { min, max } for a shared y axis, or null for auto
    onSeriesClick called with the series when a line/bar is clicked
    threshold     optional raw value drawn as a dashed line on the first y axis
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import * as echarts from 'echarts';
  import { formatMetricValue, metricUnitLabel, type MetricSeries } from '@logtide/shared';
  import { getAxisStyle, getTooltipStyle } from '$lib/utils/echarts-theme';
  import { themeStore } from '$lib/stores/theme';
  import { formatTimestamp } from '$lib/utils/datetime';
  import { baseSeriesId, escapeHtml, seriesLabel } from '$lib/utils/metrics-series';

  interface Props {
    series: MetricSeries[];
    mode?: 'lines' | 'area' | 'bars';
    colors: Map<string, string>;
    metricNames?: Record<string, string>;
    height?: number;
    compact?: boolean;
    yRange?: { min: number; max: number } | null;
    onSeriesClick?: (series: MetricSeries) => void;
    threshold?: number | null;
  }

  let {
    series,
    mode = 'lines',
    colors,
    metricNames = {},
    height = 320,
    compact = false,
    yRange = null,
    onSeriesClick,
    threshold = null,
  }: Props = $props();

  let container = $state<HTMLDivElement | undefined>(undefined);
  let chart: echarts.ECharts | null = null;

  function fmt(s: MetricSeries, v: number): string {
    return formatMetricValue(v, s.unit, metricNames[s.queryId]);
  }

  function buildOption(): echarts.EChartsOption {
    const axisStyle = getAxisStyle();
    const tooltipStyle = getTooltipStyle();

    // First two distinct units get their own y axis; the rest share the first.
    const unitKeys: string[] = [];
    for (const s of series) {
      const key = `${s.unit ?? ''}|${metricNames[s.queryId] ?? ''}`;
      if (!unitKeys.includes(key)) unitKeys.push(key);
    }
    const axisIndexOf = (s: MetricSeries) => {
      const i = unitKeys.indexOf(`${s.unit ?? ''}|${metricNames[s.queryId] ?? ''}`);
      return i === 1 ? 1 : 0;
    };
    const axisSeries = (idx: number) => series.find((s) => axisIndexOf(s) === idx);

    const hasThreshold = typeof threshold === 'number' && Number.isFinite(threshold);
    const yAxes: echarts.YAXisComponentOption[] = [0, ...(unitKeys.length > 1 ? [1] : [])].map((idx) => {
      const ref = axisSeries(idx)!;
      const unitText = metricUnitLabel(ref.unit, metricNames[ref.queryId]);
      return {
        type: 'value',
        ...axisStyle,
        position: idx === 0 ? 'left' : 'right',
        name: compact ? undefined : (unitText ?? undefined),
        splitLine: idx === 0 ? axisStyle.splitLine : { show: false },
        min: yRange && idx === 0 ? yRange.min : undefined,
        // Keep the threshold line in view when the data stays below it.
        max:
          yRange && idx === 0
            ? yRange.max
            : idx === 0 && hasThreshold
              ? (extent: { max: number }) => Math.max(extent.max, threshold as number)
              : undefined,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => formatMetricValue(value, ref.unit, metricNames[ref.queryId]),
        },
      };
    });

    const echartsSeries: echarts.SeriesOption[] = series.map((s) => {
      const color = colors.get(baseSeriesId(s)) ?? '#6b7280';
      const data = s.points.map((p) => [new Date(p.t).getTime(), p.v] as [number, number | null]);
      const common = {
        id: s.id,
        name: seriesLabel(s),
        yAxisIndex: axisIndexOf(s),
        data,
        itemStyle: { color },
        cursor: onSeriesClick ? 'pointer' : 'default',
      };
      if (mode === 'bars') {
        return { ...common, type: 'bar', itemStyle: { color, opacity: s.comparison ? 0.45 : 1 } } as echarts.SeriesOption;
      }
      return {
        ...common,
        type: 'line',
        smooth: false,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color, width: compact ? 1.5 : 2, type: s.comparison ? 'dashed' : 'solid', opacity: s.comparison ? 0.65 : 1 },
        areaStyle: mode === 'area' && !s.comparison ? { color, opacity: 0.15 } : undefined,
      } as echarts.SeriesOption;
    });

    const firstOnAxis0 = echartsSeries.findIndex((_, i) => axisIndexOf(series[i]) === 0);
    if (hasThreshold && firstOnAxis0 >= 0) {
      const ref = series[firstOnAxis0];
      (echartsSeries[firstOnAxis0] as Record<string, unknown>).markLine = {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', color: '#ef4444', width: 1.5 },
        label: {
          position: 'insideEndTop',
          formatter: () => `Threshold ${formatMetricValue(threshold as number, ref.unit, metricNames[ref.queryId])}`,
        },
        data: [{ yAxis: threshold }],
      };
    }

    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        ...tooltipStyle,
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? (params as any[]) : [];
          if (list.length === 0) return '';
          const rows = list
            .map((p) => {
              const s = series.find((x) => x.id === p.seriesId);
              const v = Array.isArray(p.value) ? p.value[1] : p.value;
              const text = s && typeof v === 'number' ? fmt(s, v) : 'n/a';
              return `<div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color}"></span><span>${escapeHtml(String(p.seriesName))}:</span><strong>${escapeHtml(text)}</strong></div>`;
            })
            .join('');
          const when = Array.isArray(list[0].value) ? formatTimestamp(list[0].value[0]) : '';
          return `<div style="font-size:12px"><div style="font-weight:600;margin-bottom:4px">${escapeHtml(when)}</div>${rows}</div>`;
        },
      },
      grid: compact
        ? { left: 4, right: 8, top: 6, bottom: 4, containLabel: true }
        : { left: '3%', right: yAxes.length > 1 ? '4%' : '3%', top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'time',
        ...axisStyle,
        axisLabel: {
          ...axisStyle.axisLabel,
          formatter: (value: number) => formatTimestamp(value, { precision: 'minute' }),
        },
        show: true,
      },
      yAxis: yAxes,
      series: echartsSeries,
    };
  }

  function render() {
    if (!chart) return;
    if (series.length > 0) chart.setOption(buildOption(), true);
    else chart.clear();
  }

  $effect(() => {
    const el = container;
    if (!el) return;
    return untrack(() => {
      chart = echarts.init(el);
      chart.on('click', (params: any) => {
        if (!onSeriesClick) return;
        const s = series.find((x) => x.id === params?.seriesId);
        if (s) onSeriesClick(s);
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
  });

  $effect(() => {
    void series;
    void mode;
    void yRange;
    void metricNames;
    void colors;
    void threshold;
    render();
  });
</script>

<div bind:this={container} class="w-full" style:height="{height}px" role="img" aria-label={compact ? 'Series chart' : 'Metric chart'}></div>
