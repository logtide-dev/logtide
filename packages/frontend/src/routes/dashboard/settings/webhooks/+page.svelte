<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { organizationStore } from '$lib/stores/organization';
	import { webhookDeliveriesStore } from '$lib/stores/webhook-deliveries';
	import type { WebhookDelivery, WebhookDeliveryStatus } from '@logtide/shared';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle,
		CardDescription,
	} from '$lib/components/ui/card';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow,
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import Spinner from '$lib/components/Spinner.svelte';
	import type { OrganizationWithRole } from '@logtide/shared';
	import Send from '@lucide/svelte/icons/send';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	const STATUS_OPTIONS: { value: WebhookDeliveryStatus | ''; label: string }[] = [
		{ value: '', label: 'All' },
		{ value: 'pending', label: 'Pending' },
		{ value: 'delivered', label: 'Delivered' },
		{ value: 'failed', label: 'Failed (Retrying)' },
		{ value: 'dead', label: 'Dead (DLQ)' },
	];

	const STATUS_COLORS: Record<WebhookDeliveryStatus, string> = {
		pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
		delivered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
		failed: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
		dead: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
	};

	let token: string | null = null;
	let currentOrg = $state<OrganizationWithRole | null>(null);
	let lastLoadedOrgId = $state<string | null>(null);

	let storeState = $state({
		deliveries: [] as WebhookDelivery[],
		loading: false,
		error: null as string | null,
		statusFilter: '' as WebhookDeliveryStatus | '',
	});

	let replayingId = $state<string | null>(null);
	let replayError = $state('');

	const unsubAuthStore = authStore.subscribe((state) => {
		token = state.token;
	});

	const unsubOrgStore = organizationStore.subscribe((state) => {
		currentOrg = state.currentOrganization;
	});

	const unsubDeliveries = webhookDeliveriesStore.subscribe((state) => {
		storeState = state;
	});

	onDestroy(() => {
		unsubAuthStore();
		unsubOrgStore();
		unsubDeliveries();
	});

	onMount(() => {
		if (!token) {
			goto('/login');
		}
	});

	$effect(() => {
		if (browser && currentOrg && currentOrg.id !== lastLoadedOrgId) {
			lastLoadedOrgId = currentOrg.id;
			void webhookDeliveriesStore.load(currentOrg.id);
		}
	});

	function applyStatusFilter() {
		if (!currentOrg) return;
		const status = storeState.statusFilter || undefined;
		void webhookDeliveriesStore.load(currentOrg.id, status);
	}

	async function handleReplay(delivery: WebhookDelivery) {
		if (!currentOrg || replayingId) return;
		replayingId = delivery.id;
		replayError = '';
		try {
			await webhookDeliveriesStore.replay(currentOrg.id, delivery.id);
		} catch (e) {
			replayError = e instanceof Error ? e.message : 'Failed to replay delivery';
		} finally {
			replayingId = null;
		}
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString('en-US');
	}

	function truncateUrl(url: string, max = 48): string {
		return url.length > max ? url.slice(0, max) + '…' : url;
	}

	let statusFilter = $state<WebhookDeliveryStatus | ''>('');

	function onStatusChange() {
		storeState = { ...storeState, statusFilter };
		if (!currentOrg) return;
		void webhookDeliveriesStore.load(currentOrg.id, statusFilter || undefined);
	}
</script>

<svelte:head>
	<title>Webhook Deliveries - LogTide</title>
</svelte:head>

<div class="space-y-6">
	<!-- Filters -->
	<Card>
		<CardHeader class="pb-3">
			<div class="flex items-center justify-between">
				<div>
					<CardTitle class="text-base">Webhook Deliveries</CardTitle>
					<CardDescription class="mt-1">
						Outbound webhook dispatch history for your organization
					</CardDescription>
				</div>
				<Button
					variant="outline"
					size="sm"
					onclick={() => currentOrg && void webhookDeliveriesStore.load(currentOrg.id, statusFilter || undefined)}
				>
					<RotateCcw class="h-4 w-4 mr-1" />
					Refresh
				</Button>
			</div>
		</CardHeader>
		<CardContent>
			<div class="flex items-end gap-3">
				<div class="space-y-1">
					<label for="status-filter" class="text-xs font-medium text-muted-foreground">
						Status
					</label>
					<select
						id="status-filter"
						bind:value={statusFilter}
						onchange={onStatusChange}
						class="flex h-9 w-52 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						{#each STATUS_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
			</div>
		</CardContent>
	</Card>

	<!-- Table -->
	<Card>
		<CardContent class="p-0">
			{#if storeState.loading}
				<div class="flex justify-center py-12">
					<Spinner />
				</div>
			{:else if storeState.error}
				<p class="py-8 text-center text-sm text-destructive">{storeState.error}</p>
			{:else if storeState.deliveries.length === 0}
				<div class="py-12 text-center">
					<Send class="mx-auto h-10 w-10 text-muted-foreground/40" />
					<p class="mt-3 text-sm text-muted-foreground">No webhook deliveries found.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Event Type</TableHead>
								<TableHead>URL</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Attempts</TableHead>
								<TableHead>Created</TableHead>
								<TableHead class="w-[80px]"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each storeState.deliveries as delivery (delivery.id)}
								<TableRow>
									<TableCell class="font-mono text-sm">{delivery.eventType}</TableCell>
									<TableCell class="text-sm text-muted-foreground" title={delivery.url}>
										{truncateUrl(delivery.url)}
									</TableCell>
									<TableCell>
										<span
											class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {STATUS_COLORS[delivery.status]}"
										>
											{delivery.status}
										</span>
									</TableCell>
									<TableCell class="text-sm">
										{delivery.attemptCount}/{delivery.maxAttempts}
									</TableCell>
									<TableCell class="whitespace-nowrap text-xs text-muted-foreground">
										{formatDate(delivery.createdAt)}
									</TableCell>
									<TableCell>
										{#if delivery.status === 'failed' || delivery.status === 'dead'}
											<Button
												variant="outline"
												size="sm"
												disabled={replayingId === delivery.id}
												onclick={() => handleReplay(delivery)}
											>
												{#if replayingId === delivery.id}
													<Spinner />
												{:else}
													Retry
												{/if}
											</Button>
										{/if}
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				</div>
				{#if replayError}
					<p class="px-6 py-3 text-sm text-destructive">{replayError}</p>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
