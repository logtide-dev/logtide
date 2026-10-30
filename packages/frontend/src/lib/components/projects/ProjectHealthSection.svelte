<script lang="ts" module>
  import type { ProjectHealthCheckKey, ProjectHealthIssue } from '@logtide/shared';
  import { scopedHref } from './summary-format';

  export interface IssueLink {
    label: string;
    href: string;
  }

  /** Where "View affected" / the fix lives for an issue. */
  export function issueLink(checkKey: ProjectHealthCheckKey, projectId: string): IssueLink {
    const settings = `/dashboard/projects/${encodeURIComponent(projectId)}/settings`;
    switch (checkKey) {
      case 'timestamp_skew_logs':
        return { label: 'View logs', href: scopedHref('/dashboard/logs', projectId) };
      case 'timestamp_skew_spans':
        return { label: 'View traces', href: scopedHref('/dashboard/traces', projectId) };
      case 'timestamp_skew_metrics':
        return { label: 'View metrics', href: scopedHref('/dashboard/metrics', projectId) };
      case 'pii_rejected':
        return { label: 'PII masking rules', href: '/dashboard/settings/pii-masking' };
      case 'revoked_key':
        return { label: 'API keys', href: `${settings}#api-keys` };
      case 'silent':
        return { label: 'Connect', href: `${settings}#connect` };
    }
  }

  const SEVERITY_ORDER = { critical: 0, warning: 1 } as const;

  /** Open issues first (critical, then newest), then resolved ones, newest first. */
  export function sortIssues(issues: ProjectHealthIssue[]): ProjectHealthIssue[] {
    return [...issues].sort((a, b) => {
      const aOpen = a.resolvedAt === null;
      const bOpen = b.resolvedAt === null;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (aOpen) {
        const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (sev !== 0) return sev;
        return Date.parse(b.openedAt) - Date.parse(a.openedAt);
      }
      return Date.parse(b.resolvedAt ?? '') - Date.parse(a.resolvedAt ?? '');
    });
  }
</script>

