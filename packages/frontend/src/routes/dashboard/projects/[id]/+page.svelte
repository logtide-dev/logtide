<script lang="ts">
	import { page } from "$app/stores";
	import { browser } from "$app/environment";
	import { PUBLIC_API_URL } from "$env/static/public";
	import { logsAPI } from "$lib/api/logs";
	import { toastStore } from "$lib/stores/toast";
	import { authStore } from "$lib/stores/auth";
	import Card from "$lib/components/ui/card/card.svelte";
	import CardHeader from "$lib/components/ui/card/card-header.svelte";
	import CardTitle from "$lib/components/ui/card/card-title.svelte";
	import CardContent from "$lib/components/ui/card/card-content.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import * as Select from "$lib/components/ui/select";
	import * as Popover from "$lib/components/ui/popover";
	import Checkbox from "$lib/components/ui/checkbox/checkbox.svelte";
	import Switch from "$lib/components/ui/switch/switch.svelte";
	import Spinner from "$lib/components/Spinner.svelte";
	import LogContextDialog from "$lib/components/LogContextDialog.svelte";
	import { ChevronDown, X } from "lucide-svelte";

	let logs = $state<any[]>([]);
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

	let searchQuery = $state("");
	let traceId = $state("");
	let selectedLevels = $state<string[]>([]);
	let selectedServices = $state<string[]>([]);

	const levelOptions = [
		{ value: "debug", label: "Debug" },
		{ value: "info", label: "Info" },
		{ value: "warn", label: "Warn" },
		{ value: "error", label: "Error" },
		{ value: "critical", label: "Critical" },
	];

	let availableServices = $derived([
		...new Set(logs.map((log) => log.service).filter(Boolean)),
	] as string[]);

	let limit = $state(50);
	let offset = $state(0);
	let total = $state(0);

	let contextDialogOpen = $state(false);
	let selectedLogForContext = $state<any | null>(null);

	const projectId = $derived($page.params.id);

	async function loadLogs() {
		if (!projectId) return;

		loading = true;
		error = "";

		try {
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
				limit,
				offset,
			};

			console.log("Loading logs with filters:", filters);

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

	$effect(() => {
		if (!browser || !projectId) {
			logs = [];
			lastLoadedProjectId = null;
			return;
		}

		if (projectId === lastLoadedProjectId) return;

		loadLogs();
	});

	$effect(() => {
		const _levels = selectedLevels;
		const _services = selectedServices;
		const _query = searchQuery;
		const _traceId = traceId;

		if (!browser || !projectId) return;

		if (!lastLoadedProjectId || projectId !== lastLoadedProjectId) return;

		offset = 0;

		loadLogs();
	});

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

		const url = `${PUBLIC_API_URL}/api/v1/logs/stream?${params.toString()}`;

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
			disconnectLiveTail();
			liveTailConnectionKey = null;
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

	$effect(() => {
		return () => {
			disconnectLiveTail();
		};
	});

	function formatTime(timestamp: string): string {
		const date = new Date(timestamp);
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

	function openContextDialog(log: any) {
		selectedLogForContext = log;
		contextDialogOpen = true;
	}

	function closeContextDialog() {
		contextDialogOpen = false;
		selectedLogForContext = null;
	}
</script>

<div class="space-y-6">
	<Card>
		<CardContent class="pt-6">
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<div>
					<Label for="search">Search</Label>
					<Input
						id="search"
						type="text"
						placeholder="Search logs..."
						bind:value={searchQuery}
					/>
				</div>

				<div>
					<Label for="traceId">Trace ID</Label>
					<Input
						id="traceId"
						type="text"
						placeholder="Filter by trace ID..."
						bind:value={traceId}
					/>
				</div>

				<div>
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
											{selectedLevels[0]
												.charAt(0)
												.toUpperCase() +
												selectedLevels[0].slice(1)}
										{:else}
											{selectedLevels.length} levels
										{/if}
									</span>
									<ChevronDown
										class="ml-2 h-4 w-4 shrink-0 opacity-50"
									/>
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
											selectedLevels = [
												"debug",
												"info",
												"warn",
												"error",
												"critical",
											];
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
										}}
									>
										Clear
									</Button>
								</div>
							</div>
							<div class="max-h-[300px] overflow-y-auto p-2">
								<div class="space-y-1">
									{#each ["debug", "info", "warn", "error", "critical"] as level}
										<label
											class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm"
										>
											<input
												type="checkbox"
												value={level}
												checked={selectedLevels.includes(
													level,
												)}
												onchange={(e) => {
													if (
														e.currentTarget.checked
													) {
														selectedLevels = [
															...selectedLevels,
															level,
														];
													} else {
														selectedLevels =
															selectedLevels.filter(
																(l) =>
																	l !== level,
															);
													}
												}}
												class="h-4 w-4 rounded border-gray-300"
											/>
											<span
												class="text-sm flex-1 capitalize"
												>{level}</span
											>
										</label>
									{/each}
								</div>
							</div>
						</Popover.Content>
					</Popover.Root>
				</div>

				<div>
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
										{:else if selectedServices.length === availableServices.length}
											All services ({availableServices.length})
										{:else if selectedServices.length === 1}
											{selectedServices[0]}
										{:else}
											{selectedServices.length} services
										{/if}
									</span>
									<ChevronDown
										class="ml-2 h-4 w-4 shrink-0 opacity-50"
									/>
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
											selectedServices =
												availableServices;
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
										}}
									>
										Clear
									</Button>
								</div>
							</div>
							<div class="max-h-[300px] overflow-y-auto p-2">
								{#if availableServices.length === 0}
									<div
										class="text-center py-4 text-sm text-muted-foreground"
									>
										No services available
									</div>
								{:else}
									<div class="space-y-1">
										{#each availableServices as service}
											<label
												class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm"
											>
												<input
													type="checkbox"
													value={service}
													checked={selectedServices.includes(
														service,
													)}
													onchange={(e) => {
														if (
															e.currentTarget
																.checked
														) {
															selectedServices = [
																...selectedServices,
																service,
															];
														} else {
															selectedServices =
																selectedServices.filter(
																	(s) =>
																		s !==
																		service,
																);
														}
													}}
													class="h-4 w-4 rounded border-gray-300"
												/>
												<span class="text-sm flex-1"
													>{service}</span
												>
											</label>
										{/each}
									</div>
								{/if}
							</div>
						</Popover.Content>
					</Popover.Root>
				</div>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>Logs</CardTitle>
				<div class="flex items-center gap-3">
					<Label
						for="live-tail"
						class="text-sm font-normal cursor-pointer"
					>
						Live Tail
					</Label>
					<Switch id="live-tail" bind:checked={liveTail} />
					{#if liveTail}
						<span
							class="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse"
						></span>
					{/if}
				</div>
			</div>
		</CardHeader>
		<CardContent>
			{#if loading}
				<div class="flex items-center justify-center py-12">
					<Spinner />
					<span class="ml-3 text-muted-foreground"
						>Loading logs...</span
					>
				</div>
			{:else if error}
				<div class="text-center py-12 text-destructive">
					{error}
				</div>
			{:else if logs.length === 0}
				<div class="text-center py-12 text-muted-foreground">
					No logs found. Start ingesting logs to see them here.
				</div>
			{:else}
				<div class="space-y-2">
					{#each logs as log}
						<div
							class="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
						>
							<div class="flex items-start justify-between gap-4">
								<div class="flex-1 space-y-2">
									<div
										class="flex items-center gap-3 flex-wrap"
									>
										<span
											class="text-sm text-muted-foreground font-mono"
										>
											{formatTime(log.time)}
										</span>
										<button
											class="text-sm font-medium hover:underline cursor-pointer"
											onclick={() => {
												if (
													!selectedServices.includes(
														log.service,
													)
												) {
													selectedServices = [
														...selectedServices,
														log.service,
													];
												}
											}}
											title="Click to filter by this service"
										>
											{log.service}
										</button>
										<button
											class="px-2 py-1 text-xs font-semibold rounded-full {getLevelColor(
												log.level,
											)} hover:opacity-80 transition-opacity cursor-pointer"
											onclick={() => {
												if (
													!selectedLevels.includes(
														log.level,
													)
												) {
													selectedLevels = [
														...selectedLevels,
														log.level,
													];
												}
											}}
											title="Click to filter by this level"
										>
											{log.level.toUpperCase()}
										</button>
										{#if log.traceId}
											<button
												class="px-2 py-1 text-xs font-mono bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition-colors cursor-pointer"
												onclick={() => {
													traceId = log.traceId || "";
												}}
												title="Click to filter by this trace ID"
											>
												Trace: {log.traceId.substring(
													0,
													8,
												)}...
											</button>
										{/if}
									</div>

									<p class="text-sm">{log.message}</p>

									{#if log.metadata && Object.keys(log.metadata).length > 0}
										<details class="text-xs">
											<summary
												class="cursor-pointer text-muted-foreground hover:text-foreground"
											>
												View metadata
											</summary>
											<pre
												class="mt-2 p-2 bg-muted rounded overflow-x-auto">{JSON.stringify(
													log.metadata,
													null,
													2,
												)}</pre>
										</details>
									{/if}
								</div>

								<div class="flex-shrink-0">
									<Button
										variant="ghost"
										size="sm"
										onclick={() => openContextDialog(log)}
										title="View logs before and after this entry"
									>
										Context
									</Button>
								</div>
							</div>
						</div>
					{/each}
				</div>

				<div
					class="flex items-center justify-between mt-6 pt-6 border-t"
				>
					<p class="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(
							offset + limit,
							total,
						)} of {total} logs
					</p>
					<div class="flex gap-2">
						<Button
							variant="outline"
							disabled={offset === 0}
							onclick={() => (offset -= limit)}
						>
							Previous
						</Button>
						<Button
							variant="outline"
							disabled={offset + limit >= total}
							onclick={() => (offset += limit)}
						>
							Next
						</Button>
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>

	<LogContextDialog
		open={contextDialogOpen}
		projectId={projectId || ""}
		selectedLog={selectedLogForContext}
		onClose={closeContextDialog}
	/>
</div>
