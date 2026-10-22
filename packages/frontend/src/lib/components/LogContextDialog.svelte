<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { logsAPI, type LogContextResponse, type LogEntry } from '$lib/api/logs';
	import * as Dialog from '$lib/components/ui/dialog';
	import Button from '$lib/components/ui/button/button.svelte';
	import Switch from '$lib/components/ui/switch/switch.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
	import KeyValueTable from '$lib/components/app/KeyValueTable.svelte';
	import { ExceptionDetailsDialog } from '$lib/components/exceptions';
	import BreadcrumbTimeline from '$lib/components/BreadcrumbTimeline.svelte';
	import { createRequestGuard } from '$lib/components/search/request-guard';
	import { detailsMetadata, logBreadcrumbs, logHostname } from '$lib/components/search/log-fields';
	import { formatTimestamp, getDisplayZoneLabel } from '$lib/utils/datetime';
	import { displayPreferences } from '$lib/stores/display-preferences';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';

	/** Rows added per "Load 25 earlier / later" click, and the first load per side. */
	const CONTEXT_STEP = 25;
	/** Server cap per side. */
	const CONTEXT_MAX = 100;

	interface Props {
		open: boolean;
		projectId: string;
		organizationId?: string;
		selectedLog: LogEntry | null;
		onClose: () => void;
		/** A context row was clicked: the page opens the explorer around that log. */
		onOpenAround?: (log: LogEntry) => void;
	}

	let { open = false, projectId, organizationId = '', selectedLog, onClose, onOpenAround }: Props = $props();

	const guard = createRequestGuard();

	let beforeSize = $state(CONTEXT_STEP);
	let afterSize = $state(CONTEXT_STEP);
	let sameService = $state(false);
	let sameHost = $state(false);
	let loading = $state(false);
	let error = $state('');
	let context = $state<LogContextResponse | null>(null);
	/** Sizes of the request whose response is shown, to tell whether a side ran out. */
	let shownSizes = $state<{ before: number; after: number } | null>(null);

	let exceptionDialogOpen = $state(false);
	let breadcrumbsOpen = $state(false);
	const expandedMetadata = new SvelteSet<string>();

	const host = $derived(selectedLog ? logHostname(selectedLog) : null);
	const breadcrumbs = $derived(selectedLog ? logBreadcrumbs(selectedLog) : []);
	const selectedMetadata = $derived(selectedLog ? detailsMetadata(selectedLog.metadata) : null);
	const zoneLabel = $derived.by(() => {
		void $displayPreferences;
		return getDisplayZoneLabel(selectedLog ? new Date(selectedLog.time) : new Date());
	});

	const canLoadEarlier = $derived(
		!!context && !!shownSizes && beforeSize < CONTEXT_MAX && context.before.length >= shownSizes.before,
	);
	const canLoadLater = $derived(
		!!context && !!shownSizes && afterSize < CONTEXT_MAX && context.after.length >= shownSizes.after,
	);

	// A new log (or a reopen) starts from 25 on each side with both toggles off.
	let anchorKey: string | null = null;
	$effect(() => {
		const key = open && selectedLog ? `${selectedLog.id ?? ''}|${selectedLog.time}` : null;
		if (key === anchorKey) return;
		anchorKey = key;
		untrack(() => {
			guard.invalidate();
			beforeSize = CONTEXT_STEP;
			afterSize = CONTEXT_STEP;
			sameService = false;
			sameHost = false;
			context = null;
			shownSizes = null;
			error = '';
			loading = false;
			breadcrumbsOpen = false;
			exceptionDialogOpen = false;
			expandedMetadata.clear();
			if (key) void load();
		});
	});

	async function load() {
		const log = selectedLog;
		if (!log) return;
		const token = guard.begin();
		const sizes = { before: beforeSize, after: afterSize };
		loading = true;
		error = '';
		try {
			const response = await logsAPI.getLogContext({
				projectId,
				time: log.time,
				logId: log.id,
				before: sizes.before,
				after: sizes.after,
				sameService,
				sameHost,
			});
			if (!guard.isCurrent(token)) return;
			context = response;
			shownSizes = sizes;
			// The server decides which filters took effect (it derives them from the reference log).
			if (response.applied) {
				sameService = response.applied.service !== null;
				sameHost = response.applied.hostname !== null;
			}
		} catch (e) {
			if (!guard.isCurrent(token)) return;
			console.error('Failed to load log context:', e);
			error = e instanceof Error ? e.message : 'Failed to load log context';
		} finally {
			if (guard.isCurrent(token)) loading = false;
		}
	}

	function loadEarlier() {
		beforeSize = Math.min(CONTEXT_MAX, beforeSize + CONTEXT_STEP);
		void load();
	}

	function loadLater() {
		afterSize = Math.min(CONTEXT_MAX, afterSize + CONTEXT_STEP);
		void load();
	}

	function setSameService(next: boolean) {
		sameService = next;
		void load();
	}

	function setSameHost(next: boolean) {
		if (!host) return;
		sameHost = next;
		void load();
	}

	function time(value: string): string {
		void $displayPreferences;
		return formatTimestamp(value, { precision: 'ms', withDate: true });
	}

	function traceHref(log: LogEntry): string {
		const project = log.projectId || projectId;
		return `/dashboard/traces/${encodeURIComponent(log.traceId ?? '')}?projectId=${encodeURIComponent(project)}`;
	}

	function shortTrace(traceId: string): string {
		return traceId.length > 12 ? `${traceId.slice(0, 12)}...` : traceId;
	}

	function rowKey(side: 'before' | 'after', log: LogEntry, index: number): string {
		return `${side}-${log.id ?? `${log.time}-${index}`}`;
	}

	function toggleMetadata(key: string, event: Event) {
		if ((event.currentTarget as HTMLDetailsElement).open) expandedMetadata.add(key);
		else expandedMetadata.delete(key);
	}

	const fmt = (n: number) => n.toLocaleString('en-US');
	const logsLabel = (n: number) => `${fmt(n)} ${n === 1 ? 'log' : 'logs'}`;
	const isErrorLevel = (level: string) => level === 'error' || level === 'critical';