<script lang="ts">
  import { PROJECT_HEALTH_CHECKS } from '@logtide/shared';
  import type { ProjectHealthMuteDuration } from '@logtide/shared';
  import type { ProjectHealth } from '$lib/api/project-health';
  import { projectHealthAPI } from '$lib/api/project-health';
  import { notificationRoutingAPI, type NotificationRoutingPreview } from '$lib/api/notification-routing';
  import { toastStore } from '$lib/stores/toast';
  import { formatRelative } from '$lib/utils/datetime';
  import { buttonVariants } from '$lib/components/ui/button';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { issueCopy, isMuted } from './health-copy';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  interface Props {
    projectId: string;
    organizationId: string | null;
    health: ProjectHealth;
    /** Org owner/admin: may mute and unmute. */
    canManage: boolean;
    /** Called after a mute change so the owner can re-read health. */
    onChanged?: () => void;
  }

  let { projectId, organizationId, health, canManage, onChanged }: Props = $props();

  const sorted = $derived(sortIssues(health.issues));
  const openIssues = $derived(sorted.filter((i) => i.resolvedAt === null));
  const resolvedIssues = $derived(sorted.filter((i) => i.resolvedAt !== null));
  const noData = $derived(health.status === 'no_data');

  const MUTE_OPTIONS: Array<{ duration: ProjectHealthMuteDuration; label: string }> = [
    { duration: '24h', label: '24 hours' },
    { duration: '7d', label: '7 days' },
    { duration: 'until_resolved', label: 'Until resolved' },
  ];

  let busyKey = $state<string | null>(null);

  async function mute(issue: ProjectHealthIssue, duration: ProjectHealthMuteDuration | null) {
    busyKey = issue.id;
    try {
      await projectHealthAPI.setMute(projectId, issue.checkKey, duration);
      toastStore.success(duration ? 'Issue muted' : 'Issue unmuted');
      onChanged?.();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to update mute');
    } finally {
      busyKey = null;
    }
  }

  function muteLabel(issue: ProjectHealthIssue): string {
    const m = issue.mute;
    if (!m) return '';
    if (m.untilResolved) return 'Muted until resolved';
    return m.until ? `Muted until ${formatRelative(m.until).replace(/^in /, '')}` : 'Muted';
  }

  // Checklist rows are derived from the open issues so it never disagrees with the list above.
  const openKeys = $derived(new Set<ProjectHealthCheckKey>(openIssues.map((i) => i.checkKey)));

  interface CheckRow {
    id: string;
    state: 'ok' | 'fail' | 'idle';
    label: string;
  }

  const checks = $derived.by<CheckRow[]>(() => {
    const skewOpen = (
      ['timestamp_skew_logs', 'timestamp_skew_spans', 'timestamp_skew_metrics'] as const
    ).filter((k) => openKeys.has(k));
    const skewNames = skewOpen.map((k) => k.replace('timestamp_skew_', ''));
    const pii = health.checks.piiRejected24h;
    return [
      {
        id: 'receiving',
        state: noData ? 'idle' : openKeys.has('silent') ? 'fail' : 'ok',
        label: noData ? 'No data yet' : openKeys.has('silent') ? 'Not receiving data' : 'Receiving data',
      },
      {
        id: 'pii',
        state: openKeys.has('pii_rejected') ? 'fail' : 'ok',
        label: `PII masking: ${pii.toLocaleString('en-US')} rejected in 24h`,
      },
      {
        id: 'timestamps',
        state: skewOpen.length > 0 ? 'fail' : 'ok',
        label: skewOpen.length > 0 ? `Timestamps out of range: ${skewNames.join(', ')}` : 'Timestamps OK',
      },
      {
        id: 'keys',
        state: openKeys.has('revoked_key') ? 'fail' : 'ok',
        label: openKeys.has('revoked_key') ? 'A revoked API key is still in use' : 'API keys OK',
      },
    ];
  });

  // Where health notifications go: same resolver the dispatcher uses.
  let preview = $state<NotificationRoutingPreview | null>(null);
  let previewFailed = $state(false);

  $effect(() => {
    const orgId = organizationId;
    const id = projectId;
    const channelIds = health.settings.healthChannelIds;
    if (!orgId) return;
    let active = true;
    notificationRoutingAPI
      .preview({ organizationId: orgId, eventType: 'project_health', projectId: id, channelIds })
      .then((r) => {
        if (!active) return;
        preview = r;
        previewFailed = false;
      })
      .catch(() => {
        if (active) previewFailed = true;
      });
    return () => {
      active = false;
    };
  });

  const recipients = $derived.by(() => {
    if (previewFailed) return 'could not be loaded';
    if (!preview) return 'loading';
    const names = preview.destinations.map((d) => `${d.name} (${d.type})`);
    if (preview.fallback) names.push('organization owners and admins by email');
    return names.length > 0 ? names.join(', ') : 'nobody (no channel is configured)';
  });

  const notificationsHref = $derived(`/dashboard/projects/${encodeURIComponent(projectId)}/settings#notifications`);
</script>

