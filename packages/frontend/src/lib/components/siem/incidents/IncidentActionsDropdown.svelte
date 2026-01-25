<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { deleteIncident, type Incident } from '$lib/api/siem';
	import { toastStore } from '$lib/stores/toast';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { goto } from '$app/navigation';
	import MoreVertical from '@lucide/svelte/icons/more-vertical';
	import FileDown from '@lucide/svelte/icons/file-down';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Copy from '@lucide/svelte/icons/copy';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	interface Props {
		incident: Incident;
		onDelete?: () => void;
		onExportPdf?: () => void;
	}

	let { incident, onDelete, onExportPdf }: Props = $props();

	let showDeleteDialog = $state(false);
	let deleting = $state(false);

	async function handleDelete() {
		deleting = true;
		try {
			await deleteIncident(incident.id, incident.organizationId);
			toastStore.success('Incident deleted');
			showDeleteDialog = false;
			onDelete?.();
			goto('/dashboard/security/incidents');
		} catch (error) {
			toastStore.error(error instanceof Error ? error.message : 'Failed to delete incident');
		} finally {
			deleting = false;
		}
	}

	async function copyIncidentId() {
		const success = await copyToClipboard(incident.id);
		if (success) {
			toastStore.success('Incident ID copied to clipboard');
		} else {
			toastStore.error('Could not copy. Please select and copy manually.');
		}
	}

	function viewInLogs() {
		const params = new URLSearchParams();

		// Add project filter if available
		if (incident.projectId) {
			params.append('project', incident.projectId);
		}

		// Add trace ID filter if available
		if (incident.traceId) {
			params.append('traceId', incident.traceId);
		}

		// Add service filter if available
		if (incident.affectedServices && incident.affectedServices.length > 0) {
			params.append('service', incident.affectedServices[0]);
		}

		// Add time range based on incident time window or creation time
		if (incident.timeWindowStart && incident.timeWindowEnd) {
			params.append('from', incident.timeWindowStart);
			params.append('to', incident.timeWindowEnd);
		} else if (incident.createdAt) {
			// Use a 1-hour window around creation time
			const created = new Date(incident.createdAt);
			const from = new Date(created.getTime() - 30 * 60 * 1000); // 30 min before
			const to = new Date(created.getTime() + 30 * 60 * 1000); // 30 min after
			params.append('from', from.toISOString());
			params.append('to', to.toISOString());
		}

		const queryString = params.toString();
		goto(`/dashboard/search${queryString ? '?' + queryString : ''}`);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		<Button variant="ghost" size="icon">
			<MoreVertical class="w-4 h-4" />
			<span class="sr-only">Actions</span>
		</Button>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-48">
		<DropdownMenu.Item class="cursor-pointer" onclick={copyIncidentId}>
			<Copy class="w-4 h-4 mr-2" />
			Copy ID
		</DropdownMenu.Item>
		<DropdownMenu.Item class="cursor-pointer" onclick={viewInLogs}>
			<ExternalLink class="w-4 h-4 mr-2" />
			View in Logs
		</DropdownMenu.Item>
		{#if onExportPdf}
			<DropdownMenu.Item class="cursor-pointer" onclick={onExportPdf}>
				<FileDown class="w-4 h-4 mr-2" />
				Export PDF
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Separator />
		<DropdownMenu.Item
			class="cursor-pointer text-destructive focus:text-destructive"
			onclick={() => (showDeleteDialog = true)}
		>
			<Trash2 class="w-4 h-4 mr-2" />
			Delete Incident
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<AlertDialog.Root bind:open={showDeleteDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Incident</AlertDialog.Title>
			<AlertDialog.Description>
				Are you sure you want to delete this incident? This action cannot be undone.
				All associated comments and history will also be deleted.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				disabled={deleting}
				onclick={handleDelete}
			>
				{#if deleting}
					<Loader2 class="w-4 h-4 mr-2 animate-spin" />
				{/if}
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
