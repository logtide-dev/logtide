<script lang="ts">
	import { untrack } from "svelte";
	import { parseLogQuery, resolveMetadataPath, formatMetadataCell } from "@logtide/shared";
	import { logsAPI, type LogEntry } from "$lib/api/logs";
	import { toastStore } from "$lib/stores/toast";
	import { displayPreferences } from "$lib/stores/display-preferences";
	import { formatRange } from "$lib/utils/datetime";
	import { describeQuery } from "$lib/components/search/query-describe";
	import { logHostname } from "$lib/components/search/log-fields";
	import * as Dialog from "$lib/components/ui/dialog";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import { Progress } from "$lib/components/ui/progress";
	import Spinner from "$lib/components/Spinner.svelte";
	import FileJson from "@lucide/svelte/icons/file-json";
	import FileText from "@lucide/svelte/icons/file-text";
	import Download from "@lucide/svelte/icons/download";

	/** Exactly the scope and query of the run the explorer shows. */
	interface ExportScope {
		q: string;
		projectIds: string[];
		from: string;
		to: string;
	}

	interface Props {
		open: boolean;
		totalLogs: number;
		scope: ExportScope;
		projects: { id: string; name: string }[];
		customColumns: string[];
		onOpenChange?: (open: boolean) => void;
	}

	let {
		open = $bindable(),
		totalLogs,
		scope,
		projects,
		customColumns,
		onOpenChange,
	}: Props = $props();

	const MAX_EXPORT_LOGS = 50000;
	const BATCH_SIZE = 1000;

	let format = $state<"json" | "csv">("json");
	let exportLimit = $state(1000);
	let isExporting = $state(false);
	let exportProgress = $state({ current: 0, total: 0 });

	const maxExportable = $derived(Math.min(totalLogs, MAX_EXPORT_LOGS));
	const fmt = (n: number) => n.toLocaleString("en-US");
	const logsLabel = (n: number) => `${fmt(n)} ${n === 1 ? "log" : "logs"}`;

	// Every opening starts from JSON and up to 1,000 logs.
	let wasOpen = false;
	$effect(() => {
		const isOpen = !!open;
		if (isOpen && !wasOpen) {
			untrack(() => {
				format = "json";
				exportLimit = Math.min(totalLogs, BATCH_SIZE);
				isExporting = false;
				exportProgress = { current: 0, total: 0 };
			});
		}
		wasOpen = isOpen;
	});

	const projectNames = $derived(new Map(projects.map((p) => [p.id, p.name])));

	const projectsText = $derived.by(() => {
		const names = scope.projectIds.map((id) => projectNames.get(id) ?? id);
		if (names.length === 0) return "All projects";
		if (names.length <= 3) return names.join(", ");
		return `${names.slice(0, 2).join(", ")} +${fmt(names.length - 2)} more`;
	});

	const filterLines = $derived.by(() => {
		const q = scope.q.trim();
		if (q === "") return [];
		const parsed = parseLogQuery(q);
		return parsed.ok ? describeQuery(parsed.query) : [`Query ${q}`];
	});

	const rangeText = $derived.by(() => {
		void $displayPreferences;
		return formatRange(scope.from, scope.to);
	});

	function downloadFile(content: string, filename: string, type: string) {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	// RFC 4180: fields holding a comma, a quote or a line break are quoted, quotes doubled.
	function escapeCsvField(field: string): string {
		if (field.includes(",") || field.includes("\n") || field.includes("\r") || field.includes('"')) {
			return `"${field.replace(/"/g, '""')}"`;
		}
		return field;
	}

	function toCsv(logs: LogEntry[]): string {
		const headers = [
			"Time",
			"Project",
			"Service",
			"Host",
			"Level",
			"Message",
			"Trace ID",
			"Session ID",
			...customColumns,
			"Metadata",
		];
		const rows = logs.map((log) => {
			const metadata = log.metadata && typeof log.metadata === "object" ? log.metadata : null;
			return [
				String(log.time ?? ""),
				projectNames.get(log.projectId) ?? log.projectId ?? "",
				String(log.service ?? ""),
				logHostname(log) ?? "",
				String(log.level ?? ""),
				String(log.message ?? ""),
				log.traceId ?? "",
				log.sessionId ?? "",
				...customColumns.map((path) => formatMetadataCell(resolveMetadataPath(metadata, path)) ?? ""),
				JSON.stringify(metadata ?? {}),
			];
		});
		return [headers, ...rows].map((row) => row.map(escapeCsvField).join(",")).join("\n");
	}

	async function fetchLogs(limit: number): Promise<LogEntry[]> {
		const all: LogEntry[] = [];
		let cursor: string | undefined;
		while (all.length < limit) {
			const response = await logsAPI.getLogs({
				projectId: scope.projectIds,
				...(scope.q.trim() ? { q: scope.q } : {}),
				from: scope.from,
				to: scope.to,
				limit: Math.min(BATCH_SIZE, limit - all.length),
				...(cursor ? { cursor } : {}),
			});
			all.push(...response.logs.slice(0, limit - all.length));
			exportProgress = { current: all.length, total: limit };
			if (!response.nextCursor || response.logs.length === 0) break;
			cursor = response.nextCursor;
		}
		return all;
	}

	async function handleExport() {
		const limit = Math.floor(Number(exportLimit));
		if (!Number.isFinite(limit) || limit < 1 || limit > maxExportable) {
			toastStore.error(`Enter a number between 1 and ${fmt(maxExportable)}`);
			return;
		}

		isExporting = true;
		exportProgress = { current: 0, total: limit };

		try {
			const logs = await fetchLogs(limit);
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
			const filename = `logs-export-${timestamp}.${format}`;
			if (format === "json") {
				downloadFile(JSON.stringify(logs, null, 2), filename, "application/json");
			} else {
				downloadFile(toCsv(logs), filename, "text/csv");
			}
			toastStore.success(`Exported ${logsLabel(logs.length)}`);
			open = false;
			onOpenChange?.(false);
		} catch (error) {
			console.error("Export failed:", error);
			toastStore.error("Could not export logs");
		} finally {
			isExporting = false;
			exportProgress = { current: 0, total: 0 };
		}
	}

	function close() {
		if (isExporting) return;
		open = false;
		onOpenChange?.(false);
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
				<Download class="size-5" aria-hidden="true" />
				Export logs
			</Dialog.Title>
			<Dialog.Description>Export logs matching the current query and scope</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6 py-4">
			<div class="space-y-2">
				<h3 class="text-sm font-medium">Active filters</h3>
				<dl class="space-y-1 rounded-md bg-muted p-3 text-sm">
					<div class="flex justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Time range</dt>
						<dd class="text-right">{rangeText}</dd>
					</div>
					<div class="flex justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Projects</dt>
						<dd class="min-w-0 truncate text-right" title={projectsText}>{projectsText}</dd>
					</div>
					<div class="flex justify-between gap-4">
						<dt class="shrink-0 text-muted-foreground">Query</dt>
						<dd class="min-w-0 text-right">
							{#if filterLines.length === 0}
								<span>No filters</span>
							{:else}
								<ul class="space-y-0.5">
									{#each filterLines as line, i (i)}
										<li class="break-words">{line}</li>
									{/each}
								</ul>
							{/if}
						</dd>
					</div>
					<div class="mt-2 flex justify-between gap-4 border-t pt-1 font-medium">
						<dt>Total matching</dt>
						<dd>{logsLabel(totalLogs)}</dd>
					</div>
				</dl>
			</div>

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
					<span class="text-sm text-muted-foreground">/ {fmt(maxExportable)} max</span>
				</div>
				{#if totalLogs > MAX_EXPORT_LOGS}
					<p class="text-xs text-warning-text">
						Exports stop at {fmt(MAX_EXPORT_LOGS)} logs. Narrow the time range or the query to export the rest.
					</p>
				{/if}
				<div class="mt-2 flex gap-2">
					<Button variant="outline" size="sm" onclick={() => (exportLimit = Math.min(100, maxExportable))} disabled={isExporting}>
						100
					</Button>
					<Button variant="outline" size="sm" onclick={() => (exportLimit = Math.min(1000, maxExportable))} disabled={isExporting}>
						1K
					</Button>
					<Button variant="outline" size="sm" onclick={() => (exportLimit = Math.min(10000, maxExportable))} disabled={isExporting}>
						10K
					</Button>
					<Button variant="outline" size="sm" onclick={() => (exportLimit = maxExportable)} disabled={isExporting}>
						All
					</Button>
				</div>
			</div>

			<div class="space-y-2">
				<h3 class="text-sm font-medium">Export format</h3>
				<div class="flex gap-3">
					<Button
						variant={format === "json" ? "default" : "outline"}
						aria-pressed={format === "json"}
						onclick={() => (format = "json")}
						disabled={isExporting}
						class="flex-1 gap-2"
					>
						<FileJson class="size-4" aria-hidden="true" />
						JSON
					</Button>
					<Button
						variant={format === "csv" ? "default" : "outline"}
						aria-pressed={format === "csv"}
						onclick={() => (format = "csv")}
						disabled={isExporting}
						class="flex-1 gap-2"
					>
						<FileText class="size-4" aria-hidden="true" />
						CSV
					</Button>
				</div>
			</div>

			{#if isExporting}
				<div class="space-y-2">
					<div class="flex justify-between text-sm">
						<span>Exporting</span>
						<span>{fmt(exportProgress.current)} / {fmt(exportProgress.total)}</span>
					</div>
					<Progress value={exportProgress.current} max={exportProgress.total} />
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={close} disabled={isExporting}>Cancel</Button>
			<Button onclick={handleExport} disabled={isExporting || totalLogs === 0}>
				{#if isExporting}
					<Spinner size="sm" className="mr-2" />
					Exporting
				{:else}
					<Download class="mr-2 size-4" aria-hidden="true" />
					Export {logsLabel(Number(exportLimit) || 0)}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
