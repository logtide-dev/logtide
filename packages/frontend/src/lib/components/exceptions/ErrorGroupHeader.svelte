<script lang="ts">
  import type { ErrorGroup } from '@logtide/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';
  import LanguageBadge from './shared/LanguageBadge.svelte';
  import ErrorStatusBadges from './ErrorStatusBadges.svelte';
  import AssigneePicker from './AssigneePicker.svelte';
  import IgnoreDialog from './IgnoreDialog.svelte';
  import { describeIgnore, type AssigneeMember, type IgnoreOptions } from './error-status';
  import { buildCreateAlertHref } from './error-group-links';
  import Bell from '@lucide/svelte/icons/bell';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Folder from '@lucide/svelte/icons/folder';

  interface Props {
    group: ErrorGroup;
    members: AssigneeMember[];
    busy?: boolean;
    onResolve: () => void;
    onReopen: () => void;
    onIgnore: (options: IgnoreOptions) => void | Promise<void>;
    onAssign: (userId: string | null) => void;
  }

  let { group, members, busy = false, onResolve, onReopen, onIgnore, onAssign }: Props = $props();

  let ignoreOpen = $state(false);

  const ignoreText = $derived(describeIgnore(group));
  const services = $derived((group.affectedServices ?? []).filter((s) => s && s !== 'unknown'));

  async function confirmIgnore(options: IgnoreOptions) {
    await onIgnore(options);
    ignoreOpen = false;
  }
</script>

<div class="mb-6 space-y-4">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <code class="truncate font-mono text-xl font-bold">{group.exceptionType}</code>
        <LanguageBadge language={group.language} size="md" />
        <ErrorStatusBadges {group} />
        {#if group.projectName}
          <Badge variant="outline" class="gap-1 font-normal text-muted-foreground">
            <Folder class="h-3 w-3" aria-hidden="true" />
            {group.projectName}
          </Badge>
        {/if}
      </div>
      {#if group.exceptionMessage}
        <p class="font-mono text-sm text-muted-foreground">{group.exceptionMessage}</p>
      {/if}
      {#if ignoreText}
        <p class="text-sm text-muted-foreground">{ignoreText}</p>
      {/if}
      {#if group.status === 'resolved' && group.resolvedAt}
        <p class="text-sm text-muted-foreground">
          Resolved{group.resolvedByName ? ` by ${group.resolvedByName}` : ''} on
          <Timestamp value={group.resolvedAt} precision="minute" />
        </p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <AssigneePicker {members} value={group.assignedTo ?? null} disabled={busy} onChange={onAssign} />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger disabled={busy}>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm" class="gap-2" aria-label="Change status">
              Status
              <ChevronDown class="h-3 w-3 opacity-60" aria-hidden="true" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-44">
          {#if group.status !== 'resolved'}
            <DropdownMenu.Item onSelect={onResolve} class="gap-2">
              <CircleCheck class="h-4 w-4" aria-hidden="true" />
              Resolve
            </DropdownMenu.Item>
          {/if}
          {#if group.status !== 'open'}
            <DropdownMenu.Item onSelect={onReopen} class="gap-2">
              <RotateCcw class="h-4 w-4" aria-hidden="true" />
              Reopen
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item onSelect={() => (ignoreOpen = true)} class="gap-2">
            <EyeOff class="h-4 w-4" aria-hidden="true" />
            Ignore
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <a href={buildCreateAlertHref(group)} class={buttonVariants({ variant: 'outline', size: 'sm' })}>
        <Bell class="mr-1.5 h-4 w-4" aria-hidden="true" />
        Create alert
      </a>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
    <div class="flex items-center gap-2">
      <span class="font-bold tabular-nums">{group.occurrenceCount.toLocaleString('en-US')}</span>
      <span class="text-muted-foreground">occurrences</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-muted-foreground">Last seen</span>
      <Timestamp value={group.lastSeen} relative />
    </div>
    <div class="flex items-center gap-2">
      <span class="text-muted-foreground">First seen</span>
      <Timestamp value={group.firstSeen} relative />
    </div>
    <div class="flex items-center gap-1">
      <span class="font-mono text-xs text-muted-foreground">{group.fingerprint.slice(0, 12)}</span>
      <CopyButton value={group.fingerprint} ariaLabel="Copy fingerprint" />
    </div>
  </div>

  {#if services.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted-foreground">Affected services</span>
      {#each services as service (service)}
        <Badge variant="outline" class="font-mono">{service}</Badge>
      {/each}
    </div>
  {/if}

  <WillNotify eventType="error" projectId={group.projectId} />
</div>

<IgnoreDialog bind:open={ignoreOpen} {busy} onConfirm={confirmIgnore} />
