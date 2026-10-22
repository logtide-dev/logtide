<script lang="ts">
  import type { LogEntry } from '$lib/api/logs';
  import type { IdentifierMatch } from '$lib/api/correlation';
  import Button from '$lib/components/ui/button/button.svelte';
  import KeyValueTable from '$lib/components/app/KeyValueTable.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import IdentifierBadge from '$lib/components/IdentifierBadge.svelte';
  import BreadcrumbTimeline from '$lib/components/BreadcrumbTimeline.svelte';
  import { ExceptionDetailsDialog } from '$lib/components/exceptions';
  import { formatTimestamp } from '$lib/utils/datetime';
  import { displayPreferences, type DisplayPreferences } from '$lib/stores/display-preferences';
  import X from '@lucide/svelte/icons/x';
  import ListFilter from '@lucide/svelte/icons/list-filter';
  import Ban from '@lucide/svelte/icons/ban';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import TextSearch from '@lucide/svelte/icons/text-search';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import { logPermalink } from './explorer-url';
  import { detailsMetadata, logBreadcrumbs, logHostname, metadataFilterValue } from './log-fields';

  interface Props {
    log: LogEntry | null;
    projectName: string;
    identifiers: IdentifierMatch[];
    organizationId: string;
    onClose: () => void;
    /** `key` is a grammar key (`service`, `host`, `trace`) or a metadata path; `value` is the clause text. */
    onFilter: (key: string, value: string, negate: boolean) => void;
    onProjectFilter: (projectId: string) => void;
    onAddColumn: (path: string) => void;
    onOpenContext: (log: LogEntry) => void;
    onOpenCorrelation: (log: LogEntry, type: string, value: string) => void;
  }

  let {
    log,
    projectName,
    identifiers,
    organizationId,
    onClose,
    onFilter,
    onProjectFilter,
    onAddColumn,
    onOpenContext,
    onOpenCorrelation,
  }: Props = $props();

  const uid = $props.id();

  type Chip = { key: string; label: string; value: string; exclude: boolean };

  let breadcrumbsOpen = $state(false);
  let exceptionOpen = $state(false);
  let shownKey: string | null = null;

  // A different log starts with the breadcrumbs collapsed and no dialog open.
  $effect.pre(() => {
    const key = log ? (log.id ?? `${log.time}|${log.projectId}`) : null;
    if (key === shownKey) return;
    shownKey = key;
    breadcrumbsOpen = false;
    exceptionOpen = false;
  });

  const host = $derived(log ? logHostname(log) : null);
  const metadata = $derived(log ? detailsMetadata(log.metadata) : null);
  const crumbs = $derived(log ? logBreadcrumbs(log) : []);
  const isErrorLevel = $derived(log?.level === 'error' || log?.level === 'critical');

  // trace/session/span support equals only (spec 5.3), so they get no Exclude.
  const chips = $derived.by((): Chip[] => {
    if (!log) return [];
    const out: Chip[] = [];
    if (log.service) out.push({ key: 'service', label: 'Service', value: log.service, exclude: true });
    if (host) out.push({ key: 'host', label: 'Host', value: host, exclude: true });
    if (log.level) out.push({ key: 'level', label: 'Level', value: log.level, exclude: true });
    if (log.traceId) out.push({ key: 'trace', label: 'Trace', value: log.traceId, exclude: false });
    if (log.sessionId) out.push({ key: 'session', label: 'Session', value: log.sessionId, exclude: false });
    if (log.spanId) out.push({ key: 'span', label: 'Span', value: log.spanId, exclude: false });
    return out;
  });

  const permalink = $derived(
    log?.id && typeof location !== 'undefined'
      ? logPermalink({ id: log.id, projectId: log.projectId, time: log.time }, location.origin)
      : null,
  );

  const json = $derived.by(() => {
    if (!log) return '';
    try {
      return JSON.stringify(log, null, 2);
    } catch {
      return String(log.message ?? '');
    }
  });

  // `_prefs` comes from the template so the header re-renders on a preference change.
  function timeText(time: string, _prefs: DisplayPreferences): string {
    return formatTimestamp(time, { precision: 'ms', withDate: true, withZone: true });
  }

  function traceHref(entry: LogEntry): string {
    return `/dashboard/traces/${encodeURIComponent(entry.traceId ?? '')}?projectId=${encodeURIComponent(entry.projectId)}`;
  }

  function sessionHref(entry: LogEntry): string {
    return `/dashboard/sessions/${encodeURIComponent(entry.sessionId ?? '')}?project=${encodeURIComponent(entry.projectId)}`;
  }

  function filterMetadata(path: string, value: unknown, negate: boolean) {
    const text = metadataFilterValue(value);
    if (text === null) return;
    onFilter(path, text, negate);
  }

  const IGNORE_ESCAPE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="alertdialog"]';

  function handleKeydown(e: KeyboardEvent) {
    if (!log || e.key !== 'Escape' || e.defaultPrevented || exceptionOpen) return;
    const target = e.target;
    if (target instanceof Element && target.closest(IGNORE_ESCAPE)) return;
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if log}
  <aside aria-label="Log details" class="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground">
    <header class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <SeverityBadge kind="level" value={log.level} />
      <span class="font-mono text-xs text-muted-foreground">{timeText(log.time, $displayPreferences)}</span>
      <span class="ml-auto flex items-center gap-0.5">
        {#if permalink}
          <CopyButton value={permalink} label="Copy link" />
        {/if}
        <CopyButton value={json} label="Copy JSON" />
        <Button variant="ghost" size="icon" class="size-8" aria-label="Close log details" title="Close" onclick={onClose}>
          <X />
        </Button>
      </span>
    </header>

    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
      <section aria-label="Fields" class="space-y-1.5">
        <div class="flex items-center gap-2 text-sm">
          <span class="w-16 shrink-0 text-xs text-muted-foreground">Project</span>
          <button
            type="button"
            class="inline-flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Filter by project {projectName}"
            title="Show only this project"
            onclick={() => onProjectFilter(log.projectId)}
          >
            <span class="truncate">{projectName}</span>
            <ListFilter class="size-3 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        </div>
        {#each chips as chip (chip.key)}
          <div class="group flex items-center gap-2 text-sm">
            <span class="w-16 shrink-0 text-xs text-muted-foreground">{chip.label}</span>
            <span class="flex min-w-0 flex-1 items-center gap-1.5">
              {#if chip.key === 'level'}
                <SeverityBadge kind="level" value={chip.value} />
              {:else}
                <span class="truncate font-mono text-xs" title={chip.value}>{chip.value}</span>
              {/if}
              {#if chip.key === 'trace'}
                <a
                  href={traceHref(log)}
                  class="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-primary-text hover:underline"
                >
                  Open trace
                  <ArrowUpRight class="size-3" aria-hidden="true" />
                </a>
              {:else if chip.key === 'session'}
                <a
                  href={sessionHref(log)}
                  class="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-primary-text hover:underline"
                >
                  Open session
                  <ArrowUpRight class="size-3" aria-hidden="true" />
                </a>
              {/if}
            </span>
            <span class="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="icon"
                class="size-7"
                aria-label="Filter by {chip.key} {chip.value}"
                title="Filter"
                onclick={() => onFilter(chip.key, chip.value, false)}
              >
                <ListFilter class="size-3.5" />
              </Button>
              {#if chip.exclude}
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7"
                  aria-label="Exclude {chip.key} {chip.value}"
                  title="Exclude"
                  onclick={() => onFilter(chip.key, chip.value, true)}
                >
                  <Ban class="size-3.5" />
                </Button>
              {/if}
            </span>
          </div>
        {/each}
      </section>

      <section aria-labelledby="{uid}-message" class="space-y-1">
        <h3 id="{uid}-message" class="text-xs font-medium text-muted-foreground">Message</h3>
        <pre
          class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-xs">{log.message}</pre>
      </section>

      <section aria-labelledby="{uid}-metadata" class="space-y-1">
        <h3 id="{uid}-metadata" class="text-xs font-medium text-muted-foreground">Metadata</h3>
        {#if metadata}
          <KeyValueTable data={metadata} onFilter={filterMetadata} {onAddColumn} />
        {:else}
          <p class="text-sm text-muted-foreground">No metadata</p>
        {/if}
      </section>

      {#if identifiers.length > 0}
        <section aria-labelledby="{uid}-identifiers" class="space-y-1">
          <h3 id="{uid}-identifiers" class="text-xs font-medium text-muted-foreground">Identifiers</h3>
          <div class="flex flex-wrap items-center gap-2">
            {#each identifiers as identifier (`${identifier.type}:${identifier.value}`)}
              <IdentifierBadge
                type={identifier.type}
                value={identifier.value}
                onclick={() => onOpenCorrelation(log, identifier.type, identifier.value)}
              />
            {/each}
            <a
              href="/dashboard/settings/patterns"
              class="inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/50 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground"
            >
              <Settings2 class="size-3" aria-hidden="true" />
              <span>Configure</span>
            </a>
          </div>
        </section>
      {/if}

      <div class="flex flex-wrap gap-2 border-t pt-3">
        <Button variant="outline" size="sm" class="gap-1.5" onclick={() => onOpenContext(log)}>
          <TextSearch class="size-4" />
          View context
        </Button>
        {#if isErrorLevel && log.id}
          <Button variant="outline" size="sm" class="gap-1.5" onclick={() => (exceptionOpen = true)}>
            <TriangleAlert class="size-4 text-destructive-text" />
            View exception details
          </Button>
        {/if}
      </div>

      {#if crumbs.length > 0}
        <section class="border-t pt-3">
          <button
            type="button"
            class="flex w-full items-center gap-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={breadcrumbsOpen}
            onclick={() => (breadcrumbsOpen = !breadcrumbsOpen)}
          >
            <ListTree class="size-4" aria-hidden="true" />
            Breadcrumbs ({crumbs.length.toLocaleString('en-US')})
            <ChevronRight
              class="ml-auto size-4 transition-transform {breadcrumbsOpen ? 'rotate-90' : ''}"
              aria-hidden="true"
            />
          </button>
          {#if breadcrumbsOpen}
            <div class="mt-2 max-h-64 overflow-auto">
              <BreadcrumbTimeline breadcrumbs={crumbs} eventTime={log.time} />
            </div>
          {/if}
        </section>
      {/if}
    </div>
  </aside>

  {#if log.id}
    <ExceptionDetailsDialog
      open={exceptionOpen}
      logId={log.id}
      {organizationId}
      metadata={log.metadata ?? null}
      onClose={() => (exceptionOpen = false)}
    />
  {/if}
{/if}
