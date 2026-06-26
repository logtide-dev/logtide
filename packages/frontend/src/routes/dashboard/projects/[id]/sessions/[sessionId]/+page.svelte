<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { sessionsAPI, type SessionEvent } from '$lib/api/sessions';
	import { toastStore } from '$lib/stores/toast';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import Spinner from '$lib/components/Spinner.svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Clock from '@lucide/svelte/icons/clock';
	import Layers from '@lucide/svelte/icons/layers';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
	import Globe from '@lucide/svelte/icons/globe';
	import Terminal from '@lucide/svelte/icons/terminal';
	import Navigation from '@lucide/svelte/icons/navigation';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import FileText from '@lucide/svelte/icons/file-text';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Filter from '@lucide/svelte/icons/filter';
	import Search from '@lucide/svelte/icons/search';

	const projectId = $derived(page.params.id);
	const sessionId = $derived(page.params.sessionId);

	let events = $state<SessionEvent[]>([]);
	let loading = $state(true);
	let error = $state('');
	let expandedItems = $state<Set<string>>(new Set());

	// Filters
	let typeFilter = $state<'all' | 'logs' | 'breadcrumbs'>('all');
	let levelFilter = $state<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
	let categoryFilter = $state<'all' | 'ui' | 'http' | 'navigation' | 'console' | 'error'>('all');
	let searchQuery = $state('');

	// Unified timeline item
	interface TimelineItem {
		id: string;
		time: number;
		type: 'log' | 'breadcrumb';
		level?: string;
		message: string;
		service?: string;
		metadata?: Record<string, unknown>;
		traceId?: string;
		breadcrumbType?: string;
		category?: string;
		data?: Record<string, unknown>;
	}

	const allTimelineItems = $derived.by(() => {
		const items: TimelineItem[] = [];

		for (const event of events) {
			items.push({
				id: event.id,
				time: new Date(event.time).getTime(),
				type: 'log',
				level: event.level,
				message: event.message,
				service: event.service,
				metadata: event.metadata,
				traceId: event.traceId,
			});

			const breadcrumbs = event.metadata?.breadcrumbs;
			if (Array.isArray(breadcrumbs)) {
				for (let i = 0; i < breadcrumbs.length; i++) {
					const bc = breadcrumbs[i] as {
						type?: string;
						category?: string;
						message?: string;
						level?: string;
						timestamp?: number;
						data?: Record<string, unknown>;
					};
					items.push({
						id: `${event.id}-bc-${i}`,
						time: bc.timestamp ?? new Date(event.time).getTime(),
						type: 'breadcrumb',
						message: bc.message ?? '',
						level: bc.level,
						breadcrumbType: bc.type,
						category: bc.category,
						data: bc.data,
					});
				}
			}
		}

		items.sort((a, b) => a.time - b.time);

		const seen = new Set<string>();
		return items.filter((item) => {
			if (item.type === 'log') return true;
			const key = `${item.time}-${item.message}-${item.breadcrumbType}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	});

	// Filtered timeline
	const timeline = $derived.by(() => {
		let items = allTimelineItems;

		if (typeFilter === 'logs') {
			items = items.filter((i) => i.type === 'log');
		} else if (typeFilter === 'breadcrumbs') {
			items = items.filter((i) => i.type === 'breadcrumb');
		}

		if (levelFilter !== 'all') {
			items = items.filter((i) => {
				if (i.type === 'log') return i.level === levelFilter;
				return i.level === levelFilter || !i.level;
			});
		}

		if (categoryFilter !== 'all') {
			items = items.filter((i) => {
				if (i.type === 'breadcrumb') return i.breadcrumbType === categoryFilter;
				return true;
			});
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			items = items.filter((i) => i.message.toLowerCase().includes(q));
		}

		return items;
	});

	// Counts for filter badges
	const logCount = $derived(allTimelineItems.filter((i) => i.type === 'log').length);
	const breadcrumbCount = $derived(allTimelineItems.filter((i) => i.type === 'breadcrumb').length);
	const errorCount = $derived(allTimelineItems.filter((i) => i.type === 'log' && (i.level === 'error' || i.level === 'critical')).length);
	const activeFilterCount = $derived(
		(typeFilter !== 'all' ? 1 : 0) +
		(levelFilter !== 'all' ? 1 : 0) +
		(categoryFilter !== 'all' ? 1 : 0) +
		(searchQuery.trim() ? 1 : 0)
	);

	// Session stats
	const sessionStats = $derived.by(() => {
		if (events.length === 0) return null;
		const times = events.map((e) => new Date(e.time).getTime());
		const first = Math.min(...times);
		const last = Math.max(...times);
		const errors = events.filter((e) => e.level === 'error' || e.level === 'critical').length;
		const services = [...new Set(events.map((e) => e.service))];
		return {
			firstEvent: new Date(first).toISOString(),
			lastEvent: new Date(last).toISOString(),
			durationMs: last - first,
			eventCount: events.length,
			errorCount: errors,
			services,
		};
	});

	async function loadEvents() {
		if (!projectId || !sessionId) return;
		loading = true;
		error = '';

		try {
			const result = await sessionsAPI.getSessionEvents({
				projectId,
				sessionId,
				limit: 1000,
			});
			events = result.events;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load session';
			toastStore.error(error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!browser || !projectId || !sessionId) return;
		loadEvents();
	});

	function toggleExpanded(id: string) {
		const next = new Set(expandedItems);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedItems = next;
	}

	function clearFilters() {
		typeFilter = 'all';
		levelFilter = 'all';
		categoryFilter = 'all';
		searchQuery = '';
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
		return `${(ms / 3_600_000).toFixed(1)}h`;
	}

	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		});
	}

	function formatTimestamp(ts: number): string {
		return new Date(ts).toLocaleTimeString('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			fractionalSecondDigits: 3,
		} as Intl.DateTimeFormatOptions);
	}

	function formatSessionId(id: string): string {
		if (id.length <= 16) return id;
		return `${id.slice(0, 8)}...${id.slice(-4)}`;
	}

	function getLevelColor(level?: string): string {
		switch (level) {
			case 'error':
			case 'critical':
				return 'border-l-red-400';
			case 'warn':
				return 'border-l-yellow-400';
			case 'debug':
				return 'border-l-gray-300';
			default:
				return 'border-l-blue-300';
		}
	}

	function getLevelBadgeVariant(level?: string): 'destructive' | 'secondary' | 'outline' | 'default' {
		switch (level) {
			case 'error':
			case 'critical':
				return 'destructive';
			case 'warn':
				return 'secondary';
			default:
				return 'outline';
		}
	}

	interface IconConfig {
		icon: typeof Globe;
		color: string;
		bg: string;
	}

	function getBreadcrumbIcon(type?: string): IconConfig {
		switch (type) {
			case 'ui':
				return { icon: MousePointerClick, color: 'text-violet-600', bg: 'bg-violet-500/10' };
			case 'http':
				return { icon: Globe, color: 'text-blue-600', bg: 'bg-blue-500/10' };
			case 'console':
				return { icon: Terminal, color: 'text-gray-600', bg: 'bg-gray-500/10' };
			case 'navigation':
				return { icon: Navigation, color: 'text-green-600', bg: 'bg-green-500/10' };
			case 'error':
				return { icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-500/10' };
			default:
				return { icon: Globe, color: 'text-gray-500', bg: 'bg-gray-500/10' };
		}
	}

	function getLogIcon(level?: string): IconConfig {
		switch (level) {
			case 'error':
			case 'critical':
				return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-500/10' };
			case 'warn':
				return { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-500/10' };
			default:
				return { icon: FileText, color: 'text-blue-600', bg: 'bg-blue-500/10' };
		}
	}

	function getExpandableData(item: TimelineItem): Record<string, unknown> | null {
		if (item.type === 'breadcrumb' && item.data && Object.keys(item.data).length > 0) {
			return item.data;
		}
		if (item.type === 'log' && item.metadata) {
			const { breadcrumbs, ...rest } = item.metadata;
			if (Object.keys(rest).length > 0) return rest;
		}
		return null;
	}
</script>

<svelte:head>
	<title>Session {formatSessionId(sessionId)} - LogTide</title>
</svelte:head>

<div class="space-y-5">
	<!-- Back link -->
	<Button
		variant="ghost"
		size="sm"
		class="-ml-2"
		onclick={() => goto(`/dashboard/projects/${projectId}/sessions`)}
	>
		<ArrowLeft class="w-4 h-4 mr-1.5" />
		Back to Sessions
	</Button>

	{#if loading}
		<div class="flex items-center justify-center py-20">
			<Spinner />
			<span class="ml-3 text-muted-foreground">Loading session...</span>
		</div>
	{:else if error}
		<div class="text-center py-20">
			<p class="text-destructive mb-4">{error}</p>
			<Button onclick={loadEvents}>Retry</Button>
		</div>
	{:else if events.length === 0}
		<div class="text-center py-20">
			<p class="text-muted-foreground">No events found for this session.</p>
		</div>
	{:else if sessionStats}
		<!-- Session header card -->
		<Card>
			<CardContent class="py-5 px-6">
				<div class="flex flex-wrap items-center gap-x-8 gap-y-3">
					<div>
						<p class="text-xs text-muted-foreground mb-1">Session ID</p>
						<code class="text-sm font-mono font-medium" title={sessionId}>{formatSessionId(sessionId)}</code>
					</div>
					<div>
						<p class="text-xs text-muted-foreground mb-1">Service</p>
						<div class="flex gap-1.5">
							{#each sessionStats.services as svc}
								<Badge variant="outline">{svc}</Badge>
							{/each}
						</div>
					</div>
					<div>
						<p class="text-xs text-muted-foreground mb-1">Started</p>
						<p class="text-sm font-medium">{formatTime(sessionStats.firstEvent)}</p>
					</div>
					<div>
						<div class="flex items-center gap-1.5 mb-1">
							<Clock class="w-3.5 h-3.5 text-muted-foreground" />
							<p class="text-xs text-muted-foreground">Duration</p>
						</div>
						<p class="text-sm font-medium">{formatDuration(sessionStats.durationMs)}</p>
					</div>
					<div>
						<div class="flex items-center gap-1.5 mb-1">
							<Layers class="w-3.5 h-3.5 text-muted-foreground" />
							<p class="text-xs text-muted-foreground">Events</p>
						</div>
						<p class="text-sm font-medium">{sessionStats.eventCount}</p>
					</div>
					{#if sessionStats.errorCount > 0}
						<div>
							<div class="flex items-center gap-1.5 mb-1">
								<AlertCircle class="w-3.5 h-3.5 text-red-500" />
								<p class="text-xs text-muted-foreground">Errors</p>
							</div>
							<p class="text-sm font-semibold text-red-500">{sessionStats.errorCount}</p>
						</div>
					{/if}
				</div>
			</CardContent>
		</Card>

		<!-- Filters bar -->
		<Card>
			<CardContent class="py-3 px-4">
				<div class="flex flex-wrap items-center gap-3">
					<Filter class="w-4 h-4 text-muted-foreground shrink-0" />

					<!-- Type filter -->
					<select
						class="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
						bind:value={typeFilter}
					>
						<option value="all">All types ({allTimelineItems.length})</option>
						<option value="logs">Logs ({logCount})</option>
						<option value="breadcrumbs">Breadcrumbs ({breadcrumbCount})</option>
					</select>

					<!-- Level filter -->
					<select
						class="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
						bind:value={levelFilter}
					>
						<option value="all">All levels</option>
						<option value="error">Error{errorCount > 0 ? ` (${errorCount})` : ''}</option>
						<option value="warn">Warning</option>
						<option value="info">Info</option>
						<option value="debug">Debug</option>
					</select>

					<!-- Category filter (breadcrumb type) -->
					{#if typeFilter !== 'logs'}
						<select
							class="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
							bind:value={categoryFilter}
						>
							<option value="all">All categories</option>
							<option value="ui">Click / UI</option>
							<option value="http">Network / HTTP</option>
							<option value="navigation">Navigation</option>
							<option value="console">Console</option>
							<option value="error">Error</option>
						</select>
					{/if}

					<!-- Search -->
					<div class="relative flex-1 min-w-[180px]">
						<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
						<input
							type="text"
							placeholder="Search events..."
							class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
							bind:value={searchQuery}
						/>
					</div>

					{#if activeFilterCount > 0}
						<Button variant="ghost" size="sm" class="text-xs h-8" onclick={clearFilters}>
							Clear filters
						</Button>
					{/if}

					<!-- Results count -->
					<span class="text-xs text-muted-foreground ml-auto shrink-0">
						{timeline.length} / {allTimelineItems.length} events
					</span>
				</div>
			</CardContent>
		</Card>

		<!-- Unified timeline -->
		{#if timeline.length === 0}
			<div class="text-center py-12">
				<p class="text-muted-foreground">No events match the current filters.</p>
				<Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}>Clear filters</Button>
			</div>
		{:else}
			<div class="relative">
				<!-- Timeline line -->
				<div class="absolute left-[17px] top-3 bottom-3 w-px bg-border"></div>

				<div class="space-y-1">
					{#each timeline as item (item.id)}
						{@const isLog = item.type === 'log'}
						{@const iconConfig = isLog ? getLogIcon(item.level) : getBreadcrumbIcon(item.breadcrumbType)}
						{@const expandable = getExpandableData(item)}
						{@const isExpanded = expandedItems.has(item.id)}

						{#if isLog}
							<!-- Log event - card -->
							<div class="relative pl-12 py-1">
								<div
									class="absolute left-0 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center {iconConfig.bg} z-10"
								>
									<iconConfig.icon class="w-4.5 h-4.5 {iconConfig.color}" />
								</div>

								<div
									class="rounded-lg border border-l-[3px] {getLevelColor(item.level)} p-4 hover:bg-muted/30 transition-colors {expandable ? 'cursor-pointer' : ''}"
									role={expandable ? 'button' : undefined}
									tabindex={expandable ? 0 : undefined}
									onclick={() => expandable && toggleExpanded(item.id)}
									onkeydown={(e) => e.key === 'Enter' && expandable && toggleExpanded(item.id)}
								>
									<div class="flex items-center gap-2.5 mb-1.5">
										<span class="text-xs font-mono text-muted-foreground">{formatTimestamp(item.time)}</span>
										<Badge variant={getLevelBadgeVariant(item.level)} class="text-xs">
											{item.level}
										</Badge>
										{#if item.service}
											<Badge variant="outline" class="text-xs">{item.service}</Badge>
										{/if}
										{#if expandable}
											{#if isExpanded}
												<ChevronDown class="w-4 h-4 text-muted-foreground ml-auto" />
											{:else}
												<ChevronRight class="w-4 h-4 text-muted-foreground ml-auto" />
											{/if}
										{/if}
									</div>
									<p class="text-sm leading-relaxed {item.level === 'error' || item.level === 'critical' ? 'text-red-600 font-medium' : ''}">
										{item.message}
									</p>

									{#if expandable && isExpanded}
										<pre class="mt-3 p-3 bg-muted rounded-md text-xs leading-relaxed overflow-x-auto max-h-72">{JSON.stringify(expandable, null, 2)}</pre>
									{/if}
								</div>
							</div>
						{:else}
							<!-- Breadcrumb - compact row -->
							<div class="relative pl-12 py-0.5">
								<div
									class="absolute left-[7px] top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center {iconConfig.bg} z-10"
								>
									<iconConfig.icon class="w-3.5 h-3.5 {iconConfig.color}" />
								</div>

								<div
									class="flex items-center gap-2.5 py-1.5 px-3 rounded-md hover:bg-muted/30 transition-colors text-muted-foreground {expandable ? 'cursor-pointer' : ''}"
									role={expandable ? 'button' : undefined}
									tabindex={expandable ? 0 : undefined}
									onclick={() => expandable && toggleExpanded(item.id)}
									onkeydown={(e) => e.key === 'Enter' && expandable && toggleExpanded(item.id)}
								>
									<span class="text-xs font-mono shrink-0">{formatTimestamp(item.time)}</span>
									{#if item.category}
										<span class="text-[11px] font-medium uppercase tracking-wider opacity-60 shrink-0">{item.category}</span>
									{/if}
									<span class="text-sm truncate">{item.message}</span>
									{#if expandable}
										{#if isExpanded}
											<ChevronDown class="w-3.5 h-3.5 shrink-0 ml-auto" />
										{:else}
											<ChevronRight class="w-3.5 h-3.5 shrink-0 ml-auto" />
										{/if}
									{/if}
								</div>

								{#if expandable && isExpanded}
									<pre class="ml-3 mt-1.5 p-3 bg-muted rounded-md text-xs leading-relaxed overflow-x-auto max-h-56">{JSON.stringify(expandable, null, 2)}</pre>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>
