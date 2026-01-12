<script lang="ts">
	import { logsAPI } from '$lib/api/logs';
	import * as Dialog from '$lib/components/ui/dialog';
	import Button from '$lib/components/ui/button/button.svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import { ExceptionDetailsDialog } from '$lib/components/exceptions';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	interface LogEntry {
		id?: string;
		time: string;
		service: string;
		level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
		message: string;
		metadata?: Record<string, any>;
		traceId?: string;
		projectId: string;
	}

	interface Props {
		open: boolean;
		projectId: string;
		organizationId?: string;
		selectedLog: LogEntry | null;
		onClose: () => void;
	}

	let { open = false, projectId, organizationId = '', selectedLog, onClose }: Props = $props();

	// Exception dialog state
	let exceptionDialogOpen = $state(false);

	function isErrorLevel(level: string): boolean {
		return level === 'error' || level === 'critical';
	}

	function openExceptionDialog() {
		exceptionDialogOpen = true;
	}

	function closeExceptionDialog() {
		exceptionDialogOpen = false;
	}

	let loading = $state(false);
	let error = $state('');
	let contextLogs = $state<{
		before: LogEntry[];
		current: LogEntry | null;
		after: LogEntry[];
	} | null>(null);

	$effect(() => {
		if (open && selectedLog) {
			loadContext();
		} else {
			contextLogs = null;
			error = '';
		}
	});

	async function loadContext() {
		if (!selectedLog) return;

		loading = true;
		error = '';

		try {
			const context = await logsAPI.getLogContext({
				projectId,
				time: selectedLog.time,
				before: 10,
				after: 10,
			});

			contextLogs = context;
		} catch (e) {
			console.error('Failed to load log context:', e);
			error = e instanceof Error ? e.message : 'Failed to load log context';
		} finally {
			loading = false;
		}
	}

	function formatTime(timestamp: string): string {
		return new Date(timestamp).toLocaleString();
	}

	function getLevelColor(level: string): string {
		switch (level) {
			case 'debug':
				return 'bg-gray-100 text-gray-800';
			case 'info':
				return 'bg-blue-100 text-blue-800';
			case 'warn':
				return 'bg-yellow-100 text-yellow-800';
			case 'error':
				return 'bg-red-100 text-red-800';
			case 'critical':
				return 'bg-purple-100 text-purple-800';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onClose()}>
	<Dialog.Content class="max-w-4xl max-h-[80vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Log Context</Dialog.Title>
			<Dialog.Description>
				View logs before and after the selected log entry
			</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<div class="flex items-center justify-center py-12">
				<Spinner />
				<span class="ml-3 text-muted-foreground">Loading context...</span>
			</div>
		{:else if error}
			<div class="text-center py-12 text-destructive">
				{error}
			</div>
		{:else if contextLogs}
			<div class="space-y-2 py-4">
				{#if contextLogs.before.length > 0}
					<div class="text-xs text-muted-foreground mb-2">
						← {contextLogs.before.length} log(s) before
					</div>
					{#each contextLogs.before as log}
						<div class="border rounded-lg p-3 hover:bg-accent/30 transition-colors opacity-70">
							<div class="flex items-center gap-3 flex-wrap mb-2">
								<span class="text-xs text-muted-foreground font-mono">
									{formatTime(log.time)}
								</span>
								<span class="text-xs font-medium">{log.service}</span>
								<span class="px-2 py-1 text-xs font-semibold rounded-full {getLevelColor(log.level)}">
									{log.level.toUpperCase()}
								</span>
								{#if log.traceId}
									<span class="px-2 py-1 text-xs font-mono bg-purple-100 text-purple-800 rounded">
										Trace: {log.traceId.substring(0, 8)}...
									</span>
								{/if}
							</div>
							<p class="text-xs mb-2">{log.message}</p>
							{#if log.metadata && Object.keys(log.metadata).length > 0}
								<details class="text-xs">
									<summary class="cursor-pointer text-muted-foreground hover:text-foreground">
										View metadata
									</summary>
									<pre class="mt-2 p-2 bg-muted rounded overflow-x-auto">{JSON.stringify(log.metadata, null, 2)}</pre>
								</details>
							{/if}
						</div>
					{/each}
				{/if}

				{#if selectedLog}
					<div class="border-2 border-primary rounded-lg p-4 bg-primary/5">
						<div class="text-xs font-semibold text-primary mb-2">
							→ Selected Log
						</div>
						<div class="flex items-center gap-3 flex-wrap mb-2">
							<span class="text-sm text-muted-foreground font-mono">
								{formatTime(selectedLog.time)}
							</span>
							<span class="text-sm font-medium">{selectedLog.service}</span>
							<span class="px-2 py-1 text-xs font-semibold rounded-full {getLevelColor(selectedLog.level)}">
								{selectedLog.level.toUpperCase()}
							</span>
							{#if selectedLog.traceId}
								<span class="px-2 py-1 text-xs font-mono bg-purple-100 text-purple-800 rounded">
									Trace: {selectedLog.traceId.substring(0, 8)}...
								</span>
							{/if}
						</div>
						<p class="text-sm font-medium">{selectedLog.message}</p>
						{#if selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0}
							<details class="text-xs mt-2">
								<summary class="cursor-pointer text-muted-foreground hover:text-foreground">
									View metadata
								</summary>
								<pre class="mt-2 p-2 bg-muted rounded overflow-x-auto">{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
							</details>
						{/if}
						{#if isErrorLevel(selectedLog.level) && selectedLog.id && organizationId}
							<div class="mt-3 pt-2 border-t">
								<Button
									variant="outline"
									size="sm"
									onclick={openExceptionDialog}
									class="gap-2"
								>
									<AlertTriangle class="w-4 h-4 text-red-500" />
									View Exception Details
								</Button>
							</div>
						{/if}
					</div>
				{/if}

				{#if contextLogs.after.length > 0}
					<div class="text-xs text-muted-foreground mt-4 mb-2">
						→ {contextLogs.after.length} log(s) after
					</div>
					{#each contextLogs.after as log}
						<div class="border rounded-lg p-3 hover:bg-accent/30 transition-colors opacity-70">
							<div class="flex items-center gap-3 flex-wrap mb-2">
								<span class="text-xs text-muted-foreground font-mono">
									{formatTime(log.time)}
								</span>
								<span class="text-xs font-medium">{log.service}</span>
								<span class="px-2 py-1 text-xs font-semibold rounded-full {getLevelColor(log.level)}">
									{log.level.toUpperCase()}
								</span>
								{#if log.traceId}
									<span class="px-2 py-1 text-xs font-mono bg-purple-100 text-purple-800 rounded">
										Trace: {log.traceId.substring(0, 8)}...
									</span>
								{/if}
							</div>
							<p class="text-xs mb-2">{log.message}</p>
							{#if log.metadata && Object.keys(log.metadata).length > 0}
								<details class="text-xs">
									<summary class="cursor-pointer text-muted-foreground hover:text-foreground">
										View metadata
									</summary>
									<pre class="mt-2 p-2 bg-muted rounded overflow-x-auto">{JSON.stringify(log.metadata, null, 2)}</pre>
								</details>
							{/if}
						</div>
					{/each}
				{/if}

				{#if contextLogs.before.length === 0 && contextLogs.after.length === 0}
					<div class="text-center py-6 text-muted-foreground text-sm">
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
		onClose={closeExceptionDialog}
	/>
{/if}
