<script lang="ts">
	import type { IncidentListItem } from '@logtide/shared';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
	import MoreVertical from '@lucide/svelte/icons/more-vertical';
	import FileDown from '@lucide/svelte/icons/file-down';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { availableActions } from './incident-model';

	interface Props {
		incident: IncidentListItem;
		busy: boolean;
		onAcknowledge: () => void;
		onResolve: () => void;
		onReopen: () => void;
		onFalsePositive: () => void;
		onPublish: () => void;
		onExportPdf: () => void;
		onDelete: () => void | Promise<void>;
	}

	let {
		incident,
		busy,
		onAcknowledge,
		onResolve,
		onReopen,
		onFalsePositive,
		onPublish,
		onExportPdf,
		onDelete,
	}: Props = $props();

	const actions = $derived(availableActions(incident));
	let confirmDelete = $state(false);
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if actions.acknowledge}
		<Button onclick={onAcknowledge} disabled={busy}>Acknowledge</Button>
		{#if actions.resolve}
			<Button variant="outline" onclick={onResolve} disabled={busy}>Resolve</Button>
		{/if}
	{:else if actions.resolve}
		<Button onclick={onResolve} disabled={busy}>Resolve</Button>
	{/if}
	{#if actions.reopen}
		<Button onclick={onReopen} disabled={busy}>Reopen</Button>
	{/if}

	{#if actions.falsePositive}
		<Button variant="outline" onclick={onFalsePositive} disabled={busy}>Mark false positive</Button>
	{/if}

	{#if actions.publishToStatusPage}
		<Button variant="outline" onclick={onPublish} disabled={busy}>Publish to status page</Button>
	{/if}

	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="icon" aria-label="More actions">
					<MoreVertical class="size-4" aria-hidden="true" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-48">
			{#if actions.exportPdf}
				<DropdownMenu.Item class="cursor-pointer" onclick={onExportPdf}>
					<FileDown class="mr-2 size-4" aria-hidden="true" />
					Export as PDF
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
			{/if}
			<DropdownMenu.Item
				class="cursor-pointer text-destructive-text"
				onclick={() => (confirmDelete = true)}
			>
				<Trash2 class="mr-2 size-4" aria-hidden="true" />
				Delete incident
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>

<ConfirmDialog
	bind:open={confirmDelete}
	title="Delete incident"
	description={`"${incident.title}" and its timeline will be permanently deleted.`}
	confirmLabel="Delete"
	{busy}
	onConfirm={onDelete}
/>
