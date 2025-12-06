<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { updateIncident, type IncidentStatus, type Incident } from '$lib/api/siem';
	import { toastStore } from '$lib/stores/toast';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Search from '@lucide/svelte/icons/search';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import type { ComponentType } from 'svelte';

	interface Props {
		incident: Incident;
		onUpdate?: (updatedIncident: Incident) => void;
	}

	let { incident, onUpdate }: Props = $props();
	let loading = $state(false);

	interface StatusOption {
		value: IncidentStatus;
		label: string;
		icon: ComponentType;
		color: string;
	}

	const statusOptions: StatusOption[] = [
		{
			value: 'open',
			label: 'Open',
			icon: AlertCircle,
			color: 'text-yellow-500',
		},
		{
			value: 'investigating',
			label: 'Investigating',
			icon: Search,
			color: 'text-blue-500',
		},
		{
			value: 'resolved',
			label: 'Resolved',
			icon: CheckCircle,
			color: 'text-green-500',
		},
		{
			value: 'false_positive',
			label: 'False Positive',
			icon: XCircle,
			color: 'text-gray-500',
		},
	];

	const currentStatus = $derived(
		statusOptions.find((s) => s.value === incident.status) || statusOptions[0]
	);

	async function handleStatusChange(newStatus: IncidentStatus) {
		if (newStatus === incident.status) return;

		loading = true;
		try {
			const updated = await updateIncident(incident.id, {
				organizationId: incident.organizationId,
				status: newStatus,
			});
			toastStore.success(`Status changed to ${statusOptions.find((s) => s.value === newStatus)?.label}`);
			onUpdate?.(updated);
		} catch (error) {
			toastStore.error(error instanceof Error ? error.message : 'Failed to update status');
		} finally {
			loading = false;
		}
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		<Button variant="outline" size="sm" class="gap-2" disabled={loading}>
			{#if loading}
				<Loader2 class="w-4 h-4 animate-spin" />
			{:else}
				<currentStatus.icon class="w-4 h-4 {currentStatus.color}" />
			{/if}
			{currentStatus.label}
			<ChevronDown class="w-4 h-4 opacity-50" />
		</Button>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-48">
		<DropdownMenu.Label>Change status</DropdownMenu.Label>
		<DropdownMenu.Separator />
		{#each statusOptions as option}
			<DropdownMenu.Item
				class="cursor-pointer flex items-center gap-2 {option.value === incident.status ? 'bg-accent' : ''}"
				onclick={() => handleStatusChange(option.value)}
			>
				<option.icon class="w-4 h-4 {option.color}" />
				{option.label}
				{#if option.value === incident.status}
					<span class="ml-auto text-xs text-muted-foreground">Current</span>
				{/if}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
