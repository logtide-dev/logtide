<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { sessionsAPI, type SessionSummary } from '$lib/api/sessions';
	import { toastStore } from '$lib/stores/toast';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import Spinner from '$lib/components/Spinner.svelte';
	import Monitor from '@lucide/svelte/icons/monitor';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Clock from '@lucide/svelte/icons/clock';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Layers from '@lucide/svelte/icons/layers';

	const projectId = $derived(page.params.id);

	let sessions = $state<SessionSummary[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let error = $state('');
	let refreshing = $state(false);
	let lastLoadedKey = $state<string | null>(null);

	// Filters
	let hasErrorsFilter = $state<'all' | 'true' | 'false'>('all');
	let serviceFilter = $state('');

	// Pagination
	let currentPage = $state(1);
	let pageSize = $state(20);
	let totalPages = $derived(total > 0 ? Math.ceil(total / pageSize) : 0);
	let hasMore = $derived(currentPage * pageSize < total);

	async function loadSessions() {
		if (!projectId) return;
		loading = true;
		error = '';

		try {
			const result = await sessionsAPI.listSessions({
				projectId,
				hasErrors: hasErrorsFilter === 'all' ? undefined : hasErrorsFilter === 'true',
				service: serviceFilter || undefined,
				limit: pageSize,
				offset: (currentPage - 1) * pageSize,
			});

			sessions = result.sessions;
			total = result.total;
			lastLoadedKey = projectId;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load sessions';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser || !projectId) return;
		if (projectId === lastLoadedKey) return;
		loadSessions();
	});

	async function handleRefresh() {
		refreshing = true;
		await loadSessions();
		refreshing = false;
	}

	function handleFilterChange() {
		currentPage = 1;
		lastLoadedKey = null;
		loadSessions();
	}

	function handlePreviousPage() {
		if (currentPage > 1) {
			currentPage--;
			loadSessions();
		}
	}

	function handleNextPage() {
		if (hasMore) {
			currentPage++;
			loadSessions();
		}
	}

	function handleSessionClick(session: SessionSummary) {
		goto(`/dashboard/projects/${projectId}/sessions/${session.sessionId}`);
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
		return `${(ms / 3_600_000).toFixed(1)}h`;
	}

	function formatTimestamp(iso: string) {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		});
	}

	function formatSessionId(id: string): string {
		if (id.length <= 12) return id;
		return `${id.slice(0, 8)}...${id.slice(-4)}`;
	}
</script>

<svelte:head>
	<title>Sessions - LogTide</title>
</svelte:head>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Monitor class="w-5 h-5 text-muted-foreground" />
			<h2 class="text-lg font-semibold">Sessions</h2>
			{#if total > 0}
				<Badge variant="secondary" class="text-xs">{total}</Badge>
			{/if}
		</div>
		<Button variant="outline" size="sm" onclick={handleRefresh} disabled={refreshing || loading}>
			<RefreshCw class="w-4 h-4 mr-1.5 {refreshing ? 'animate-spin' : ''}" />
			Refresh
		</Button>
	</div>

	<!-- Filters -->
	<div class="flex items-center gap-3">
		<select
			class="h-9 rounded-md border border-input bg-background px-3 text-sm"
			bind:value={hasErrorsFilter}
			onchange={handleFilterChange}
		>
			<option value="all">All sessions</option>
			<option value="true">With errors</option>
			<option value="false">Clean only</option>
		</select>
		<input
			type="text"
			placeholder="Filter by service..."
			class="h-9 rounded-md border border-input bg-background px-3 text-sm w-48"
			bind:value={serviceFilter}
			onkeydown={(e) => e.key === 'Enter' && handleFilterChange()}
			onblur={handleFilterChange}
		/>
	</div>

	<!-- Content -->
	{#if loading && sessions.length === 0}
		<div class="flex items-center justify-center py-16">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading sessions...</span>
		</div>
	{:else if error}
		<div class="text-center py-16">
			<p class="text-destructive mb-4">{error}</p>
			<Button onclick={loadSessions}>Retry</Button>
		</div>
	{:else if sessions.length === 0}
		<div class="text-center py-16">
			<Monitor class="w-10 h-10 text-muted-foreground mx-auto mb-3" />
			<p class="text-muted-foreground mb-1">No sessions found</p>
			<p class="text-sm text-muted-foreground max-w-sm mx-auto">
				Sessions are automatically tracked when using the <code class="text-xs bg-muted px-1 py-0.5 rounded">@logtide/browser</code> SDK.
			</p>
		</div>
	{:else}
		<!-- Sessions table -->
		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b bg-muted/50">
						<th class="text-left font-medium text-muted-foreground px-4 py-2.5">Session</th>
						<th class="text-left font-medium text-muted-foreground px-4 py-2.5">Service</th>
						<th class="text-left font-medium text-muted-foreground px-4 py-2.5">Started</th>
						<th class="text-right font-medium text-muted-foreground px-4 py-2.5">Duration</th>
						<th class="text-right font-medium text-muted-foreground px-4 py-2.5">Events</th>
						<th class="text-right font-medium text-muted-foreground px-4 py-2.5">Errors</th>
					</tr>
				</thead>
				<tbody>
					{#each sessions as session (session.sessionId)}
						<tr
							class="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
							onclick={() => handleSessionClick(session)}
						>
							<td class="px-4 py-3">
								<div class="flex items-center gap-2">
									<code class="text-xs font-mono text-foreground" title={session.sessionId}>
										{formatSessionId(session.sessionId)}
									</code>
									{#if session.errorCount > 0}
										<Badge variant="destructive" class="text-[10px] px-1.5 py-0">
											{session.errorCount} err
										</Badge>
									{/if}
								</div>
							</td>
							<td class="px-4 py-3">
								<Badge variant="outline" class="text-xs">{session.service}</Badge>
							</td>
							<td class="px-4 py-3 text-muted-foreground text-xs">
								{formatTime(session.firstEvent)}
							</td>
							<td class="px-4 py-3 text-right">
								<div class="flex items-center justify-end gap-1 text-muted-foreground">
									<Clock class="w-3 h-3" />
									<span class="text-xs">{formatDuration(session.durationMs)}</span>
								</div>
							</td>
							<td class="px-4 py-3 text-right">
								<div class="flex items-center justify-end gap-1 text-muted-foreground">
									<Layers class="w-3 h-3" />
									<span class="text-xs">{session.eventCount}</span>
								</div>
							</td>
							<td class="px-4 py-3 text-right">
								{#if session.errorCount > 0}
									<div class="flex items-center justify-end gap-1 text-red-500">
										<AlertCircle class="w-3 h-3" />
										<span class="text-xs font-medium">{session.errorCount}</span>
									</div>
								{:else}
									<span class="text-xs text-muted-foreground">0</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between">
				<p class="text-sm text-muted-foreground">
					Page {currentPage} of {totalPages}
				</p>
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" onclick={handlePreviousPage} disabled={currentPage === 1 || loading}>
						<ChevronLeft class="w-4 h-4 mr-1" />
						Previous
					</Button>
					<Button variant="outline" size="sm" onclick={handleNextPage} disabled={!hasMore || loading}>
						Next
						<ChevronRight class="w-4 h-4 ml-1" />
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
