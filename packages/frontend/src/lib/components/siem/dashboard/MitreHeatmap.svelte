<script lang="ts">
	import { onMount } from 'svelte';
	import * as echarts from 'echarts';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import type { MitreHeatmapCell } from '$lib/api/siem';
	import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
	import { getTacticName, getTechniqueName } from '$lib/utils/mitre';
	import { themeStore } from '$lib/stores/theme';
	import { getEChartsTheme, getTooltipStyle } from '$lib/utils/echarts-theme';

	interface Props {
		cells: MitreHeatmapCell[] | undefined;
		onCellClick?: (cell: MitreHeatmapCell) => void;
	}

	let { cells, onCellClick }: Props = $props();

	let chartContainer = $state<HTMLDivElement | null>(null);
	let chart: echarts.ECharts | null = null;

	// MITRE ATT&CK tactic abbreviations (for compact display)
	const tacticAbbreviations: Record<string, string> = {
		reconnaissance: 'Recon',
		resource_development: 'Res Dev',
		initial_access: 'Init Access',
		execution: 'Exec',
		persistence: 'Persist',
		privilege_escalation: 'Priv Esc',
		defense_evasion: 'Def Eva',
		credential_access: 'Cred',
		discovery: 'Disc',
		lateral_movement: 'Lat Mov',
		collection: 'Coll',
		command_and_control: 'C2',
		exfiltration: 'Exfil',
		impact: 'Impact',
	};

	function abbreviateTactic(tactic: string): string {
		const lower = tactic.toLowerCase().replace(/-/g, '_');
		return tacticAbbreviations[lower] || getTacticName(tactic).slice(0, 8);
	}

	function abbreviateTechnique(technique: string): string {
		// Get human-readable name from MITRE mapping
		const name = getTechniqueName(technique);
		// If we have a human-readable name (not just the ID), use it
		if (name !== technique) {
			// Truncate long names
			return name.length > 12 ? name.slice(0, 10) + '..' : name;
		}
		// Fallback to technique ID
		if (technique.match(/^T\d{4}/i)) {
			return technique.split('.')[0].toUpperCase();
		}
		return technique.slice(0, 8);
	}

	function getFullTechniqueName(technique: string): string {
		const name = getTechniqueName(technique);
		if (name !== technique) {
			return `${technique}: ${name}`;
		}
		return technique;
	}

	onMount(() => {
		if (!chartContainer) return;
		chart = echarts.init(chartContainer);
		updateChart();

		const handleResize = () => chart?.resize();
		window.addEventListener('resize', handleResize);

		// Subscribe to theme changes
		const unsubscribe = themeStore.subscribe(() => {
			if (chart) {
				updateChart();
			}
		});

		return () => {
			window.removeEventListener('resize', handleResize);
			unsubscribe();
			chart?.dispose();
		};
	});

	function updateChart() {
		if (!chart || !cells || cells.length === 0) return;

		const theme = getEChartsTheme();
		const tooltipStyle = getTooltipStyle();

		// Extract unique tactics and techniques
		const tactics = [...new Set(cells.map((c) => c.tactic))].sort();
		const techniques = [...new Set(cells.map((c) => c.technique))].sort();

		// Limit to top 10 techniques if more
		const topTechniques = techniques.slice(0, 10);

		// Build data matrix
		const data: [number, number, number][] = [];
		const maxCount = Math.max(...cells.map((c) => c.count), 1);

		topTechniques.forEach((technique, techIndex) => {
			tactics.forEach((tactic, tacticIndex) => {
				const cell = cells.find((c) => c.technique === technique && c.tactic === tactic);
				if (cell) {
					data.push([tacticIndex, techIndex, cell.count]);
				}
			});
		});

		// Theme-aware gradient colors
		const gradientColors = theme.isDark
			? ['#0f172a', '#1d4ed8', '#dc2626', '#991b1b']
			: ['#e0f2fe', '#3b82f6', '#ef4444', '#b91c1c'];

		const option: echarts.EChartsOption = {
			tooltip: {
				position: 'top',
				formatter: (params: unknown) => {
					const p = params as { data: [number, number, number] };
					const tacticId = tactics[p.data[0]];
					const techniqueId = topTechniques[p.data[1]];
					const count = p.data[2];
					const tacticFullName = getTacticName(tacticId);
					const techniqueFullName = getFullTechniqueName(techniqueId);
					return `<strong>${techniqueFullName}</strong><br/>Tactic: ${tacticFullName}<br/>${count} detection${count !== 1 ? 's' : ''}`;
				},
				...tooltipStyle
			},
			grid: {
				left: '15%',
				right: '10%',
				top: '5%',
				bottom: '30%',
			},
			xAxis: {
				type: 'category',
				data: tactics.map(abbreviateTactic),
				splitArea: { show: true },
				axisLabel: {
                    show: false,
				},

			},
			yAxis: {
				type: 'category',
				data: topTechniques.map(abbreviateTechnique),
				splitArea: { show: true },
				axisLabel: {
					fontSize: 9,
					color: theme.textColor,
				},
			},
			visualMap: {
				min: 0,
				max: maxCount,
				calculable: true,
				orient: 'horizontal',
				left: 'center',
				bottom: '3%',
				inRange: {
					color: gradientColors,
				},
				textStyle: {
					color: theme.textColor,
					fontSize: 10,
				},
			},
			series: [
				{
					type: 'heatmap',
					data: data,
					label: {
						show: true,
						formatter: (params: unknown) => {
							const p = params as { data: [number, number, number] };
							return p.data[2] > 0 ? p.data[2].toString() : '';
						},
						fontSize: 9,
					},
					emphasis: {
						itemStyle: {
							shadowBlur: 10,
							shadowColor: 'rgba(0, 0, 0, 0.5)',
						},
					},
				},
			],
		};

		chart.setOption(option);

		// Handle cell click
		chart.off('click');
		chart.on('click', (params) => {
			if (params.componentType === 'series' && params.data) {
				const [tacticIndex, techIndex] = params.data as [number, number, number];
				const cell = cells.find(
					(c) => c.tactic === tactics[tacticIndex] && c.technique === topTechniques[techIndex]
				);
				if (cell && onCellClick) {
					onCellClick(cell);
				}
			}
		});
	}

	$effect(() => {
		if (chart && cells) {
			updateChart();
		}
	});
</script>

<Card class="h-full">
	<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<Grid3x3 class="w-4 h-4 text-primary" />
			MITRE ATT&CK Heatmap
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if !cells || cells.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<Grid3x3 class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No MITRE data available</p>
			</div>
		{:else}
			<div bind:this={chartContainer} class="h-[280px] w-full"></div>
		{/if}
	</CardContent>
</Card>
