<script lang="ts">
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Button from '$lib/components/ui/button/button.svelte';
  import Avatar from '$lib/components/app/Avatar.svelte';
  import UserRound from '@lucide/svelte/icons/user-round';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import type { AssigneeMember } from './error-status';

  interface Props {
    members: AssigneeMember[];
    value: string | null;
    disabled?: boolean;
    /** Text for the trigger when it should not show the current assignee (bulk use). */
    triggerLabel?: string;
    ariaLabel?: string;
    onChange: (userId: string | null) => void;
  }

  let {
    members,
    value,
    disabled = false,
    triggerLabel,
    ariaLabel = 'Assign error',
    onChange,
  }: Props = $props();

  const current = $derived(members.find((m) => m.id === value) ?? null);
  const marksCurrent = $derived(triggerLabel === undefined);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm" class="gap-2 max-w-[220px]" aria-label={ariaLabel}>
        {#if triggerLabel !== undefined}
          {triggerLabel}
        {:else if current}
          <Avatar name={current.name} email={current.email} size="sm" />
          <span class="truncate">{current.name}</span>
        {:else}
          <UserRound class="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <span>Unassigned</span>
        {/if}
        <ChevronDown class="w-3 h-3 opacity-60" aria-hidden="true" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="start" class="w-64">
    <DropdownMenu.Item onSelect={() => onChange(null)} class="gap-2">
      <UserRound class="w-4 h-4 text-muted-foreground" aria-hidden="true" />
      <span class="flex-1">Unassigned</span>
      {#if marksCurrent && value === null}
        <Check class="w-4 h-4" aria-label="Current assignee" />
      {/if}
    </DropdownMenu.Item>
    {#if members.length > 0}
      <DropdownMenu.Separator />
    {/if}
    {#each members as member (member.id)}
      <DropdownMenu.Item onSelect={() => onChange(member.id)} class="gap-2">
        <Avatar name={member.name} email={member.email} size="sm" />
        <span class="truncate flex-1">{member.name || member.email}</span>
        {#if marksCurrent && member.id === value}
          <Check class="w-4 h-4" aria-label="Current assignee" />
        {/if}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
