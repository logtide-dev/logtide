<script lang="ts">
	import { notificationChannelsStore } from '$lib/stores/notification-channels';
	import { organizationStore } from '$lib/stores/organization';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Popover from '$lib/components/ui/popover';
	import CreateChannelDialog from './CreateChannelDialog.svelte';
	import type { NotificationChannel } from '$lib/api/notification-channels';
	import DestinationTypeIcon from './DestinationTypeIcon.svelte';
	import { displayTypeOf, destinationLabel } from './destination-types';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		selectedIds: string[];
		onSelectionChange: (ids: string[]) => void;
		disabled?: boolean;
		showCreateButton?: boolean;
		placeholder?: string;
	}

	let {
		selectedIds = [],
		onSelectionChange,
		disabled = false,
		showCreateButton = true,
		placeholder = 'Select destinations...',
	}: Props = $props();

	let popoverOpen = $state(false);
	let createDialogOpen = $state(false);
	let channels = $state<NotificationChannel[]>([]);
	let loading = $state(false);

	let currentOrg = $state<{ id: string } | null>(null);
	organizationStore.subscribe((state) => {
		currentOrg = state.currentOrganization;
	});

	notificationChannelsStore.subscribe((state) => {
		channels = state.channels;
		loading = state.loading;
	});

	// Load channels when org changes
	$effect(() => {
		if (currentOrg?.id) {
			notificationChannelsStore.load(currentOrg.id);
		}
	});

	const selectedChannels = $derived(channels.filter((ch) => selectedIds.includes(ch.id)));

	const enabledChannels = $derived(channels.filter((ch) => ch.enabled));

	function toggleChannel(channelId: string) {
		if (selectedIds.includes(channelId)) {
			onSelectionChange(selectedIds.filter((id) => id !== channelId));
		} else {
			onSelectionChange([...selectedIds, channelId]);
		}
	}

	function removeChannel(channelId: string) {
		onSelectionChange(selectedIds.filter((id) => id !== channelId));
	}

	function handleChannelCreated(channel: NotificationChannel) {
		// Auto-select newly created channel
		onSelectionChange([...selectedIds, channel.id]);
	}

</script>

<div class="space-y-2">
	<!-- Selected channels badges -->
	{#if selectedChannels.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each selectedChannels as channel}
				<Badge variant="secondary" class="gap-1 pr-1">
					<DestinationTypeIcon type={displayTypeOf(channel)} class="!size-5" />
					{channel.name}
					<button
						type="button"
						class="ml-1 hover:bg-muted rounded-full p-0.5"
						onclick={() => removeChannel(channel.id)}
						aria-label={`Remove ${channel.name}`}
						{disabled}
					>
						<X class="h-3 w-3" aria-hidden="true" />
					</button>
				</Badge>
			{/each}
		</div>
	{/if}

	<!-- Selector popover -->
	<div class="flex gap-2">
		<Popover.Root bind:open={popoverOpen}>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						type="button"
						variant="outline"
						class="justify-between w-full"
						{disabled}
					>
						<span class="text-muted-foreground">
							{selectedChannels.length > 0
								? `${selectedChannels.length} destination${selectedChannels.length > 1 ? 's' : ''} selected`
								: placeholder}
						</span>
						<ChevronDown class="h-4 w-4 opacity-50" />
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-[300px] p-0" align="start">
				<div class="max-h-[300px] overflow-y-auto">
					{#if loading}
						<div class="p-4 text-center text-sm text-muted-foreground">Loading destinations...</div>
					{:else if enabledChannels.length === 0}
						<div class="p-4 text-center">
							<p class="text-sm text-muted-foreground mb-2">No destinations yet</p>
							{#if showCreateButton}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => {
										popoverOpen = false;
										createDialogOpen = true;
									}}
									class="gap-1"
								>
									<Plus class="h-3 w-3" />
									Create destination
								</Button>
							{/if}
						</div>
					{:else}
						<div class="p-1">
							{#each enabledChannels as channel}
									{@const isSelected = selectedIds.includes(channel.id)}
								<button
									type="button"
									class="flex items-center gap-3 w-full px-2 py-2 rounded-md hover:bg-muted text-left"
									onclick={() => toggleChannel(channel.id)}
								>
									<Checkbox checked={isSelected} />
									<DestinationTypeIcon type={displayTypeOf(channel)} />
									<div class="flex-1 min-w-0">
										<div class="font-medium text-sm truncate">{channel.name}</div>
										{#if channel.description}
											<div class="text-xs text-muted-foreground truncate">
												{channel.description}
											</div>
										{/if}
									</div>
									<Badge variant="outline" class="text-xs shrink-0">
										{destinationLabel(channel)}
									</Badge>
								</button>
							{/each}
						</div>

						{#if showCreateButton}
							<div class="border-t p-1">
								<button
									type="button"
									class="flex items-center gap-2 w-full px-2 py-2 rounded-md hover:bg-muted text-sm text-muted-foreground"
									onclick={() => {
										popoverOpen = false;
										createDialogOpen = true;
									}}
								>
									<Plus class="h-4 w-4" />
									Create new destination
								</button>
							</div>
						{/if}
					{/if}
				</div>
			</Popover.Content>
		</Popover.Root>
	</div>
</div>

<CreateChannelDialog bind:open={createDialogOpen} onSuccess={handleChannelCreated} />
