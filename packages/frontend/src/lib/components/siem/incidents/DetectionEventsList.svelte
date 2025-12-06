<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow,
	} from '$lib/components/ui/table';
	import SeverityBadge from '../shared/SeverityBadge.svelte';
	import MitreTechniqueBadge from '../shared/MitreTechniqueBadge.svelte';
	import type { DetectionEvent } from '$lib/api/siem';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Clock from '@lucide/svelte/icons/clock';
	import Server from '@lucide/svelte/icons/server';

	interface Props {
		detections: DetectionEvent[];
		onLogClick?: (logId: string, projectId: string) => void;
	}

	let { detections, onLogClick }: Props = $props();

	let expandedRows = $state<Set<string>>(new Set());

	function toggleRow(id: string) {
		const newExpanded = new Set(expandedRows);
		if (newExpanded.has(id)) {
			newExpanded.delete(id);
		} else {
			newExpanded.add(id);
		}
		expandedRows = newExpanded;
	}

	function formatTime(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleTimeString('it-IT', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('it-IT', {
			month: 'short',
			day: 'numeric',
		});
	}

	function formatMatchedFields(fields: Record<string, unknown> | null): string {
		if (!fields) return 'No matched fields';
		return JSON.stringify(fields, null, 2);
	}

	function getLogLevelClass(level: string): string {
		switch (level.toLowerCase()) {
			case 'critical':
				return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-700';
			case 'error':
				return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300 dark:border-red-700';
			case 'warn':
			case 'warning':
				return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700';
			case 'info':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700';
			case 'debug':
				return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600';
			default:
				return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600';
		}
	}
</script>

<Card>
	<CardHeader class="pb-3">
		<CardTitle class="text-base font-semibold flex items-center gap-2">
			<AlertTriangle class="w-4 h-4 text-destructive" />
			Detection Events
			<span class="text-muted-foreground font-normal">({detections.length})</span>
		</CardTitle>
	</CardHeader>
	<CardContent>
		{#if detections.length === 0}
			<div class="text-center py-6 text-muted-foreground">
				<AlertTriangle class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p class="text-sm">No detection events</p>
			</div>
		{:else}
			<div class="rounded-md border overflow-hidden">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead class="w-[30px]"></TableHead>
							<TableHead class="w-[120px]">Time</TableHead>
							<TableHead class="w-[100px]">Severity</TableHead>
							<TableHead>Rule</TableHead>
							<TableHead class="w-[120px]">Service</TableHead>
							<TableHead class="w-[100px]">MITRE</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each detections as detection}
							{@const isExpanded = expandedRows.has(detection.id)}
							<TableRow
								class="cursor-pointer hover:bg-muted/50"
								onclick={() => toggleRow(detection.id)}
							>
								<TableCell class="py-2">
									<button class="p-1 hover:bg-accent rounded">
										{#if isExpanded}
											<ChevronUp class="w-4 h-4" />
										{:else}
											<ChevronDown class="w-4 h-4" />
										{/if}
									</button>
								</TableCell>
								<TableCell class="py-2">
									<div class="flex flex-col">
										<span class="text-xs font-mono">{formatTime(detection.time)}</span>
										<span class="text-xs text-muted-foreground">
											{formatDate(detection.time)}
										</span>
									</div>
								</TableCell>
								<TableCell class="py-2">
									<SeverityBadge severity={detection.severity} size="sm" />
								</TableCell>
								<TableCell class="py-2">
									<span class="font-medium text-sm truncate max-w-[200px] block">
										{detection.ruleTitle}
									</span>
								</TableCell>
								<TableCell class="py-2">
									<span class="font-mono text-xs">{detection.service}</span>
								</TableCell>
								<TableCell class="py-2">
									{#if detection.mitreTechniques && detection.mitreTechniques.length > 0}
										<MitreTechniqueBadge technique={detection.mitreTechniques[0]} />
									{:else}
										<span class="text-xs text-muted-foreground">-</span>
									{/if}
								</TableCell>
							</TableRow>

							{#if isExpanded}
								<TableRow class="bg-muted/30">
									<TableCell colspan={6} class="py-4">
										<div class="space-y-3 px-4">
											<!-- Log message -->
											<div>
												<p class="text-xs font-medium text-muted-foreground mb-1">
													Log Message
												</p>
												<p class="text-sm font-mono bg-background p-2 rounded border">
													{detection.logMessage}
												</p>
											</div>

											<!-- Details grid -->
											<div class="grid grid-cols-3 gap-4">
												<div>
													<p class="text-xs font-medium text-muted-foreground mb-1">
														Log Level
													</p>
													<span
														class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase {getLogLevelClass(detection.logLevel)}"
													>
														{detection.logLevel}
													</span>
												</div>
												{#if detection.traceId}
													<div>
														<p class="text-xs font-medium text-muted-foreground mb-1">
															Trace ID
														</p>
														<span class="text-xs font-mono">{detection.traceId}</span>
													</div>
												{/if}
												{#if detection.ruleDescription}
													<div>
														<p class="text-xs font-medium text-muted-foreground mb-1">
															Rule Description
														</p>
														<p class="text-xs">{detection.ruleDescription}</p>
													</div>
												{/if}
											</div>

											<!-- MITRE Info -->
											{#if (detection.mitreTactics && detection.mitreTactics.length > 0) || (detection.mitreTechniques && detection.mitreTechniques.length > 0)}
												<div>
													<p class="text-xs font-medium text-muted-foreground mb-1">
														MITRE ATT&CK
													</p>
													<div class="flex gap-2 flex-wrap">
														{#if detection.mitreTactics}
															{#each detection.mitreTactics as tactic}
																<Badge variant="outline" class="text-xs">
																	{tactic}
																</Badge>
															{/each}
														{/if}
														{#if detection.mitreTechniques}
															{#each detection.mitreTechniques as technique}
																<MitreTechniqueBadge {technique} />
															{/each}
														{/if}
													</div>
												</div>
											{/if}

											<!-- Matched Fields -->
											{#if detection.matchedFields}
												<div>
													<p class="text-xs font-medium text-muted-foreground mb-1">
														Matched Fields
													</p>
													<pre class="text-xs font-mono bg-background p-2 rounded border overflow-x-auto max-h-[200px]">{formatMatchedFields(detection.matchedFields)}</pre>
												</div>
											{/if}

											<!-- View Log Link -->
											{#if onLogClick && detection.projectId}
												<div>
													<button
														class="text-xs text-primary hover:underline"
														onclick={(e) => {
															e.stopPropagation();
															onLogClick(detection.logId, detection.projectId!);
														}}
													>
														View original log →
													</button>
												</div>
											{/if}
										</div>
									</TableCell>
								</TableRow>
							{/if}
						{/each}
					</TableBody>
				</Table>
			</div>
		{/if}
	</CardContent>
</Card>
