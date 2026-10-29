<script lang="ts">
	import type { OrganizationMemberWithUser } from '@logtide/shared';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	interface Props {
		count: number;
		members: OrganizationMemberWithUser[];
		busy: boolean;
		onAcknowledge: () => void;
		onResolve: () => void;
		onAssign: (userId: string | null) => void;
		onClear: () => void;
	}

	let { count, members, busy, onAcknowledge, onResolve, onAssign, onClear }: Props = $props();
</script>

{#if count > 0}
	<div
		class="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2"
		role="toolbar"
		aria-label="Bulk actions"
	>
		<span class="text-sm font-medium">{count.toLocaleString('en-US')} selected</span>
		<Button variant="outline" size="sm" disabled={busy} onclick={onAcknowledge}>Acknowledge</Button>
		<Button variant="outline" size="sm" disabled={busy} onclick={onResolve}>Resolve</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" class="gap-1" disabled={busy}>
						Assign
						<ChevronDown class="w-4 h-4 opacity-50" aria-hidden="true" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-56 max-h-72 overflow-y-auto">
				<DropdownMenu.Label>Assign to</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Item class="cursor-pointer" onclick={() => onAssign(null)}>
					Unassigned
				</DropdownMenu.Item>
				{#each members as member (member.user.id)}
					<DropdownMenu.Item class="cursor-pointer" onclick={() => onAssign(member.user.id)}>
						<Avatar name={member.user.name} email={member.user.email} size="sm" />
						<span class="truncate">{member.user.name || member.user.email}</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button variant="ghost" size="sm" disabled={busy} onclick={onClear}>Clear selection</Button>
	</div>
{/if}
