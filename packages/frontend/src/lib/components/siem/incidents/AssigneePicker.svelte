<script lang="ts">
	import type { OrganizationMemberWithUser } from '@logtide/shared';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import Avatar from '$lib/components/app/Avatar.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	interface Props {
		members: OrganizationMemberWithUser[];
		value: string | null;
		disabled?: boolean;
		onChange: (userId: string | null) => void;
		allowUnassign?: boolean;
	}

	let { members, value, disabled = false, onChange, allowUnassign = true }: Props = $props();

	const current = $derived(value ? (members.find((m) => m.user.id === value)?.user ?? null) : null);
	// An assignee who left the organization is shown as "Unknown user", never blank.
	const label = $derived(value ? (current?.name || current?.email || 'Unknown user') : 'Unassigned');
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="gap-2 justify-start"
				{disabled}
				aria-label="Assignee: {label}"
			>
				{#if value}
					<Avatar name={current?.name ?? 'Unknown user'} email={current?.email} size="sm" />
				{/if}
				<span class="truncate max-w-[10rem]">{label}</span>
				<ChevronDown class="w-4 h-4 opacity-50" aria-hidden="true" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-56 max-h-72 overflow-y-auto">
		<DropdownMenu.Label>Assign to</DropdownMenu.Label>
		<DropdownMenu.Separator />
		{#if allowUnassign}
			<DropdownMenu.Item class="cursor-pointer" onclick={() => onChange(null)}>
				Unassigned
			</DropdownMenu.Item>
		{/if}
		{#each members as member (member.user.id)}
			<DropdownMenu.Item
				class="cursor-pointer {member.user.id === value ? 'bg-accent' : ''}"
				onclick={() => onChange(member.user.id)}
			>
				<Avatar name={member.user.name} email={member.user.email} size="sm" />
				<span class="truncate">{member.user.name || member.user.email}</span>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
