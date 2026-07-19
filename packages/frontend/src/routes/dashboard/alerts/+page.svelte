<script lang="ts">
	import { browser } from "$app/environment";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { getApiUrl } from "$lib/config";
	import { currentOrganization } from "$lib/stores/organization";
	import {
		alertsAPI,
		type AlertRule,
		type AlertHistory,
	} from "$lib/api/alerts";
	import { getRecentDetections, type DetectionEvent } from "$lib/api/siem";
	import { toastStore } from "$lib/stores/toast";
	import Button from "$lib/components/ui/button/button.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle,
	} from "$lib/components/ui/card";
	import { Badge } from "$lib/components/ui/badge";
	import {
		Tabs,
		TabsContent,
		TabsList,
		TabsTrigger,
	} from "$lib/components/ui/tabs";
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle,
		AlertDialogTrigger,
	} from "$lib/components/ui/alert-dialog";
	import { Switch } from "$lib/components/ui/switch";
	import CreateAlertDialog from "$lib/components/CreateAlertDialog.svelte";
	import EditAlertDialog from "$lib/components/EditAlertDialog.svelte";
	import SeverityBadge from "$lib/components/siem/shared/SeverityBadge.svelte";
	import Spinner from "$lib/components/Spinner.svelte";
	import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
	import Bell from "@lucide/svelte/icons/bell";
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Clock from "@lucide/svelte/icons/clock";
	import Mail from "@lucide/svelte/icons/mail";
	import FolderKanban from "@lucide/svelte/icons/folder-kanban";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import TrendingUp from "@lucide/svelte/icons/trending-up";
	import HelpTooltip from "$lib/components/HelpTooltip.svelte";
	import { checklistStore } from "$lib/stores/checklist";
	import { layoutStore } from "$lib/stores/layout";

	let alertRules = $state<AlertRule[]>([]);
	let maxWidthClass = $state("max-w-7xl");
	let containerPadding = $state("px-6 py-8");

	$effect(() => {
		const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
			maxWidthClass = value;
		});
		return unsubscribe;
	});

	$effect(() => {
		const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
			containerPadding = value;
		});
		return unsubscribe;
	});
	let alertHistory = $state<AlertHistory[]>([]);
	let loading = $state(false);
	let loadingHistory = $state(false);
	let error = $state("");
	let showCreateDialog = $state(false);
	// Prefill for "create alert from this error" (passed via URL query params)
	let prefillName = $state<string | undefined>(undefined);
	let prefillService = $state<string | undefined>(undefined);
	let prefillLevels = $state<string[] | undefined>(undefined);
	let prefillProcessed = false;
	$effect(() => {
		if (!browser || prefillProcessed) return;
		const params = page.url.searchParams;
		if (params.get("new") === "1") {
			prefillProcessed = true;
			prefillName = params.get("name") ?? undefined;
			prefillService = params.get("service") ?? undefined;
			const levels = params.get("levels");
			prefillLevels = levels ? levels.split(",").filter(Boolean) : undefined;
			showCreateDialog = true;
			// Strip the params so a refresh does not reopen the dialog.
			goto("/dashboard/alerts", { replaceState: true, keepFocus: true, noScroll: true });
		}
	});
	let deletingAlertId = $state<string | null>(null);
	let lastLoadedOrgId = $state<string | null>(null);
	let showDeleteDialog = $state(false);
	let showEditDialog = $state(false);
	let alertToDelete = $state<string | null>(null);
	let alertToEdit = $state<AlertRule | null>(null);
	let expandedHistoryLogs = $state<Map<string, any[]>>(new Map());
	let loadingHistoryLogs = $state<Set<string>>(new Set());

	// Non-security detections state
	let detections = $state<DetectionEvent[]>([]);
	let detectionsLoading = $state(false);

	// Unified history: merge alert history + detections, sorted by time desc
	type HistoryItem =
		| { type: 'alert'; data: AlertHistory; time: Date }
		| { type: 'detection'; data: DetectionEvent; time: Date };

	let historyItems = $derived<HistoryItem[]>((() => {
		const items: HistoryItem[] = [
			...alertHistory.map(h => ({ type: 'alert' as const, data: h, time: new Date(h.triggeredAt) })),
			...detections.map(d => ({ type: 'detection' as const, data: d, time: new Date(d.time) })),
		];
		return items.sort((a, b) => b.time.getTime() - a.time.getTime());
	})());

	async function loadAlertRules() {
		if (!$currentOrganization) return;

		loading = true;
		error = "";

		try {
			const rulesRes = await alertsAPI.getAlertRules($currentOrganization.id);
			alertRules = rulesRes.alertRules || [];
			lastLoadedOrgId = $currentOrganization.id;
		} catch (e) {
			error =
				e instanceof Error ? e.message : "Failed to load alert rules";
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	async function loadAlertHistory() {
		if (!$currentOrganization) return;

		loadingHistory = true;

		try {
			const response = await alertsAPI.getAlertHistory(
				$currentOrganization.id,
				{ limit: 50 },
			);
			alertHistory = response.history || [];
		} catch (e) {
			toastStore.error(
				e instanceof Error ? e.message : "Failed to load alert history",
			);
		} finally {
			loadingHistory = false;
		}
	}

	async function loadDetections() {
		if (!$currentOrganization) return;

		detectionsLoading = true;

		try {
			const response = await getRecentDetections({
				organizationId: $currentOrganization.id,
				category: ['reliability', 'database', 'business'],
				limit: 50,
			});

			detections = response.detections;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load detections');
		} finally {
			detectionsLoading = false;
		}
	}

	$effect(() => {
		if (!browser || !$currentOrganization) {
			alertRules = [];
			alertHistory = [];
			detections = [];
			lastLoadedOrgId = null;
			return;
		}

		if ($currentOrganization.id === lastLoadedOrgId) return;

		loadAlertRules();
		loadAlertHistory();
		loadDetections();
	});

	async function toggleAlert(alert: AlertRule) {
		if (!$currentOrganization) return;

		try {
			await alertsAPI.updateAlertRule($currentOrganization.id, alert.id, {
				enabled: !alert.enabled,
			});

			toastStore.success(
				`Alert ${!alert.enabled ? "enabled" : "disabled"}`,
			);
			await loadAlertRules();
		} catch (e) {
			toastStore.error(
				e instanceof Error ? e.message : "Failed to update alert",
			);
		}
	}

	async function deleteAlert(alertId: string) {
		if (!$currentOrganization) return;

		try {
			await alertsAPI.deleteAlertRule(alertId, $currentOrganization.id);

			toastStore.success("Alert deleted successfully");
			deletingAlertId = null;
			await loadAlertRules();
		} catch (e) {
			toastStore.error(
				e instanceof Error ? e.message : "Failed to delete alert",
			);
		}
	}

	async function toggleHistoryLogs(history: AlertHistory) {
		const historyId = history.id;

		if (expandedHistoryLogs.has(historyId)) {
			const newMap = new Map(expandedHistoryLogs);
			newMap.delete(historyId);
			expandedHistoryLogs = newMap;
			return;
		}

		loadingHistoryLogs = new Set(loadingHistoryLogs).add(historyId);

		try {
			if (!history.projectId) {
				toastStore.error("No project associated with this alert");
				return;
			}

			let token = null;
			try {
				const stored = localStorage.getItem("logtide_auth");
				if (stored) {
					const data = JSON.parse(stored);
					token = data.token;
				}
			} catch (e) {
				console.error("Failed to get token:", e);
			}

			if (!token) {
				toastStore.error("Not authenticated. Please log in again.");
				return;
			}

			const triggeredAt = new Date(history.triggeredAt);
			const fromTime = new Date(
				triggeredAt.getTime() - history.timeWindow * 60000,
			);

			const params = new URLSearchParams({
				projectId: history.projectId,
				from: fromTime.toISOString(),
				to: triggeredAt.toISOString(),
				limit: "50",
			});

			if (history.service) {
				params.set("service", history.service);
			}

			if (history.level && history.level.length > 0) {
				history.level.forEach((lvl) => params.append("level", lvl));
			}

			const response = await fetch(
				`${getApiUrl()}/api/v1/logs?${params.toString()}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				},
			);

			if (!response.ok) {
				throw new Error("Failed to fetch logs");
			}

			const data = await response.json();
			const newMap = new Map(expandedHistoryLogs);
			newMap.set(historyId, data.logs || []);
			expandedHistoryLogs = newMap;
		} catch (e) {
			toastStore.error(
				e instanceof Error ? e.message : "Failed to load logs",
			);
		} finally {
			const newSet = new Set(loadingHistoryLogs);
			newSet.delete(historyId);
			loadingHistoryLogs = newSet;
		}
	}

	function buildSearchUrl(history: AlertHistory): string {
		const params = new URLSearchParams();
		if (history.projectId) {
			params.set("project", history.projectId);
		}
		params.set(
			"from",
			new Date(
				new Date(history.triggeredAt).getTime() - history.timeWindow * 60000,
			).toISOString(),
		);
		params.set("to", new Date(history.triggeredAt).toISOString());
		if (history.service) {
			params.set("service", history.service);
		}
		if (history.level?.length) {
			params.set("level", history.level.join(","));
		}
		return `/dashboard/search?${params.toString()}`;
	}

	function formatUtcTimestamp(value: string | Date): string {
		const formatted = new Date(value).toLocaleString("en-US", {
			timeZone: "UTC",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		});
		return `${formatted} UTC`;
	}

	function getLevelColor(level: string): string {
		switch (level) {
			case "debug":
				return "bg-gray-100 text-gray-800";
			case "info":
				return "bg-blue-100 text-blue-800";
			case "warn":
				return "bg-yellow-100 text-yellow-800";
			case "error":
				return "bg-red-100 text-red-800";
			case "critical":
				return "bg-purple-100 text-purple-800";
			default:
				return "bg-gray-100 text-gray-800";
		}
	}

	function getCategoryLabel(category: string): string {
		switch (category) {
			case 'reliability': return 'Reliability';
			case 'database': return 'Database';
			case 'business': return 'Business';
			default: return category;
		}
	}

	function getCategoryColor(category: string): string {
		switch (category) {
			case 'reliability': return 'bg-orange-100 text-orange-800';
			case 'database': return 'bg-blue-100 text-blue-800';
			case 'business': return 'bg-green-100 text-green-800';
			default: return 'bg-gray-100 text-gray-800';
		}
	}

	const baselineTypeLabels: Record<string, string> = {
		same_time_yesterday: 'Same time yesterday',
		same_day_last_week: 'Same day last week',
		rolling_7d_avg: '7-day rolling avg',
		percentile_p95: '95th percentile (7d)',
	};

</script>

<svelte:head>
	<title>Alerts - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
	<div class="flex items-start justify-between mb-6">
		<div>
			<div class="flex items-center gap-3 mb-2">
				<Bell class="w-8 h-8 text-primary" />
				<h1 class="text-3xl font-bold tracking-tight">Alerts</h1>
			</div>
			<p class="text-muted-foreground">
				Manage alert rules across all projects and view notification history
			</p>
		</div>
		<div class="flex gap-2">
			<Button
				onclick={() => (showCreateDialog = true)}
				size="lg"
				class="gap-2"
			>
				<Plus class="w-5 h-5" />
				Create Alert Rule
			</Button>
		</div>
	</div>

	<Tabs value="rules" class="space-y-4">
		<TabsList>
			<TabsTrigger value="rules" class="gap-1">
				Alert Rules
				<HelpTooltip
					text="Alert rules trigger notifications when log volume exceeds a threshold within a time window."
				/>
			</TabsTrigger>
			<TabsTrigger value="history">History</TabsTrigger>
		</TabsList>

		<!-- Alert Rules Tab -->
		<TabsContent value="rules" class="space-y-4">
			{#if loading}
				<div class="flex items-center justify-center py-12">
					<Spinner />
					<span class="ml-3 text-muted-foreground">Loading alert rules...</span>
				</div>
			{:else if error}
				<Card>
					<CardContent class="py-12 text-center text-destructive">
						{error}
					</CardContent>
				</Card>
			{:else if alertRules.length === 0}
				<Card class="border-2 border-dashed">
					<CardContent class="py-16 text-center">
						<div class="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
							<Bell class="w-8 h-8 text-primary" />
						</div>
						<h3 class="text-xl font-semibold mb-2">No alert rules yet</h3>
						<p class="text-muted-foreground mb-6 max-w-md mx-auto">
							Create your first alert rule to get notified about important events
						</p>
						<Button onclick={() => (showCreateDialog = true)} size="lg" class="gap-2">
							<Plus class="w-5 h-5" />
							Create Alert Rule
						</Button>
					</CardContent>
				</Card>
			{:else}
				<div class="grid gap-4">
					{#each alertRules as alert}
						<Card>
							<CardHeader>
								<div class="flex items-start justify-between">
									<div class="space-y-1">
										<div class="flex items-center gap-3">
											<CardTitle>{alert.name}</CardTitle>
											{#if alert.alertType === 'rate_of_change'}
												<span class="px-2 py-1 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-800 flex items-center gap-1">
													<TrendingUp class="w-3 h-3" />
													Anomaly
												</span>
											{/if}
											<span class="px-2 py-1 text-xs font-semibold rounded-full {alert.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
												{alert.enabled ? "Enabled" : "Disabled"}
											</span>
										</div>
										<CardDescription>
											{#if alert.service}
												Service: {alert.service}
											{:else}
												All services
											{/if}
											{#if alert.projectId}
												&bull; Project-specific
											{:else}
												&bull; Organization-wide
											{/if}
										</CardDescription>
									</div>
									<div class="flex gap-2">
										<Button variant="outline" size="sm" class="gap-2" onclick={() => { alertToEdit = alert; showEditDialog = true; }}>
											<Pencil class="w-4 h-4" />
											Edit
										</Button>
										<Button variant="destructive" size="sm" class="gap-2" onclick={() => { alertToDelete = alert.id; showDeleteDialog = true; }}>
											<Trash2 class="w-4 h-4" />
											Delete
										</Button>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
									<div>
										<span class="font-medium">Levels:</span>
										<div class="flex gap-2 mt-1">
											{#each alert.level as level}
												<span class="px-2 py-1 text-xs font-semibold rounded-full {getLevelColor(level)}">
													{level.toUpperCase()}
												</span>
											{/each}
										</div>
									</div>
									<div>
										{#if alert.alertType === 'rate_of_change'}
											<span class="font-medium">Trigger:</span>
											<span class="ml-2">
												{alert.deviationMultiplier}x above {baselineTypeLabels[alert.baselineType || ''] || 'baseline'}
											</span>
										{:else}
											<span class="font-medium">Threshold:</span>
											<span class="ml-2">
												{alert.threshold} logs in {alert.timeWindow} minute{alert.timeWindow > 1 ? "s" : ""}
											</span>
										{/if}
									</div>
									<div>
										<span class="font-medium">Notification Channels:</span>
										<span class="ml-2">
											{#if alert.channelIds && alert.channelIds.length > 0}
												{alert.channelIds.length} channel{alert.channelIds.length > 1 ? 's' : ''} configured
											{:else}
												No channels configured
											{/if}
										</span>
									</div>
								</div>
								<div class="flex items-center gap-2 mt-4 pt-4 border-t">
									<Switch id="toggle-{alert.id}" checked={alert.enabled} onCheckedChange={() => toggleAlert(alert)} />
									<Label for="toggle-{alert.id}">
										{alert.enabled ? "Enabled" : "Disabled"}
									</Label>
								</div>
							</CardContent>
						</Card>
					{/each}
				</div>
			{/if}
		</TabsContent>

		<!-- Unified History Tab -->
		<TabsContent value="history" class="space-y-4">
			{#if (loadingHistory || detectionsLoading) && historyItems.length === 0}
				<SkeletonTable rows={4} columns={4} />
			{:else if historyItems.length === 0}
				<Card class="border-2 border-dashed">
					<CardContent class="py-16 text-center">
						<div class="w-16 h-16 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
							<Clock class="w-8 h-8 text-primary" />
						</div>
						<h3 class="text-xl font-semibold mb-2">No history yet</h3>
						<p class="text-muted-foreground">Alert triggers and detection events will appear here</p>
					</CardContent>
				</Card>
			{:else}
				<TableLoadingOverlay loading={loadingHistory || detectionsLoading}>
				<div class="grid gap-4">
					{#each historyItems as item}
						{#if item.type === 'alert'}
							{@const history = item.data}
							<Card>
								<CardContent class="py-4">
									<div class="flex flex-col gap-4">
										<div class="flex items-start justify-between">
											<div class="flex items-center gap-2 flex-wrap">
												{#if history.alertType === 'rate_of_change'}
													<Badge variant="outline" class="text-xs bg-indigo-100 text-indigo-800 gap-1">
														<TrendingUp class="w-3 h-3" />
														Anomaly
													</Badge>
												{:else}
													<Badge variant="outline" class="text-xs bg-purple-100 text-purple-800">Alert</Badge>
												{/if}
												<h3 class="font-semibold text-lg">{history.ruleName}</h3>
												{#if history.notified}
													<Badge variant="default" class="gap-1">
														<Bell class="w-3 h-3" />
														Notified
													</Badge>
												{:else}
													<Badge variant="destructive" class="gap-1">
														<Mail class="w-3 h-3" />
														{history.error ? "Failed" : "Pending"}
													</Badge>
												{/if}
											</div>
											{#if history.projectId}
												<a
													href={buildSearchUrl(history)}
													class="text-sm text-primary hover:underline flex items-center gap-1"
												>
													<span>View Logs</span>
													<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
												</a>
											{/if}
										</div>

										{#if history.projectName}
											<div class="flex items-center gap-2 text-sm">
												<FolderKanban class="w-4 h-4 text-muted-foreground" />
												<span class="text-muted-foreground">Project:</span>
												<span class="font-medium">{history.projectName}</span>
											</div>
										{/if}

										{#if history.baselineMetadata}
											<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
												<div class="flex flex-col gap-1">
													<span class="text-muted-foreground text-xs">Current Rate</span>
													<span class="font-mono font-semibold text-orange-600 text-base">{Math.round(history.baselineMetadata.current_value)} logs/hr</span>
												</div>
												<div class="flex flex-col gap-1">
													<span class="text-muted-foreground text-xs">Baseline</span>
													<span class="font-medium">{Math.round(history.baselineMetadata.baseline_value)} logs/hr</span>
												</div>
												<div class="flex flex-col gap-1">
													<span class="text-muted-foreground text-xs">Deviation</span>
													<span class="font-mono font-semibold text-red-600">{history.baselineMetadata.deviation_ratio}x</span>
												</div>
												<div class="flex flex-col gap-1">
													<span class="text-muted-foreground text-xs">Method</span>
													<span class="font-medium">{baselineTypeLabels[history.baselineMetadata.baseline_type] || history.baselineMetadata.baseline_type}</span>
												</div>
											</div>
										{:else}
											<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-xs">Logs Matched</span>
												<span class="font-mono font-semibold text-orange-600 text-base">{history.logCount}</span>
											</div>
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-xs">Threshold</span>
												<span class="font-medium">{history.threshold} in {history.timeWindow} min</span>
											</div>
											{#if history.service}
												<div class="flex flex-col gap-1">
													<span class="text-muted-foreground text-xs">Service</span>
													<span class="font-medium font-mono text-sm">{history.service}</span>
												</div>
											{/if}
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-xs">Levels</span>
												<div class="flex gap-1 flex-wrap">
													{#each history.level as lvl}
														<Badge variant="outline" class={getLevelColor(lvl)}>{lvl}</Badge>
													{/each}
												</div>
											</div>
										</div>
										{/if}

										<div class="flex items-center gap-1.5 text-sm text-muted-foreground">
											<Clock class="w-4 h-4" />
											<span>{formatUtcTimestamp(history.triggeredAt)}</span>
										</div>

										{#if history.error}
											<div class="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
												<p class="text-sm font-medium text-destructive mb-1">Notification Error:</p>
												<p class="text-xs text-destructive/80 font-mono break-all">{history.error}</p>
											</div>
										{/if}

										{#if history.projectId}
											<div class="border-t pt-3">
												<button
													onclick={() => toggleHistoryLogs(history)}
													class="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
												>
													{#if loadingHistoryLogs.has(history.id)}
														<Spinner class="w-4 h-4" />
														<span>Loading logs...</span>
													{:else if expandedHistoryLogs.has(history.id)}
														<ChevronUp class="w-4 h-4" />
														<span>Hide Matched Logs ({expandedHistoryLogs.get(history.id)?.length || 0})</span>
													{:else}
														<ChevronDown class="w-4 h-4" />
														<span>Show Matched Logs</span>
													{/if}
												</button>

												{#if expandedHistoryLogs.has(history.id)}
													{@const logs = expandedHistoryLogs.get(history.id) || []}
													<div class="mt-3 space-y-2">
														{#if logs.length === 0}
															<p class="text-sm text-muted-foreground text-center py-4">No logs found in the time window</p>
														{:else}
															<div class="rounded-md border overflow-hidden">
																<div class="max-h-96 overflow-y-auto">
																	<table class="w-full text-sm">
																		<thead class="bg-muted/50 sticky top-0">
																			<tr class="border-b">
																				<th class="px-3 py-2 text-left font-medium text-xs">Time</th>
																				<th class="px-3 py-2 text-left font-medium text-xs">Level</th>
																				<th class="px-3 py-2 text-left font-medium text-xs">Service</th>
																				<th class="px-3 py-2 text-left font-medium text-xs">Message</th>
																			</tr>
																		</thead>
																		<tbody>
																			{#each logs as log}
																				<tr class="border-b hover:bg-muted/30">
																					<td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
																						{(() => {
																							const d = new Date(log.time);
																							return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
																						})()}
																					</td>
																					<td class="px-3 py-2">
																						<Badge variant="outline" class={getLevelColor(log.level)}>{log.level}</Badge>
																					</td>
																					<td class="px-3 py-2 font-mono text-xs">{log.service || "-"}</td>
																					<td class="px-3 py-2 text-xs max-w-md truncate">{log.message}</td>
																				</tr>
																			{/each}
																		</tbody>
																	</table>
																</div>
															</div>
															<p class="text-xs text-muted-foreground text-center">
																Showing {logs.length} log{logs.length !== 1 ? "s" : ""} from the alert time window
															</p>
														{/if}
													</div>
												{/if}
											</div>
										{/if}
									</div>
								</CardContent>
							</Card>
						{:else}
							{@const detection = item.data}
							<Card>
								<CardContent class="py-4">
									<div class="flex flex-col gap-3">
										<div class="flex items-start justify-between">
											<div class="flex items-center gap-2 flex-wrap">
												<Badge variant="outline" class="text-xs {getCategoryColor(detection.category)}">
													{getCategoryLabel(detection.category)}
												</Badge>
												<SeverityBadge severity={detection.severity} size="sm" />
												<h3 class="font-semibold text-lg">{detection.ruleTitle}</h3>
											</div>
										</div>

										{#if detection.ruleDescription}
											<p class="text-sm text-muted-foreground">{detection.ruleDescription}</p>
										{/if}

										<div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-xs">Service</span>
												<span class="font-medium font-mono text-sm">{detection.service || '-'}</span>
											</div>
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-xs">Log Level</span>
												<Badge variant="outline" class="w-fit {getLevelColor(detection.logLevel)}">{detection.logLevel}</Badge>
											</div>
											{#if detection.traceId}
												<div class="flex flex-col gap-1">
													<span class="text-muted-foreground text-xs">Trace ID</span>
													<span class="font-mono text-xs truncate">{detection.traceId}</span>
												</div>
											{/if}
										</div>

										<div class="p-2 bg-muted/50 rounded-md">
											<p class="text-xs font-mono truncate">{detection.logMessage}</p>
										</div>

										<div class="flex items-center gap-1.5 text-sm text-muted-foreground">
											<Clock class="w-4 h-4" />
											<span>{formatUtcTimestamp(detection.time)}</span>
										</div>
									</div>
								</CardContent>
							</Card>
						{/if}
					{/each}
				</div>
				</TableLoadingOverlay>
			{/if}
		</TabsContent>
	</Tabs>
</div>

{#if $currentOrganization}
	<CreateAlertDialog
		bind:open={showCreateDialog}
		organizationId={$currentOrganization.id}
		initialName={prefillName}
		initialService={prefillService}
		initialLevels={prefillLevels}
		onSuccess={() => {
			loadAlertRules();
			loadAlertHistory();
		}}
	/>

	<EditAlertDialog
		bind:open={showEditDialog}
		organizationId={$currentOrganization.id}
		alert={alertToEdit}
		onSuccess={() => {
			loadAlertRules();
			loadAlertHistory();
		}}
	/>


	<AlertDialog bind:open={showDeleteDialog}>
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogTitle>Delete Alert Rule</AlertDialogTitle>
				<AlertDialogDescription>
					Are you sure you want to delete this alert rule?
					This action cannot be undone.
				</AlertDialogDescription>
			</AlertDialogHeader>
			<AlertDialogFooter>
				<AlertDialogCancel>Cancel</AlertDialogCancel>
				<AlertDialogAction
					onclick={() => {
						if (alertToDelete) {
							deleteAlert(alertToDelete);
						}
						showDeleteDialog = false;
						alertToDelete = null;
					}}
				>
					Delete
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
{/if}
