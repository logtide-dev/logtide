<script lang="ts">
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import { organizationStore } from '$lib/stores/organization';
	import { toastStore } from '$lib/stores/toast';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator,
		DropdownMenuTrigger,
	} from '$lib/components/ui/dropdown-menu';
	import DataTable from '$lib/components/app/DataTable.svelte';
	import EmptyState from '$lib/components/app/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
	import type { DataTableColumn } from '$lib/components/app/data-table';
	import CreateChannelDialog from './CreateChannelDialog.svelte';
	import DestinationTypeIcon from './DestinationTypeIcon.svelte';
	import { destinationLabel, displayTypeOf } from './destination-types';
	import Spinner from '$lib/components/Spinner.svelte';
	import type { NotificationChannel } from '$lib/api/notification-channels';
	import type { Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TestTube from '@lucide/svelte/icons/test-tube';

	interface Props {
		/** Admins and owners can change destinations; everyone else sees a read-only list. */
		canManage?: boolean;
		/** Bound by the page so its header button can open the create dialog. */
		createOpen?: boolean;
	}

	let { canManage = true, createOpen = $bindable(false) }: Props = $props();

	let currentOrg = $derived($organizationStore.currentOrganization);
	let channels = $derived($notificationChannelsStore.channels);
	let loading = $derived($notificationChannelsStore.loading);
	let loadError = $derived($notificationChannelsStore.error);

	// Load destinations when org changes
	$effect(() => {
		if (currentOrg?.id) {
			notificationChannelsStore.load(currentOrg.id);
		}
	});

	let editingChannel = $state<NotificationChannel | null>(null);
	let deleteOpen = $state(false);
	let channelToDelete = $state<NotificationChannel | null>(null);
	let testingId = $state<string | null>(null);

	$effect(() => {
		if (!deleteOpen) channelToDelete = null;
	});

	async function handleToggleEnabled(channel: NotificationChannel) {
		if (!currentOrg) return;

		try {
			await notificationChannelsStore.update(channel.id, currentOrg.id, {
				enabled: !channel.enabled,
			});
			toastStore.success(`Destination ${channel.enabled ? 'disabled' : 'enabled'}`);
		} catch (err) {
			toastStore.error(err instanceof Error ? err.message : 'Failed to update destination');
		}
	}

	async function handleTest(channel: NotificationChannel) {
		if (!currentOrg) return;

		testingId = channel.id;
		try {
			const result = await notificationChannelsStore.test(channel.id, currentOrg.id);
			if (result.success) {
				toastStore.success('Test notification sent');
			} else {
				toastStore.error(result.error || 'Test failed');
			}
		} catch (err) {
			toastStore.error(err instanceof Error ? err.message : 'Test failed');
		} finally {
			testingId = null;
		}
	}

	async function handleDelete() {
		if (!currentOrg || !channelToDelete) return;

		try {
			await notificationChannelsStore.delete(channelToDelete.id, currentOrg.id);
			toastStore.success('Destination deleted');
		} catch (err) {
			toastStore.error(err instanceof Error ? err.message : 'Failed to delete destination');
			throw err;
		}
	}

	function getTargetSummary(channel: NotificationChannel): string {
		if (channel.type === 'email') {
			const config = channel.config as { recipients?: string[] };
			const count = config.recipients?.length ?? 0;
			return `${count.toLocaleString('en-US')} recipient${count !== 1 ? 's' : ''}`;
		}
		if (channel.type === 'pagerduty') {
			return 'Routing key set';
		}
		const config = channel.config as { url?: string };
		try {
			return new URL(config.url ?? '').hostname;
		} catch {
			return config.url ?? '';
		}
	}

	// Top-level snippets are typed as plain functions; DataTable wants branded Snippets.
	const asCell = (cell: unknown) => cell as Snippet<[NotificationChannel]>;

	const baseColumns: DataTableColumn<NotificationChannel>[] = [
		{ key: 'name', header: 'Name', class: 'min-w-[9rem]', cell: asCell(nameCell) },
		{ key: 'type', header: 'Type', cell: asCell(typeCell) },
		{ key: 'target', header: 'Target', class: 'hidden md:table-cell', cell: asCell(targetCell) },
		{ key: 'enabled', header: 'Enabled', class: 'w-[90px]', cell: asCell(enabledCell) },
	];
	const actionColumn: DataTableColumn<NotificationChannel> = {
		key: 'actions',
		header: 'Actions',
		class: 'w-[70px]',
		cell: asCell(actionsCell),
	};
	const columns = $derived(canManage ? [...baseColumns, actionColumn] : baseColumns);
</script>

{#snippet nameCell(channel: NotificationChannel)}
	<div class="min-w-0">
		<div class="font-medium">{channel.name}</div>
		{#if channel.description}
			<div class="text-sm text-muted-foreground">{channel.description}</div>
		{/if}
	</div>
{/snippet}

{#snippet typeCell(channel: NotificationChannel)}
	<div class="flex items-center gap-2">
		<DestinationTypeIcon type={displayTypeOf(channel)} />
		<span class="text-sm">{destinationLabel(channel)}</span>
	</div>
{/snippet}

{#snippet targetCell(channel: NotificationChannel)}
	<span class="text-sm text-muted-foreground">{getTargetSummary(channel)}</span>
{/snippet}

{#snippet enabledCell(channel: NotificationChannel)}
	<Switch
		checked={channel.enabled}
		disabled={!canManage}
		aria-label={`Enable ${channel.name}`}
		onCheckedChange={() => handleToggleEnabled(channel)}
	/>
{/snippet}

{#snippet actionsCell(channel: NotificationChannel)}
	<DropdownMenu>
		<DropdownMenuTrigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class="h-8 w-8"
					aria-label={`Actions for ${channel.name}`}
				>
					<MoreHorizontal class="h-4 w-4" aria-hidden="true" />
				</Button>
			{/snippet}
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end">
			<DropdownMenuItem onclick={() => (editingChannel = channel)}>
				<Pencil class="mr-2 h-4 w-4" aria-hidden="true" />
				Edit
			</DropdownMenuItem>
			<DropdownMenuItem onclick={() => handleTest(channel)} disabled={testingId === channel.id}>
				{#if testingId === channel.id}
					<Spinner size="sm" className="mr-2" />
				{:else}
					<TestTube class="mr-2 h-4 w-4" aria-hidden="true" />
				{/if}
				Test
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				onclick={() => {
					channelToDelete = channel;
					deleteOpen = true;
				}}
				class="text-destructive focus:text-destructive"
			>
				<Trash2 class="mr-2 h-4 w-4" aria-hidden="true" />
				Delete
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
{/snippet}

<div class="space-y-4">
	{#if !canManage}
		<p class="text-sm text-muted-foreground">
			Only organization admins and owners can change destinations.
		</p>
	{/if}

	{#if loadError && !loading && channels.length === 0}
		<EmptyState variant="error" title="Could not load destinations" description={loadError}>
			{#snippet actions()}
				<Button variant="outline" onclick={() => currentOrg && notificationChannelsStore.load(currentOrg.id)}>
					Retry
				</Button>
			{/snippet}
		</EmptyState>
	{:else if !loading && channels.length === 0}
		<EmptyState
			variant="no-data"
			title="No destinations yet"
			description="Add an email, webhook, Slack, Microsoft Teams, Discord or PagerDuty destination to get notified."
		>
			{#snippet actions()}
				{#if canManage}
					<Button onclick={() => (createOpen = true)} class="gap-2">
						<Plus class="h-4 w-4" aria-hidden="true" />
						Add destination
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<div class="rounded-md border">
			<DataTable {columns} rows={channels} rowKey={(c: NotificationChannel) => c.id} {loading} />
		</div>
	{/if}
</div>

{#if canManage}
	<CreateChannelDialog
		bind:open={createOpen}
		onSuccess={() => {
			createOpen = false;
		}}
	/>

	<CreateChannelDialog
		open={!!editingChannel}
		channel={editingChannel}
		onOpenChange={(open) => {
			if (!open) editingChannel = null;
		}}
		onSuccess={() => {
			editingChannel = null;
		}}
	/>

	<ConfirmDialog
		bind:open={deleteOpen}
		title="Delete destination?"
		description={`Rules that use ${channelToDelete?.name ?? 'this destination'} stop notifying it and fall back to the routing defaults.`}
		confirmLabel="Delete destination"
		onConfirm={handleDelete}
	/>
{/if}
