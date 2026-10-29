<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { TimelineBucket } from '$lib/api/siem';
	import Activity from '@lucide/svelte/icons/activity';
	import { themeStore } from '$lib/stores/theme';
	import { getAxisStyle, getTooltipStyle } from '$lib/utils/echarts-theme';
	import { severityTone } from '$lib/utils/severity';
	import { formatTimestamp, formatDateTime, formatDateShort } from '$lib/utils/datetime';

	interface Props {
		data: TimelineBucket[] | undefined;
		timeRange?: '24h' | '7d' | '30d';
	}

	let { data, timeRange = '24h' }: Props = $props();

	let chartContainer: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	function formatTimeLabel(timestamp: string | Date): string {
		if (timeRange === '24h') {
			return formatTimestamp(timestamp, { precision: 'minute', withDate: false });
		}
		return formatDateShort(timestamp);
	}

	// One series, drawn in the severity colour of the high band.
	const lineColor = severityTone('high').chart;

	const summary = $derived.by(() => {
		if (!data || data.length === 0) return 'No detections in this period';
		const total = data.reduce((sum, d) => sum + d.count, 0);
		return `Detection timeline, ${total.toLocaleString('en-US')} detections in ${data.length.toLocaleString('en-US')} intervals`;
	});

	function getChartOption(): echarts.EChartsOption {
		const axisStyle = getAxisStyle();
		const tooltipStyle = getTooltipStyle();

		return {
			tooltip: {
				trigger: 'axis',
				formatter: (params: unknown) => {
					const p = params as echarts.DefaultLabelFormatterCallbackParams[];
					if (p && p.length > 0) {
						const when = formatDateTime(data?.[p[0].dataIndex]?.timestamp || '');
						return `${when}<br/><strong>${Number(p[0].value).toLocaleString('en-US')}</strong> detections`;
					}
					return '';
				},
				...tooltipStyle
			},
			grid: {
				left: '3%',
				right: '4%',
				bottom: '8%',
				top: '8%',
				containLabel: true,
			},
			xAxis: {
				type: 'category',
				boundaryGap: false,
				data: data?.map((d) => formatTimeLabel(d.timestamp)) || [],
				...axisStyle
			},
			yAxis: {
				type: 'value',
				minInterval: 1,
				...axisStyle,
				axisLabel: {
					...axisStyle.axisLabel,
					formatter: (value: number) => {
						if (value % 1 !== 0) return '';
						return value.toLocaleString('en-US');
					}
				}
			},			series: [
				{
					name: 'Detections',
					type: 'line',
					smooth: true,
					data: data?.map((d) => d.count) || [],
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: `${lineColor}66` },
							{ offset: 1, color: `${lineColor}0d` },
						]),
					},
					lineStyle: {
						color: lineColor,
						width: 2,
					},
					itemStyle: {
						color: lineColor,
					},
					emphasis: {
						focus: 'series',
					},
				},
			],
		};
	}

	onMount(() => {
		chart = echarts.init(chartContainer);
		chart.setOption(getChartOption());

		const resizeObserver = new ResizeObserver(() => chart?.resize());
		resizeObserver.observe(chartContainer);

		// Subscribe to theme changes
		const unsubscribe = themeStore.subscribe(() => {
			if (chart) {
				chart.setOption(getChartOption());
			}
		});

		return () => {
			resizeObserver.disconnect();
			unsubscribe();
			chart?.dispose();
		};
	});

	$effect(() => {
		if (chart && data) {
			chart.setOption({
				xAxis: {
					data: data.map((d) => formatTimeLabel(d.timestamp)),
				},
				series: [
					{
						data: data.map((d) => d.count),
					},
				],
			});
		}
	});
</script>

<Card>
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-sm font-semibold flex items-center gap-2">
			<Activity class="w-4 h-4 text-primary" />
			Detection timeline
		</CardTitle>
	</CardHeader>
	<CardContent class="pb-3">
		<div bind:this={chartContainer} role="img" aria-label={summary} class="h-[140px] w-full"></div>
	</CardContent>
</Card>
