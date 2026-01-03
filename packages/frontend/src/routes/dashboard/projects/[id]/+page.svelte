<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { page } from "$app/state";
	import { browser } from "$app/environment";
	import { getApiUrl } from "$lib/config";
	import { logsAPI, type SearchMode } from "$lib/api/logs";
	import { toastStore } from "$lib/stores/toast";
	import { authStore } from "$lib/stores/auth";
	import { currentOrganization } from "$lib/stores/organization";
	import Card from "$lib/components/ui/card/card.svelte";
	import CardHeader from "$lib/components/ui/card/card-header.svelte";
	import CardTitle from "$lib/components/ui/card/card-title.svelte";
	import CardContent from "$lib/components/ui/card/card-content.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import * as Select from "$lib/components/ui/select";
	import * as Popover from "$lib/components/ui/popover";
	import Switch from "$lib/components/ui/switch/switch.svelte";
	import { Badge } from "$lib/components/ui/badge";
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow,
	} from "$lib/components/ui/table";
	import Spinner from "$lib/components/Spinner.svelte";
	import LogContextDialog from "$lib/components/LogContextDialog.svelte";
	import { ExceptionDetailsDialog } from "$lib/components/exceptions";
	import ExportLogsDialog from "$lib/components/ExportLogsDialog.svelte";
	import EmptyLogs from "$lib/components/EmptyLogs.svelte";
	import TimeRangePicker, { type TimeRangeType } from "$lib/components/TimeRangePicker.svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronLeft from "@lucide/svelte/icons/chevron-left";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import Download from "@lucide/svelte/icons/download";
	import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
	import Radio from "@lucide/svelte/icons/radio";

	interface LogEntry {
		id?: string;
		time: string;
		service: string;
		level: "debug" | "info" | "warn" | "error" | "critical";
		message: string;
		metadata?: Record<string, any>;
		traceId?: string;
		projectId: string;
	}

	let logs = $state<LogEntry[]>([]);
	let loading = $state(false);
	let error = $state("");
	let lastLoadedProjectId = $state<string | null>(null);
	let liveTail = $state(false);
	let eventSource = $state<EventSource | null>(null);
	let liveTailConnectionKey = $state<string | null>(null);
	let token = $state<string | null>(null);

	authStore.subscribe((state) => {
		token = state.token;
	});

	// Search and filter state
	let searchQuery = $state("");
	let searchMode = $state<SearchMode>("fulltext");
	let traceId = $state("");
	let selectedLevels = $state<string[]>([]);
	let selectedServices = $state<string[]>([]);
	let expandedRows = $state(new Set<number>());

	// Time range picker state
	let timeRangePicker = $state<ReturnType<typeof TimeRangePicker> | null>(null);
	let timeRangeType = $state<TimeRangeType>("last_24h");
	let customFromTime = $state("");
	let customToTime = $state("");

	// Pagination state
	let pageSize = $state(25);
	let currentPage = $state(1);
	let total = $state(0);
	let totalPages = $derived(Math.ceil(total / pageSize));

	// Dialog states
	let contextDialogOpen = $state(false);
	let selectedLogForContext = $state<LogEntry | null>(null);
	let exceptionDialogOpen = $state(false);
	let selectedLogForException = $state<LogEntry | null>(null);
	let exportDialogOpen = $state(false);

	// Services state
	let availableServices = $state<string[]>([]);
	let isLoadingServices = $state(false);

	// Debounce timer
	let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const projectId = $derived(page.params.id);

	// Helper to get time range from picker or fallback
	function getTimeRange(): { from: Date; to: Date } {
		if (timeRangePicker) {
			return timeRangePicker.getTimeRange();
		}
		const now = new Date();
		switch (timeRangeType) {
			case "last_hour":
				return { from: new Date(now.getTime() - 60 * 60 * 1000), to: now };
			case "last_24h":
				return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
			case "last_7d":
				return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
			case "custom":
				const from = customFromTime
					? new Date(customFromTime)
					: new Date(now.getTime() - 24 * 60 * 60 * 1000);
				const to = customToTime ? new Date(customToTime) : now;
				return { from, to };
			default:
				return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
		}
	}

	// Combine available services with selected services
	let displayedServices = $derived(() => {
		const combined = new Set([...availableServices, ...selectedServices]);
		return [...combined].sort((a, b) => a.localeCompare(b));
	});

	async function loadAvailableServices() {
		if (!projectId) {
			availableServices = [];
			return;
		}

		isLoadingServices = true;
		try {
			const timeRange = getTimeRange();
			const services = await logsAPI.getServices({
				projectId: projectId,
				from: timeRange.from.toISOString(),
				to: timeRange.to.toISOString(),
			});
			availableServices = services;
		} catch (e) {
			console.error("Failed to load services:", e);
			availableServices = [];
		} finally {
			isLoadingServices = false;
		}
	}

	async function loadLogs() {
		if (!projectId) return;

		loading = true;
		error = "";

		try {
			const timeRange = getTimeRange();
			const offset = (currentPage - 1) * pageSize;

			const filters = {
				projectId,
				service:
					selectedServices.length > 0
						? selectedServices.length === 1
							? selectedServices[0]
							: selectedServices
						: undefined,
				level:
					selectedLevels.length > 0
						? selectedLevels.length === 1
							? selectedLevels[0]
							: selectedLevels
						: undefined,
				traceId: traceId && traceId !== "" ? traceId : undefined,
				q: searchQuery && searchQuery !== "" ? searchQuery : undefined,
				searchMode: searchQuery ? searchMode : undefined,
				from: timeRange.from.toISOString(),
				to: timeRange.to.toISOString(),
				limit: pageSize,
				offset,
			};

			const response = await logsAPI.getLogs(filters);

			logs = response.logs;
			total = response.total;
			lastLoadedProjectId = projectId;
		} catch (e) {
			console.error("Failed to load logs:", e);
			error = e instanceof Error ? e.message : "Failed to load logs";
			toastStore.error(error);
			logs = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	function debouncedSearch() {
		if (searchDebounceTimer) {
			clearTimeout(searchDebounceTimer);
		}
		searchDebounceTimer = setTimeout(() => {
			currentPage = 1;
			loadLogs();
		}, 300);
	}

	async function handleTimeRangeChange() {
		await loadAvailableServices();
		currentPage = 1;
		loadLogs();
	}

	function applyFilters() {
		currentPage = 1;
		loadLogs();
	}

	// Initial data load
	$effect(() => {
		if (!browser || !projectId) {
			logs = [];
			lastLoadedProjectId = null;
			return;
		}

		if (projectId === lastLoadedProjectId) return;

		loadAvailableServices();
		loadLogs();
	});

	// Restore search mode from session storage on mount
	onMount(() => {
		const savedSearchMode = sessionStorage.getItem("logward_project_search_mode");
		if (savedSearchMode === "fulltext" || savedSearchMode === "substring") {
			searchMode = savedSearchMode;
		}
	});

	// Live tail connection
	function connectLiveTail() {
		if (!browser || !projectId) return;

		if (eventSource) {
			eventSource.close();
		}

		const params = new URLSearchParams();
		params.append("projectId", projectId);
		if (token) params.append("token", token);
		if (selectedServices.length > 0)
			params.append("service", selectedServices[0]);
		if (selectedLevels.length > 0)
			params.append("level", selectedLevels[0]);

		const url = `${getApiUrl()}/api/v1/logs/stream?${params.toString()}`;

		try {
			const es = new EventSource(url);

			es.onopen = () => {
				console.log("SSE connected");
				error = "";
			};

			es.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					if (data.type === "connected") {
						console.log("Live tail connected at", data.timestamp);
					} else if (data.type === "log") {
						logs = [data.data, ...logs].slice(0, 100);
						total = logs.length;
					}
				} catch (e) {
					console.error("Error parsing SSE message:", e);
				}
			};

			es.onerror = (err) => {
				console.error("SSE error:", err);
				error = "Live tail connection lost. Retrying...";
			};

			eventSource = es;
		} catch (e) {
			console.error("Failed to connect to SSE:", e);
			error = "Failed to connect to live tail";
			liveTail = false;
		}
	}

	function disconnectLiveTail() {
		if (eventSource) {
			eventSource.close();
			eventSource = null;
			console.log("SSE disconnected");
		}
	}

	$effect(() => {
		if (!browser || !projectId) {
			disconnectLiveTail();
			liveTailConnectionKey = null;
			return;
		}

		if (!liveTail) {
			const wasLiveTail = liveTailConnectionKey !== null;
			disconnectLiveTail();
			liveTailConnectionKey = null;
			if (wasLiveTail) {
				loadLogs();
			}
			return;
		}

		const connectionKey = `${projectId}-${selectedServices.join(",") || "all"}-${selectedLevels.join(",") || "all"}`;

		if (connectionKey === liveTailConnectionKey) {
			return;
		}

		disconnectLiveTail();
		connectLiveTail();
		liveTailConnectionKey = connectionKey;
	});

	// Cleanup on destroy
	onDestroy(() => {
		disconnectLiveTail();
	});

	// Pagination functions
	function goToPage(page: number) {
		if (page >= 1 && page <= totalPages && page !== currentPage) {
			currentPage = page;
			loadLogs();
		}
	}

	function nextPage() {
		if (currentPage < totalPages) {
			currentPage++;
			loadLogs();
		}
	}

	function previousPage() {
		if (currentPage > 1) {
			currentPage--;
			loadLogs();
		}
	}

	// Row expansion
	function toggleRow(index: number) {
		const newSet = new Set(expandedRows);
		if (newSet.has(index)) {
			newSet.delete(index);
		} else {
			newSet.add(index);
		}
		expandedRows = newSet;
	}

	// Dialog handlers
	function openContextDialog(log: LogEntry) {
		selectedLogForContext = log;
		contextDialogOpen = true;
	}

	function closeContextDialog() {
		contextDialogOpen = false;
		selectedLogForContext = null;
	}

	function openExceptionDialog(log: LogEntry) {
		selectedLogForException = log;
		exceptionDialogOpen = true;
	}

	function closeExceptionDialog() {
		exceptionDialogOpen = false;
		selectedLogForException = null;
	}

	function isErrorLevel(level: string): boolean {
		return level === "error" || level === "critical";
	}

	// Formatting helpers
	function formatDateTime(dateStr: string): string {
		const date = new Date(dateStr);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hours = String(date.getHours()).padStart(2, "0");
		const minutes = String(date.getMinutes()).padStart(2, "0");
		const seconds = String(date.getSeconds()).padStart(2, "0");
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	function getLevelColor(level: string): string {
		switch (level) {
			case "debug":
				return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600";
			case "info":
				return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700";
			case "warn":
				return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700";
			case "error":
				return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300 dark:border-red-700";
			case "critical":
				return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-700";
			default:
				return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600";
		}
	}

	// Export filters
	let exportFilters = $derived({
		projectId: projectId,
		service:
			selectedServices.length > 0
				? selectedServices.length === 1
					? selectedServices[0]
					: selectedServices
				: undefined,
		level:
			selectedLevels.length > 0
				? selectedLevels.length === 1
					? selectedLevels[0]
					: selectedLevels
				: undefined,
		traceId: traceId || undefined,
		q: searchQuery || undefined,
		from: getTimeRange().from.toISOString(),
		to: getTimeRange().to.toISOString(),
	});

	let effectiveTotalLogs = $derived(liveTail ? logs.length : total);
</script>

<div class="space-y-6">
	<!-- Filters Card -->
	<Card>
		<CardHeader>
			<CardTitle>Filters</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<!-- Search with mode toggle -->
				<div class="space-y-2 lg:col-span-2">
					<Label for="search">Search Message</Label>
					<div class="flex gap-2">
						<Input
							id="search"
							type="search"
							placeholder={searchMode === "fulltext" ? "Search words..." : "Find text anywhere..."}
							bind:value={searchQuery}
							oninput={debouncedSearch}
							class="flex-1"
						/>
						<Select.Root
							type="single"
							value={{ value: searchMode, label: searchMode === "fulltext" ? "Full-text" : "Substring" }}
							onValueChange={(v) => {
								if (v) {
									const newValue = typeof v === 'string' ? v : v.value;
									if (newValue === "fulltext" || newValue === "substring") {
										searchMode = newValue;
										sessionStorage.setItem("logward_project_search_mode", searchMode);
										if (searchQuery) {
											debouncedSearch();
										}
									}
								}
							}}
						>
							<Select.Trigger class="w-[130px]" title="Search mode: Full-text (word-based) or Substring (find anywhere)">
								{searchMode === "fulltext" ? "Full-text" : "Substring"}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="fulltext">Full-text</Select.Item>
								<Select.Item value="substring">Substring</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<!-- Trace ID -->
				<div class="space-y-2">
					<Label for="traceId">Trace ID</Label>
					<Input
						id="traceId"
						type="text"
						placeholder="Filter by trace ID..."
						bind:value={traceId}
						oninput={debouncedSearch}
					/>
				</div>

				<!-- Services -->
				<div class="space-y-2">
					<Label>Services</Label>
					<Popover.Root>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									role="combobox"
									class="w-full justify-between font-normal"
								>
									<span class="truncate">
										{#if selectedServices.length === 0}
											All services
										{:else if selectedServices.length === availableServices.length && availableServices.length > 0}
											All services ({availableServices.length})
										{:else if selectedServices.length === 1}
											{selectedServices[0]}
										{:else}
											{selectedServices.length} services
										{/if}
									</span>
									<ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[300px] p-0" align="start">
							<div class="p-2 border-b">
								<div class="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										class="flex-1"
										onclick={() => {
											selectedServices = [...availableServices];
											applyFilters();
										}}
									>
										Select All
									</Button>
									<Button
										variant="outline"
										size="sm"
										class="flex-1"
										onclick={() => {
											selectedServices = [];
											applyFilters();
										}}
									>
										Clear
									</Button>
								</div>
							</div>
							<div class="max-h-[300px] overflow-y-auto p-2">
								{#if isLoadingServices}
									<div class="text-center py-4 text-sm text-muted-foreground">
										Loading services...
									</div>
								{:else if displayedServices().length === 0}
									<div class="text-center py-4 text-sm text-muted-foreground">
										No services available
									</div>
								{:else}
									<div class="space-y-1">
										{#each displayedServices() as service}
											{@const hasLogsInTimeRange = availableServices.includes(service)}
											<label class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm">
												<input
													type="checkbox"
													value={service}
													checked={selectedServices.includes(service)}
													onchange={(e) => {
														if (e.currentTarget.checked) {
															selectedServices = [...selectedServices, service];
														} else {
															selectedServices = selectedServices.filter((s) => s !== service);
														}
														applyFilters();
													}}
													class="h-4 w-4 rounded border-gray-300"
												/>
												<span class="text-sm flex-1 {!hasLogsInTimeRange ? 'text-muted-foreground italic' : ''}">{service}</span>
												{#if !hasLogsInTimeRange}
													<span class="text-xs text-muted-foreground">(no logs)</span>
												{/if}
											</label>
										{/each}
									</div>
								{/if}
							</div>
						</Popover.Content>
					</Popover.Root>
				</div>
			</div>

			<!-- Second row: Levels and Live Tail -->
			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-4">
				<!-- Levels -->
				<div class="space-y-2">
					<Label>Levels</Label>
					<Popover.Root>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									role="combobox"
									class="w-full justify-between font-normal"
								>
									<span class="truncate">
										{#if selectedLevels.length === 0}
											All levels
										{:else if selectedLevels.length === 5}
											All levels (5)
										{:else if selectedLevels.length === 1}
											{selectedLevels[0].charAt(0).toUpperCase() + selectedLevels[0].slice(1)}
										{:else}
											{selectedLevels.length} levels
										{/if}
									</span>
									<ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[300px] p-0" align="start">
							<div class="p-2 border-b">
								<div class="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										class="flex-1"
										onclick={() => {
											selectedLevels = ["debug", "info", "warn", "error", "critical"];
											applyFilters();
										}}
									>
										Select All
									</Button>
									<Button
										variant="outline"
										size="sm"
										class="flex-1"
										onclick={() => {
											selectedLevels = [];
											applyFilters();
										}}
									>
										Clear
									</Button>
								</div>
							</div>
							<div class="max-h-[300px] overflow-y-auto p-2">
								<div class="space-y-1">
									{#each ["debug", "info", "warn", "error", "critical"] as level}
										<label class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm">
											<input
												type="checkbox"
												value={level}
												checked={selectedLevels.includes(level)}
												onchange={(e) => {
													if (e.currentTarget.checked) {
														selectedLevels = [...selectedLevels, level];
													} else {
														selectedLevels = selectedLevels.filter((l) => l !== level);
													}
													applyFilters();
												}}
												class="h-4 w-4 rounded border-gray-300"
											/>
											<span class="text-sm flex-1 capitalize">{level}</span>
										</label>
									{/each}
								</div>
							</div>
						</Popover.Content>
					</Popover.Root>
				</div>

				<!-- Live Tail Switch -->
				<div class="flex items-end space-x-2 pb-2">
					<Switch id="live-tail" bind:checked={liveTail} />
					<Label for="live-tail">
						<div class="flex items-center gap-2">
							<Radio class="w-4 h-4 {liveTail ? 'text-green-500 animate-pulse' : ''}" />
							Live Tail
						</div>
					</Label>
				</div>
			</div>

			<!-- Time Range Picker -->
			<div class="mt-4">
				<TimeRangePicker
					bind:this={timeRangePicker}
					initialType={timeRangeType}
					initialCustomFrom={customFromTime}
					initialCustomTo={customToTime}
					onchange={handleTimeRangeChange}
				/>
			</div>

			<!-- Export Button -->
			<div class="flex gap-2 mt-4">
				<Button
					variant="outline"
					size="sm"
					onclick={() => (exportDialogOpen = true)}
					disabled={liveTail || total === 0}
					class="gap-2"
				>
					<Download class="w-4 h-4" />
					Export
					{#if total > 0}
						({total.toLocaleString()})
					{/if}
				</Button>
			</div>
		</CardContent>
	</Card>

	<!-- Logs Card -->
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>
					{#if effectiveTotalLogs > 0}
						{effectiveTotalLogs.toLocaleString()}
						{effectiveTotalLogs === 1 ? "log" : "logs"}
						{#if liveTail}
							<span class="text-sm font-normal text-muted-foreground">(last 100)</span>
						{/if}
					{:else}
						No logs
					{/if}
				</CardTitle>
				{#if liveTail}
					<Badge variant="default">Live</Badge>
				{/if}
			</div>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="flex items-center justify-center py-12">
					<Spinner />
					<span class="ml-3 text-muted-foreground">Loading logs...</span>
				</div>
			{:else if error}
				<div class="text-center py-12 text-destructive">
					{error}
				</div>
			{:else if logs.length === 0}
				<EmptyLogs />
			{:else}
				<div class="rounded-md border overflow-x-auto">
					<Table class="w-full">
						<TableHeader>
							<TableRow>
								<TableHead class="w-[180px]">Time</TableHead>
								<TableHead class="w-[150px]">Service</TableHead>
								<TableHead class="w-[100px]">Level</TableHead>
								<TableHead>Message</TableHead>
								<TableHead class="w-[120px]">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each logs as log, i}
								{@const globalIndex = i}
								<TableRow>
									<TableCell class="font-mono text-xs">
										{formatDateTime(log.time)}
									</TableCell>
									<TableCell>
										<button
											onclick={() => {
												if (!selectedServices.includes(log.service)) {
													selectedServices = [...selectedServices, log.service];
													applyFilters();
												}
											}}
											title="Click to filter by this service"
											class="hover:opacity-80 transition-opacity"
										>
											<Badge variant="outline">{log.service}</Badge>
										</button>
									</TableCell>
									<TableCell>
										<button
											class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase {getLevelColor(log.level)} hover:opacity-80 transition-opacity cursor-pointer"
											onclick={() => {
												if (!selectedLevels.includes(log.level)) {
													selectedLevels = [...selectedLevels, log.level];
													applyFilters();
												}
											}}
											title="Click to filter by this level"
										>
											{log.level}
										</button>
									</TableCell>
									<TableCell class="max-w-md truncate">{log.message}</TableCell>
									<TableCell>
										<div class="flex gap-1">
											<Button
												variant="ghost"
												size="sm"
												onclick={() => toggleRow(globalIndex)}
											>
												{expandedRows.has(globalIndex) ? "Hide" : "Details"}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onclick={() => openContextDialog(log)}
												title="View logs before and after this entry"
											>
												Context
											</Button>
										</div>
									</TableCell>
								</TableRow>
								{#if expandedRows.has(globalIndex)}
									<TableRow>
										<TableCell colspan={5} class="bg-muted/50 !p-0">
											<div class="p-4 space-y-3 w-0 min-w-full">
												<div>
													<span class="font-semibold">Full Message:</span>
													<div class="mt-2 p-3 bg-background rounded-md text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
														{log.message}
													</div>
												</div>
												{#if log.traceId}
													<div>
														<span class="font-semibold">Trace ID:</span>
														<button
															class="ml-2 text-xs font-mono bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-1 rounded hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors cursor-pointer"
															onclick={() => {
																traceId = log.traceId || "";
																applyFilters();
															}}
															title="Click to filter by this trace ID"
														>
															{log.traceId}
														</button>
													</div>
												{/if}
												{#if log.metadata && Object.keys(log.metadata).length > 0}
													<div>
														<span class="font-semibold">Metadata:</span>
														<div class="mt-2 p-3 bg-background rounded-md max-h-64 overflow-auto">
															<pre class="text-xs w-max">{JSON.stringify(log.metadata, null, 2)}</pre>
														</div>
													</div>
												{/if}
												{#if isErrorLevel(log.level) && log.id}
													<div class="pt-2 border-t mt-3">
														<Button
															variant="outline"
															size="sm"
															onclick={() => openExceptionDialog(log)}
															class="gap-2"
														>
															<AlertTriangle class="w-4 h-4 text-red-500" />
															View Exception Details
														</Button>
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

				<!-- Pagination -->
				{#if !liveTail && logs.length > 0}
					<div class="flex items-center justify-between mt-6 px-2">
						<div class="text-sm text-muted-foreground">
							Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of {total.toLocaleString()} logs
						</div>
						<div class="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={previousPage}
								disabled={currentPage === 1 || loading}
							>
								<ChevronLeft class="w-4 h-4" />
								Previous
							</Button>
							<div class="flex items-center gap-1">
								{#if totalPages <= 7}
									{#each Array.from({ length: totalPages }, (_, i) => i + 1) as pageNum}
										<Button
											variant={currentPage === pageNum ? "default" : "outline"}
											size="sm"
											onclick={() => goToPage(pageNum)}
											disabled={loading}
											class="w-10"
										>
											{pageNum}
										</Button>
									{/each}
								{:else if currentPage <= 3}
									{#each [1, 2, 3, 4] as pageNum}
										<Button
											variant={currentPage === pageNum ? "default" : "outline"}
											size="sm"
											onclick={() => goToPage(pageNum)}
											disabled={loading}
											class="w-10"
										>
											{pageNum}
										</Button>
									{/each}
									<span class="px-2">...</span>
									<Button
										variant="outline"
										size="sm"
										onclick={() => goToPage(totalPages)}
										disabled={loading}
										class="w-10"
									>
										{totalPages}
									</Button>
								{:else if currentPage >= totalPages - 2}
									<Button
										variant="outline"
										size="sm"
										onclick={() => goToPage(1)}
										disabled={loading}
										class="w-10"
									>
										1
									</Button>
									<span class="px-2">...</span>
									{#each [totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as pageNum}
										<Button
											variant={currentPage === pageNum ? "default" : "outline"}
											size="sm"
											onclick={() => goToPage(pageNum)}
											disabled={loading}
											class="w-10"
										>
											{pageNum}
										</Button>
									{/each}
								{:else}
									<Button
										variant="outline"
										size="sm"
										onclick={() => goToPage(1)}
										disabled={loading}
										class="w-10"
									>
										1
									</Button>
									<span class="px-2">...</span>
									{#each [currentPage - 1, currentPage, currentPage + 1] as pageNum}
										<Button
											variant={currentPage === pageNum ? "default" : "outline"}
											size="sm"
											onclick={() => goToPage(pageNum)}
											disabled={loading}
											class="w-10"
										>
											{pageNum}
										</Button>
									{/each}
									<span class="px-2">...</span>
									<Button
										variant="outline"
										size="sm"
										onclick={() => goToPage(totalPages)}
										disabled={loading}
										class="w-10"
									>
										{totalPages}
									</Button>
								{/if}
							</div>
							<Button
								variant="outline"
								size="sm"
								onclick={nextPage}
								disabled={currentPage === totalPages || loading}
							>
								Next
								<ChevronRight class="w-4 h-4" />
							</Button>
						</div>
					</div>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>

<!-- Dialogs -->
<LogContextDialog
	open={contextDialogOpen}
	projectId={projectId || ""}
	organizationId={$currentOrganization?.id || ""}
	selectedLog={selectedLogForContext}
	onClose={closeContextDialog}
/>

<ExceptionDetailsDialog
	open={exceptionDialogOpen}
	logId={selectedLogForException?.id || ""}
	organizationId={$currentOrganization?.id || ""}
	onClose={closeExceptionDialog}
/>

<ExportLogsDialog
	bind:open={exportDialogOpen}
	totalLogs={total}
	filters={exportFilters}
/>