</script>

{#snippet metadataBlock(metadata: Record<string, unknown>, key: string, testId?: string)}
	<details class="mt-2 min-w-0 text-xs" data-testid={testId} ontoggle={(e) => toggleMetadata(key, e)}>
		<summary class="cursor-pointer text-muted-foreground hover:text-foreground">View metadata</summary>
		{#if expandedMetadata.has(key)}
			<div class="mt-2 min-w-0">
				<KeyValueTable data={metadata} />
			</div>
		{/if}
	</details>
{/snippet}

{#snippet contextRow(log: LogEntry, key: string)}
	{@const metadata = detailsMetadata(log.metadata)}
	<li class="overflow-hidden rounded-lg border transition-colors hover:bg-accent/30">
		{#if onOpenAround}
			<button
				type="button"
				class="block w-full px-3 pt-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {log.traceId || metadata ? 'pb-1' : 'pb-2.5'}"
				title="Open in the explorer around this log"
				onclick={() => onOpenAround?.(log)}
			>
				{@render rowSummary(log)}
			</button>
		{:else}
			<div class="px-3 pt-2.5 {log.traceId || metadata ? 'pb-1' : 'pb-2.5'}">
				{@render rowSummary(log)}
			</div>
		{/if}
		{#if log.traceId || metadata}
			<div class="min-w-0 px-3 pb-2.5">
				{#if log.traceId}
					<a
						href={traceHref(log)}
						class="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
						title="Open trace {log.traceId}"
					>
						Trace {shortTrace(log.traceId)}
					</a>
				{/if}
				{#if metadata}
					{@render metadataBlock(metadata, key)}
				{/if}
			</div>
		{/if}
	</li>
{/snippet}

{#snippet rowSummary(log: LogEntry)}
	<span class="mb-1 flex flex-wrap items-center gap-2">
		<span class="font-mono text-xs text-muted-foreground">{time(log.time)}</span>
		<span class="text-xs font-medium">{log.service}</span>
		<SeverityBadge kind="level" value={log.level} />
	</span>
	<span class="block whitespace-pre-wrap break-words text-xs">{log.message}</span>
{/snippet}

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
	<Dialog.Content class="max-h-[80vh] max-w-4xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Log context</Dialog.Title>
			<Dialog.Description>
				Logs before and after the selected entry. Times in {zoneLabel}.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
			<div class="flex items-center gap-2">
				<Switch
					id="context-same-service"
					aria-label="Same service"
					disabled={!selectedLog}
					bind:checked={() => sameService, setSameService}
				/>
				<label for="context-same-service" class="cursor-pointer">Same service</label>
				{#if sameService && context?.applied?.service}
					<span class="font-mono text-xs text-muted-foreground">Service: {context.applied.service}</span>
				{/if}
			</div>
			<div class="flex items-center gap-2" title={host ? undefined : 'This log has no host'}>
				<Switch
					id="context-same-host"
					aria-label="Same host"
					disabled={!host}
					bind:checked={() => sameHost, setSameHost}
				/>
				<label for="context-same-host" class={host ? 'cursor-pointer' : 'text-muted-foreground'}>Same host</label>
				{#if sameHost && context?.applied?.hostname}
					<span class="font-mono text-xs text-muted-foreground">Host: {context.applied.hostname}</span>
				{/if}
			</div>
			{#if loading && context}
				<Spinner size="sm" />
			{/if}
		</div>

		{#if loading && !context}
			<div class="flex items-center justify-center py-12">
				<Spinner />
				<span class="ml-3 text-muted-foreground">Loading context</span>
			</div>
		{:else if error && !context}
			<div class="py-12 text-center text-destructive">{error}</div>
		{:else if context}
			<div class="min-w-0 space-y-2 py-2">
				{#if error}
					<p class="text-sm text-destructive">{error}</p>
				{/if}
				{#if canLoadEarlier}
					<Button variant="outline" size="sm" class="w-full gap-1.5" disabled={loading} onclick={loadEarlier}>
						<ChevronUp class="size-4" aria-hidden="true" />
						Load 25 earlier
					</Button>
				{/if}

				{#if context.before.length > 0}
					<p class="text-xs text-muted-foreground">{logsLabel(context.before.length)} before</p>
					<ul class="space-y-2 opacity-80">
						{#each context.before as log, i (rowKey('before', log, i))}
							{@render contextRow(log, rowKey('before', log, i))}
						{/each}
					</ul>
				{/if}

				{#if selectedLog}
					<section class="overflow-hidden rounded-lg border-2 border-primary bg-primary/5 p-4" aria-label="Selected log">
						<h3 class="mb-2 text-xs font-semibold text-primary">Selected log</h3>
						<div class="mb-2 flex flex-wrap items-center gap-3">
							<span class="font-mono text-sm text-muted-foreground">{time(selectedLog.time)}</span>
							<span class="text-sm font-medium">{selectedLog.service}</span>
							<SeverityBadge kind="level" value={selectedLog.level} />
							{#if selectedLog.traceId}
								<a
									href={traceHref(selectedLog)}
									class="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
									title="Open trace {selectedLog.traceId}"
								>
									Trace {shortTrace(selectedLog.traceId)}
								</a>
							{/if}
						</div>
						<p class="whitespace-pre-wrap break-words text-sm font-medium">{selectedLog.message}</p>
						{#if selectedMetadata}
							{@render metadataBlock(selectedMetadata, 'selected', 'selected-metadata')}
						{/if}
						{#if isErrorLevel(selectedLog.level) && selectedLog.id && organizationId}
							<div class="mt-3 border-t pt-2">
								<Button variant="outline" size="sm" class="gap-2" onclick={() => (exceptionDialogOpen = true)}>
									<AlertTriangle class="size-4 text-destructive-text" aria-hidden="true" />
									View exception details
								</Button>
							</div>
						{/if}
						{#if breadcrumbs.length > 0}
							<div class="mt-3 border-t pt-2">
								<button
									type="button"
									class="flex w-full items-center gap-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
									aria-expanded={breadcrumbsOpen}
									onclick={() => (breadcrumbsOpen = !breadcrumbsOpen)}
								>
									<ListTree class="size-4" aria-hidden="true" />
									Breadcrumbs ({fmt(breadcrumbs.length)})
									{#if breadcrumbsOpen}
										<ChevronDown class="ml-auto size-4" aria-hidden="true" />
									{:else}
										<ChevronRight class="ml-auto size-4" aria-hidden="true" />
									{/if}
								</button>
								{#if breadcrumbsOpen}
									<div class="mt-2 max-h-64 overflow-auto">
										<BreadcrumbTimeline {breadcrumbs} eventTime={selectedLog.time} />
									</div>
								{/if}
							</div>
						{/if}
					</section>
				{/if}

				{#if context.after.length > 0}
					<p class="pt-2 text-xs text-muted-foreground">{logsLabel(context.after.length)} after</p>
					<ul class="space-y-2 opacity-80">
						{#each context.after as log, i (rowKey('after', log, i))}
							{@render contextRow(log, rowKey('after', log, i))}
						{/each}
					</ul>
				{/if}

				{#if canLoadLater}
					<Button variant="outline" size="sm" class="w-full gap-1.5" disabled={loading} onclick={loadLater}>
						<ChevronDown class="size-4" aria-hidden="true" />
						Load 25 later
					</Button>
				{/if}

				{#if context.before.length === 0 && context.after.length === 0}
					<div class="py-6 text-center text-sm text-muted-foreground">
						No logs found before or after this entry
					</div>
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={onClose}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if selectedLog?.id && organizationId}
	<ExceptionDetailsDialog
		open={exceptionDialogOpen}
		logId={selectedLog.id}
		{organizationId}
		metadata={selectedLog.metadata ?? null}
		onClose={() => (exceptionDialogOpen = false)}
	/>
{/if}
