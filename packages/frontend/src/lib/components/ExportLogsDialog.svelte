<script lang="ts">
	import { logsAPI } from "$lib/api/logs";
	import { toastStore } from "$lib/stores/toast";
	import * as Dialog from "$lib/components/ui/dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import { Progress } from "$lib/components/ui/progress";
	import Spinner from "$lib/components/Spinner.svelte";
	import FileJson from "@lucide/svelte/icons/file-json";
	import FileText from "@lucide/svelte/icons/file-text";
	import Download from "@lucide/svelte/icons/download";

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

	interface LogFilters {
		projectId?: string | string[];
		service?: string | string[];
		level?: string | string[];
		traceId?: string;
		from?: string;
		to?: string;
		q?: string;
	}

	interface Props {
		open: boolean;
		totalLogs: number;
		filters: LogFilters;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		totalLogs,
		filters,
		onOpenChange,
	}: Props = $props();

	const MAX_EXPORT_LOGS = 50000;
	const BATCH_SIZE = 1000;

	let format = $state<"json" | "csv">("json");
	let exportLimit = $state(1000);
	let isExporting = $state(false);
	let exportProgress = $state({ current: 0, total: 0 });

	// Calculate max exportable logs
	let maxExportable = $derived(Math.min(totalLogs, MAX_EXPORT_LOGS));

	// Reset form when dialog opens
	$effect(() => {
		if (open) {
			format = "json";
			exportLimit = Math.min(totalLogs, 1000);
			isExporting = false;
			exportProgress = { current: 0, total: 0 };
		}
	});

	// Format time range for display
	function formatTimeRange(from?: string, to?: string): string {
		if (!from && !to) return "All time";
		const fromDate = from ? new Date(from) : null;
		const toDate = to ? new Date(to) : null;

		const formatDate = (d: Date) => {
			return d.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		};

		if (fromDate && toDate) {
			return `${formatDate(fromDate)} - ${formatDate(toDate)}`;
		} else if (fromDate) {
			return `From ${formatDate(fromDate)}`;
		} else if (toDate) {
			return `Until ${formatDate(toDate)}`;
		}
		return "All time";
	}

	// Format filter values for display
	function formatFilterValue(value: string | string[] | undefined): string {
		if (!value) return "All";
		if (Array.isArray(value)) {
			if (value.length === 0) return "All";
			if (value.length <= 3) return value.join(", ");
			return `${value.slice(0, 2).join(", ")} +${value.length - 2} more`;
		}
		return value;
	}

	function downloadFile(content: string, filename: string, type: string) {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	// Helper to escape CSV fields according to RFC 4180
	function escapeCsvField(field: string): string {
		// If the field contains comma, newline, or quote, it must be quoted
		if (field.includes(',') || field.includes('\n') || field.includes('\r') || field.includes('"')) {
			return `"${field.replace(/"/g, '""')}"`;
		}
		return field;
	}

	async function handleExport() {
		if (exportLimit < 1 || exportLimit > maxExportable) {
			toastStore.error(`Please enter a number between 1 and ${maxExportable.toLocaleString()}`);
			return;
		}

		isExporting = true;
		exportProgress = { current: 0, total: exportLimit };

		try {
			const allLogs: LogEntry[] = [];
			let actualTotal = exportLimit;

			// Fetch logs in batches
			for (let offset = 0; offset < exportLimit; offset += BATCH_SIZE) {
				const limit = Math.min(BATCH_SIZE, exportLimit - offset);

				const response = await logsAPI.getLogs({
					...filters,
					limit,
					offset,
				});

				// Update actual total based on API response
				actualTotal = Math.min(exportLimit, response.total);

				allLogs.push(...response.logs);
				exportProgress = { current: allLogs.length, total: actualTotal };

				// Stop if we've fetched all available logs or got empty response
				if (response.logs.length === 0 || allLogs.length >= response.total) {
					break;
				}
			}

			// Generate file
			const timestamp = new Date()
				.toISOString()
				.replace(/[:.]/g, "-")
				.slice(0, -5);
			const filename = `logs-export-${timestamp}.${format}`;

			if (format === "json") {
				const dataStr = JSON.stringify(allLogs, null, 2);
				downloadFile(dataStr, filename, "application/json");
			} else {
				// RFC 4180 compliant CSV generation
				const headers = ["Time", "Service", "Level", "Message", "Metadata", "TraceID"];
				const rows = allLogs.map((log) => [
					escapeCsvField(log.time),
					escapeCsvField(log.service),
					escapeCsvField(log.level),
					escapeCsvField(log.message),
					escapeCsvField(JSON.stringify(log.metadata || {})),
					escapeCsvField(log.traceId || ""),
				]);
				const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
				downloadFile(csv, filename, "text/csv");
			}

			toastStore.success(`Exported ${allLogs.length.toLocaleString()} logs successfully`);
			open = false;
		} catch (error) {
			console.error("Export failed:", error);
			toastStore.error("Failed to export logs. Please try again.");
		} finally {
			isExporting = false;
			exportProgress = { current: 0, total: 0 };
		}
	}
</script>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		if (!isExporting) {
			open = o;
			onOpenChange?.(o);
		}
	}}