<div class="space-y-6" data-testid="project-health-section">
  {#if openIssues.length === 0}
    <div
      class="flex items-start gap-3 rounded-lg border px-4 py-3
        {noData ? 'border-border bg-muted/40' : 'border-emerald-500/30 bg-emerald-500/5'}"
      data-testid="health-all-clear"
    >
      {#if noData}
        <CircleDashed class="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div class="text-sm">
          <p class="font-medium">No data yet</p>
          <p class="text-muted-foreground">
            Health checks start once the project receives its first event.
            <a href="/dashboard/projects/{encodeURIComponent(projectId)}/settings#connect" class="text-primary hover:underline">Connect a source</a>
          </p>
        </div>
      {:else}
        <CircleCheck class="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <div class="text-sm">
          <p class="font-medium">All checks passing</p>
          <p class="text-muted-foreground">No open health issues for this project.</p>
        </div>
      {/if}
    </div>
  {/if}

  {#if sorted.length > 0}
    <section aria-label="Health issues" class="space-y-2">
      <h2 class="text-sm font-semibold">Issues</h2>
      <ul class="divide-y divide-border rounded-lg border border-border bg-card">
        {#each sorted as issue (issue.id)}
          {@const resolved = issue.resolvedAt !== null}
          {@const muted = !resolved && isMuted(issue)}
          {@const copy = issueCopy(issue)}
          {@const link = issueLink(issue.checkKey, projectId)}
          <li class="px-4 py-3 {resolved ? 'opacity-60' : ''}" data-testid="health-issue" data-resolved={resolved}>
            <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  {#if resolved}
                    <CircleCheck class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {:else}
                    <CircleAlert
                      class="size-4 shrink-0 {issue.severity === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}"
                      aria-hidden="true"
                    />
                  {/if}
                  <h3 class="text-sm font-medium">{PROJECT_HEALTH_CHECKS[issue.checkKey].title}</h3>
                  {#if resolved}
                    <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Resolved</span>
                  {:else}
                    <span
                      class="rounded-full px-2 py-0.5 text-xs font-medium
                        {issue.severity === 'critical' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}"
                    >
                      {issue.severity === 'critical' ? 'Critical' : 'Warning'}
                    </span>
                  {/if}
                  {#if muted}
                    <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" data-testid="muted-badge">
                      <BellOff class="size-3" aria-hidden="true" />
                      {muteLabel(issue)}
                    </span>
                  {/if}
                </div>
                <p class="text-sm text-muted-foreground">{copy.explanation}</p>
                {#if !resolved}
                  <p class="text-xs text-muted-foreground">{copy.hint}</p>
                {/if}
                <p class="text-xs text-muted-foreground">
                  {#if resolved}
                    Opened {formatRelative(issue.openedAt)}, resolved {formatRelative(issue.resolvedAt ?? issue.openedAt)}
                  {:else}
                    Since {formatRelative(issue.openedAt)}, last seen {formatRelative(issue.lastSeenAt)}
                  {/if}
                </p>
              </div>

              {#if !resolved}
                <div class="flex shrink-0 flex-wrap items-center gap-2">
                  <a href={link.href} class={buttonVariants({ variant: 'outline', size: 'sm' })}>{link.label}</a>
                  {#if canManage}
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger disabled={busyKey === issue.id}>
                        {#snippet child({ props })}
                          <Button {...props} variant="outline" size="sm" class="gap-1" aria-label="Mute {PROJECT_HEALTH_CHECKS[issue.checkKey].title}">
                            Mute
                            <ChevronDown class="size-3.5 opacity-60" aria-hidden="true" />
                          </Button>
                        {/snippet}
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end" class="w-44">
                        {#each MUTE_OPTIONS as option (option.duration)}
                          <DropdownMenu.Item onSelect={() => mute(issue, option.duration)}>{option.label}</DropdownMenu.Item>
                        {/each}
                        {#if muted}
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item onSelect={() => mute(issue, null)}>Unmute</DropdownMenu.Item>
                        {/if}
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  {/if}
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      {#if resolvedIssues.length > 0 && openIssues.length > 0}
        <p class="text-xs text-muted-foreground">Resolved issues stay listed for 7 days.</p>
      {/if}
    </section>
  {/if}

  <section aria-label="Checks" class="space-y-2">
    <h2 class="text-sm font-semibold">Checks</h2>
    <ul class="divide-y divide-border rounded-lg border border-border bg-card" data-testid="health-checks">
      {#each checks as row (row.id)}
        <li class="flex items-center gap-2.5 px-4 py-2 text-sm" data-state={row.state}>
          {#if row.state === 'ok'}
            <CircleCheck class="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {:else if row.state === 'fail'}
            <CircleAlert class="size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          {:else}
            <CircleDashed class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {/if}
          <span class={row.state === 'idle' ? 'text-muted-foreground' : ''}>{row.label}</span>
        </li>
      {/each}
    </ul>
  </section>

  <p class="text-sm text-muted-foreground" data-testid="health-notify-footer">
    Health notifications go to: <span class="text-foreground">{recipients}</span>.
    <a href={notificationsHref} class="text-primary hover:underline">Change</a>
  </p>
</div>
