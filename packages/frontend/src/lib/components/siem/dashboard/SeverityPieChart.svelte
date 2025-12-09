<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { SeverityDistribution, Severity } from '$lib/api/siem';
	import PieChart from '@lucide/svelte/icons/pie-chart';

	interface Props {
		distribution: SeverityDistribution[] | undefined;
	}

	let { distribution }: Props = $props();

	let chartContainer: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	function getSeverityColor(severity: Severity): string {
		switch (severity) {
			case 'critical':
				return '#a855f7'; // purple-500
			case 'high':
				return '#ef4444'; // red-500
			case 'medium':
				return '#f97316'; // orange-500
			case 'low':
				return '#eab308'; // yellow-500
			case 'informational':
				return '#3b82f6'; // blue-500
			default:
				return '#6b7280'; // gray-500
		}
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

	onMount(() => {
		chart = echarts.init(chartContainer);

		const option: echarts.EChartsOption = {
			tooltip: {
				trigger: 'item',
				formatter: (params: unknown) => {
					const p = params as { name: string; value: number; percent: number };
					return `${p.name}<br/><strong>${p.value}</strong> (${p.percent.toFixed(1)}%)`;
				},
			},
			legend: {
				orient: 'horizontal',
				bottom: 0,
				textStyle: {
					color: '#888',
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

		chart.setOption(option);

		const handleResize = () => chart?.resize();
		window.addEventListener('resize', handleResize);

		return () => {
			window.removeEventListener('resize', handleResize);
			chart?.dispose();
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
			Severity Distribution
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if !distribution || distribution.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<PieChart class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No data available</p>
			</div>
		{:else}
			<div bind:this={chartContainer} class="h-[200px] w-full"></div>
		{/if}
	</CardContent>
</Card>