>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Download class="w-5 h-5" />
				Export Logs
			</Dialog.Title>
			<Dialog.Description>
				Export logs matching your current filters
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6 py-4">
			<!-- Active Filters Summary -->
			<div class="space-y-2">
				<Label class="text-sm font-medium">Active Filters</Label>
				<div class="bg-muted rounded-md p-3 space-y-1 text-sm">
					<div class="flex justify-between">
						<span class="text-muted-foreground">Time Range:</span>
						<span>{formatTimeRange(filters.from, filters.to)}</span>
					</div>
					{#if filters.service}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Services:</span>
							<span>{formatFilterValue(filters.service)}</span>
						</div>
					{/if}
					{#if filters.level}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Levels:</span>
							<span>{formatFilterValue(filters.level)}</span>
						</div>
					{/if}
					{#if filters.q}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Search:</span>
							<span class="truncate max-w-[200px]">"{filters.q}"</span>
						</div>
					{/if}
					{#if filters.traceId}
						<div class="flex justify-between">
							<span class="text-muted-foreground">Trace ID:</span>
							<span class="truncate max-w-[200px] font-mono text-xs">{filters.traceId}</span>
						</div>
					{/if}
					<div class="flex justify-between font-medium pt-1 border-t mt-2">
						<span>Total Matching:</span>
						<span>{totalLogs.toLocaleString()} logs</span>
					</div>
				</div>
			</div>

			<!-- Export Limit -->
			<div class="space-y-2">
				<Label for="exportLimit">Number of logs to export</Label>
				<div class="flex items-center gap-3">
					<Input
						id="exportLimit"
						type="number"
						min={1}
						max={maxExportable}
						bind:value={exportLimit}
						disabled={isExporting}
						class="w-32"
					/>
					<span class="text-sm text-muted-foreground">
						/ {maxExportable.toLocaleString()} max
					</span>
				</div>
				{#if totalLogs > MAX_EXPORT_LOGS}
					<p class="text-xs text-amber-600">
						Maximum export limit is {MAX_EXPORT_LOGS.toLocaleString()} logs.
						Use time filters to narrow down your results.
					</p>
				{/if}
				<div class="flex gap-2 mt-2">
					<Button
						variant="outline"
						size="sm"
						onclick={() => (exportLimit = Math.min(100, maxExportable))}
						disabled={isExporting}
					>
						100
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => (exportLimit = Math.min(1000, maxExportable))}
						disabled={isExporting}
					>
						1K
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => (exportLimit = Math.min(10000, maxExportable))}
						disabled={isExporting}
					>
						10K
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => (exportLimit = maxExportable)}
						disabled={isExporting}
					>
						All
					</Button>
				</div>
			</div>

			<!-- Format Selection -->
			<div class="space-y-2">
				<Label>Export Format</Label>
				<div class="flex gap-3">
					<Button
						variant={format === "json" ? "default" : "outline"}
						onclick={() => (format = "json")}
						disabled={isExporting}
						class="flex-1 gap-2"
					>
						<FileJson class="w-4 h-4" />
						JSON
					</Button>
					<Button
						variant={format === "csv" ? "default" : "outline"}
						onclick={() => (format = "csv")}
						disabled={isExporting}
						class="flex-1 gap-2"
					>
						<FileText class="w-4 h-4" />
						CSV
					</Button>
				</div>
			</div>

			<!-- Progress -->
			{#if isExporting}
				<div class="space-y-2">
					<div class="flex justify-between text-sm">
						<span>Exporting...</span>
						<span>
							{exportProgress.current.toLocaleString()} / {exportProgress.total.toLocaleString()}
						</span>
					</div>
					<Progress value={exportProgress.current} max={exportProgress.total} />
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				onclick={() => (open = false)}
				disabled={isExporting}
			>
				Cancel
			</Button>
			<Button onclick={handleExport} disabled={isExporting || totalLogs === 0}>
				{#if isExporting}
					<Spinner size="sm" className="mr-2" />
					Exporting...
				{:else}
					<Download class="w-4 h-4 mr-2" />
					Export {exportLimit.toLocaleString()} Logs
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
