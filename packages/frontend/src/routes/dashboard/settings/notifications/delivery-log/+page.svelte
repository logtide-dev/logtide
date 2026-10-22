<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { organizationStore } from '$lib/stores/organization';
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import { webhookDeliveriesStore } from '$lib/stores/webhook-deliveries';
	import { toastStore } from '$lib/stores/toast';
	import { stateTone } from '$lib/utils/severity';
	import Button from '$lib/components/ui/button/button.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import DataTable from '$lib/components/app/DataTable.svelte';
	import Pagination from '$lib/components/app/Pagination.svelte';
	import Timestamp from '$lib/components/app/Timestamp.svelte';
	import type { DataTableColumn } from '$lib/components/app/data-table';
	import type {
		OrganizationWithRole,
		WebhookDelivery,
		WebhookDeliveryStatus,
	} from '@logtide/shared';
	import { canManageMembers } from '@logtide/shared';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const STATUS_OPTIONS: { value: WebhookDeliveryStatus | ''; label: string }[] = [
		{ value: '', label: 'All' },
		{ value: 'pending', label: 'Pending' },
		{ value: 'delivered', label: 'Delivered' },
		{ value: 'failed', label: 'Retrying' },
		{ value: 'dead', label: 'Dead letter' },
	];

	// A failed row still has a retry queued, so it reads as retrying, not as an error.
	const STATUS_VIEW: Record<WebhookDeliveryStatus, { label: string; tone: string }> = {
		pending: { label: 'Pending', tone: 'pending' },
		delivered: { label: 'Delivered', tone: 'ok' },
		failed: { label: 'Retrying', tone: 'pending' },
		dead: { label: 'Dead letter', tone: 'failed' },
	};

	let token: string | null = null;
	let currentOrg = $state<OrganizationWithRole | null>(null);
	let lastLoadedOrgId = $state<string | null>(null);

	let storeState = $state({
		deliveries: [] as WebhookDelivery[],
		loading: false,
		error: null as string | null,
		statusFilter: '' as WebhookDeliveryStatus | '',
		page: 1,
		pageSize: 50,
		hasMore: false,
	});
	let channelNames = $state<Record<string, string>>({});
	let statusFilter = $state<WebhookDeliveryStatus | ''>('');
	let replayingId = $state<string | null>(null);

	const unsubAuthStore = authStore.subscribe((state) => {
		token = state.token;
	});
	const unsubOrgStore = organizationStore.subscribe((state) => {
		currentOrg = state.currentOrganization;
	});
	const unsubDeliveries = webhookDeliveriesStore.subscribe((state) => {
		storeState = state;
	});
	const unsubChannels = notificationChannelsStore.subscribe((state) => {
		channelNames = Object.fromEntries(state.channels.map((c) => [c.id, c.name]));
	});

	onDestroy(() => {
		unsubAuthStore();
		unsubOrgStore();
		unsubDeliveries();
		unsubChannels();
	});

	onMount(() => {
		if (!token) {
			goto('/login');
		}
	});

	let canManage = $derived(currentOrg ? canManageMembers(currentOrg.role) : false);

	$effect(() => {
		if (browser && currentOrg && currentOrg.id !== lastLoadedOrgId) {
			lastLoadedOrgId = currentOrg.id;
			void webhookDeliveriesStore.load(currentOrg.id);
			void notificationChannelsStore.load(currentOrg.id);
		}
	});

	function reload() {
		if (!currentOrg) return;
		void webhookDeliveriesStore.load(currentOrg.id, statusFilter || undefined, storeState.page);
	}

	function onStatusChange() {
		if (!currentOrg) return;
		void webhookDeliveriesStore.load(currentOrg.id, statusFilter || undefined, 1);
	}

	function onPageChange(page: number) {
		if (!currentOrg) return;
		void webhookDeliveriesStore.setPage(currentOrg.id, page);
	}

	async function handleReplay(delivery: WebhookDelivery) {
		if (!currentOrg || replayingId) return;
		replayingId = delivery.id;
		try {
			await webhookDeliveriesStore.replay(currentOrg.id, delivery.id);
			toastStore.success('Delivery queued for retry');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not retry the delivery');
		} finally {
			replayingId = null;
		}
	}

	// Webhook URLs embed Slack and Discord tokens, so only the host is ever shown.
	function hostOf(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return 'Unknown host';
		}
	}

	function destinationName(delivery: WebhookDelivery): string | null {
		const id = (delivery.metadata as Record<string, unknown> | null)?.channelId;
		return typeof id === 'string' ? (channelNames[id] ?? null) : null;
	}

	const asCell = (cell: unknown) => cell as Snippet<[WebhookDelivery]>;

	const columns: DataTableColumn<WebhookDelivery>[] = [
		{ key: 'event', header: 'Event', cell: asCell(eventCell) },
		{ key: 'destination', header: 'Destination', cell: asCell(destinationCell) },
		{ key: 'status', header: 'Status', cell: asCell(statusCell) },
		{ key: 'attempts', header: 'Attempts', cell: asCell(attemptsCell) },
		{ key: 'created', header: 'Created', cell: asCell(createdCell) },
		{ key: 'actions', header: '', class: 'text-right', cell: asCell(actionsCell) },
	];

	// Total is only known as far as the next page, which is all Pagination needs.
	let total = $derived(
		(storeState.page - 1) * storeState.pageSize +
			storeState.deliveries.length +
			(storeState.hasMore ? 1 : 0)
	);
