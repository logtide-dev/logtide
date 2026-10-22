<script lang="ts">
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { SeverityDistribution, Severity } from '$lib/api/siem';
	import PieChart from '@lucide/svelte/icons/pie-chart';
	import { themeStore } from '$lib/stores/theme';
	import { getTooltipStyle, getLegendStyle } from '$lib/utils/echarts-theme';
	import { severityTone } from '$lib/utils/severity';

	interface Props {
		distribution: SeverityDistribution[] | undefined;
	}

	let { distribution }: Props = $props();

	let chartContainer = $state<HTMLDivElement>();
	let chart: echarts.ECharts | null = null;

	function getSeverityColor(severity: Severity): string {
		return severityTone(severity).chart;
	}

	function getSeverityLabel(severity: Severity): string {
		switch (severity) {
			case 'critical':
				return 'Critical';
			case 'high':
				return 'High';
			case 'medium':
				return 'Medium';
			case 'low':
				return 'Low';
			case 'informational':
				return 'Info';
			default:
				return severity;
		}
	}

	function getChartOption(): echarts.EChartsOption {
		const tooltipStyle = getTooltipStyle();
		const legendStyle = getLegendStyle();

		return {
			tooltip: {
				trigger: 'item',
				formatter: (params: unknown) => {
					const p = params as { name: string; value: number; percent: number };
					return `${p.name}<br/><strong>${p.value.toLocaleString('en-US')}</strong> (${p.percent.toFixed(1)}%)`;
				},
				...tooltipStyle
			},
			legend: {
				orient: 'horizontal',
				bottom: 0,
				textStyle: {
					...legendStyle.textStyle,
					fontSize: 11,
				},
			},
			series: [
				{
					type: 'pie',
					radius: ['40%', '70%'],
					avoidLabelOverlap: false,
					padAngle: 2,
					itemStyle: {
						borderRadius: 4,
					},
					label: {
						show: false,
					},
					emphasis: {
						label: {
							show: true,
							fontSize: 14,
							fontWeight: 'bold',
						},
					},
					data:
						distribution?.map((d) => ({
							name: getSeverityLabel(d.severity),
							value: d.count,
							itemStyle: {
								color: getSeverityColor(d.severity),
							},
						})) || [],
				},
			],
		};
	}

	const summary = $derived.by(() => {
		if (!distribution || distribution.length === 0) return 'No severity data';
		const total = distribution.reduce((sum, d) => sum + d.count, 0);
		const parts = distribution.map((d) => `${d.count.toLocaleString('en-US')} ${getSeverityLabel(d.severity).toLowerCase()}`);
		return `Severity distribution, ${total.toLocaleString('en-US')} detections: ${parts.join(', ')}`;
	});

	$effect(() => {
		if (!chartContainer) return;

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
			chart = null;
		};
	});

	$effect(() => {
		if (chart && distribution) {
			chart.setOption({
				series: [
					{
						data: distribution.map((d) => ({
							name: getSeverityLabel(d.severity),
							value: d.count,
							itemStyle: {
								color: getSeverityColor(d.severity),
							},
						})),
					},
				],
			});
		}
	});
</script>

<Card class="h-full">
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<PieChart class="w-4 h-4 text-primary" />
			Severity distribution
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if !distribution || distribution.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<PieChart class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No data available</p>
			</div>
		{:else}
			<div bind:this={chartContainer} role="img" aria-label={summary} class="h-[200px] w-full"></div>
		{/if}
	</CardContent>
</Card>