</script>

{#snippet eventCell(d: WebhookDelivery)}
	<span class="font-mono text-xs">{d.eventType}</span>
{/snippet}

{#snippet destinationCell(d: WebhookDelivery)}
	{@const name = destinationName(d)}
	<div class="min-w-0">
		{#if name}<div class="truncate text-sm font-medium">{name}</div>{/if}
		<div class="truncate font-mono text-xs text-muted-foreground">{hostOf(d.url)}</div>
		{#if d.lastError && d.status !== 'delivered'}
			<div class="mt-0.5 max-w-xs truncate text-xs text-destructive-text" title={d.lastError}>
				{d.lastError}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet statusCell(d: WebhookDelivery)}
	{@const view = STATUS_VIEW[d.status] ?? { label: d.status, tone: d.status }}
	<span
		class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {stateTone(view.tone).badge}"
	>
		{view.label}
	</span>
{/snippet}

{#snippet attemptsCell(d: WebhookDelivery)}
	<span class="tabular-nums">{d.attemptCount.toLocaleString('en-US')}/{d.maxAttempts.toLocaleString('en-US')}</span>
{/snippet}

{#snippet createdCell(d: WebhookDelivery)}
	<span class="text-sm text-muted-foreground"><Timestamp value={d.createdAt} precision="second" /></span>
{/snippet}

{#snippet actionsCell(d: WebhookDelivery)}
	{#if d.status === 'dead' && canManage}
		<Button
			variant="outline"
			size="sm"
			disabled={replayingId === d.id}
			onclick={() => handleReplay(d)}
		>
			<RotateCcw class="mr-1 h-3.5 w-3.5" aria-hidden="true" />
			Retry
		</Button>
	{/if}
{/snippet}

<svelte:head>
	<title>Delivery log - LogTide</title>
</svelte:head>

<div class="space-y-6">
	<PageHeader
		title="Delivery log"
		description="Every outbound notification and webhook LogTide sent, with retries."
		appliesTo="organization"
	>
		{#snippet actions()}
			<div class="flex items-center gap-2">
				<select
					aria-label="Filter by status"
					class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					bind:value={statusFilter}
					onchange={onStatusChange}
				>
					{#each STATUS_OPTIONS as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<Button variant="outline" size="sm" onclick={reload}>
					<RotateCcw class="mr-1 h-4 w-4" aria-hidden="true" />
					Refresh
				</Button>
			</div>
		{/snippet}
	</PageHeader>

	{#if storeState.error && storeState.deliveries.length === 0 && !storeState.loading}
		<EmptyState variant="error" title="Could not load the delivery log" description={storeState.error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={reload}>Retry</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<DataTable
			{columns}
			rows={storeState.deliveries}
			rowKey={(d) => d.id}
			loading={storeState.loading}
		>
			{#snippet empty()}
				<EmptyState
					variant="no-results"
					title="No deliveries yet"
					description="Notifications and webhooks LogTide sends will show up here."
				/>
			{/snippet}
		</DataTable>
		<Pagination
			page={storeState.page}
			pageSize={storeState.pageSize}
			{total}
			{onPageChange}
		/>
	{/if}
</div>
