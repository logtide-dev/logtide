<script lang="ts">
  import type { SessionEvent } from '$lib/api/sessions';
  import { levelTone, stateTone, type Tone } from '$lib/utils/severity';
  import { formatTimestamp } from '$lib/utils/datetime';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import KeyValueTable from '$lib/components/app/KeyValueTable.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent } from '$lib/components/ui/card';

  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import FileText from '@lucide/svelte/icons/file-text';
  import Globe from '@lucide/svelte/icons/globe';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import Navigation from '@lucide/svelte/icons/navigation';
  import Terminal from '@lucide/svelte/icons/terminal';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Filter from '@lucide/svelte/icons/filter';
  import Search from '@lucide/svelte/icons/search';

  interface Props {
    events: SessionEvent[];
    projectId: string;
  }

  let { events, projectId }: Props = $props();

  interface TimelineItem {
    id: string;
    time: number;
    type: 'log' | 'breadcrumb';
    level?: string;
    message: string;
    service?: string;
    metadata?: Record<string, unknown>;
    traceId?: string;
    errorGroupId?: string;
    breadcrumbType?: string;
    category?: string;
    data?: Record<string, unknown>;
  }

  let typeFilter = $state<'all' | 'logs' | 'breadcrumbs'>('all');
  let levelFilter = $state<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
  let categoryFilter = $state<'all' | 'ui' | 'http' | 'navigation' | 'console' | 'error'>('all');
  let searchQuery = $state('');
  let expandedItems = $state<Set<string>>(new Set());

  const allItems = $derived.by(() => {
    const items: TimelineItem[] = [];

    for (const event of events) {
      const eventTime = new Date(event.time).getTime();
      items.push({
        id: event.id,
        time: eventTime,
        type: 'log',
        level: event.level,
        message: event.message,
        service: event.service,
        metadata: event.metadata,
        traceId: event.traceId,
        errorGroupId: event.errorGroupId,
      });

      const breadcrumbs = event.metadata?.breadcrumbs;
      if (Array.isArray(breadcrumbs)) {
        for (let i = 0; i < breadcrumbs.length; i++) {
          const bc = (breadcrumbs[i] ?? {}) as {
            type?: string;
            category?: string;
            message?: string;
            level?: string;
            timestamp?: number;
            data?: Record<string, unknown>;
          };
          items.push({
            id: `${event.id}-bc-${i}`,
            time: typeof bc.timestamp === 'number' ? bc.timestamp : eventTime,
            type: 'breadcrumb',
            message: bc.message ?? '',
            level: bc.level,
            breadcrumbType: bc.type,
            category: bc.category,
            data: bc.data,
          });
        }
      }
    }

    items.sort((a, b) => a.time - b.time);

    // Every log in a session repeats the breadcrumbs leading up to it, so the
    // same breadcrumb shows up many times. Keep the first occurrence.
    const seen = new Set<string>();
    return items.filter((item) => {
      if (item.type === 'log') return true;
      const key = `${item.time}-${item.message}-${item.breadcrumbType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const timeline = $derived.by(() => {
    let items = allItems;

    if (typeFilter === 'logs') items = items.filter((i) => i.type === 'log');
    else if (typeFilter === 'breadcrumbs') items = items.filter((i) => i.type === 'breadcrumb');

    if (levelFilter !== 'all') {
      items = items.filter((i) => {
        if (i.type === 'log') {
          return levelFilter === 'error' ? i.level === 'error' || i.level === 'critical' : i.level === levelFilter;
        }
        return i.level === levelFilter || !i.level;
      });
    }

    if (categoryFilter !== 'all') {
      items = items.filter((i) => (i.type === 'breadcrumb' ? i.breadcrumbType === categoryFilter : true));
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) items = items.filter((i) => i.message.toLowerCase().includes(q));

    return items;
  });

  const logCount = $derived(allItems.filter((i) => i.type === 'log').length);
  const breadcrumbCount = $derived(allItems.filter((i) => i.type === 'breadcrumb').length);
  const errorCount = $derived(
    allItems.filter((i) => i.type === 'log' && (i.level === 'error' || i.level === 'critical')).length,
  );
  const activeFilterCount = $derived(
    (typeFilter !== 'all' ? 1 : 0) +
      (levelFilter !== 'all' ? 1 : 0) +
      (categoryFilter !== 'all' ? 1 : 0) +
      (searchQuery.trim() ? 1 : 0),
  );

  function toggleExpanded(id: string) {
    const next = new Set(expandedItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedItems = next;
  }

  function clearFilters() {
    typeFilter = 'all';
    levelFilter = 'all';
    categoryFilter = 'all';
    searchQuery = '';
  }

  function borderClass(level?: string): string {
    switch (level) {
      case 'error':
      case 'critical':
        return 'border-l-destructive';
      case 'warn':
        return 'border-l-warning';
      case 'debug':
        return 'border-l-border';
      default:
        return 'border-l-info';
    }
  }

  function isErrorLevel(level?: string): boolean {
    return level === 'error' || level === 'critical';
  }

  interface IconConfig {
    icon: typeof Globe;
    tone: Tone;
  }

  function breadcrumbIcon(type?: string): IconConfig {
    switch (type) {
      case 'ui':
        return { icon: MousePointerClick, tone: levelTone('critical') };
      case 'http':
        return { icon: Globe, tone: levelTone('info') };
      case 'console':
        return { icon: Terminal, tone: levelTone('debug') };
      case 'navigation':
        return { icon: Navigation, tone: stateTone('resolved') };
      case 'error':
        return { icon: AlertTriangle, tone: levelTone('error') };
      default:
        return { icon: Globe, tone: levelTone('debug') };
    }
  }

  function logIcon(level?: string): IconConfig {
    if (isErrorLevel(level)) return { icon: AlertCircle, tone: levelTone('error') };
    if (level === 'warn') return { icon: AlertTriangle, tone: levelTone('warn') };
    return { icon: FileText, tone: levelTone('info') };
  }

  function expandableData(item: TimelineItem): Record<string, unknown> | null {
    if (item.type === 'breadcrumb' && item.data && Object.keys(item.data).length > 0) return item.data;
    if (item.type === 'log' && item.metadata) {
      const { breadcrumbs: _breadcrumbs, ...rest } = item.metadata;
      if (Object.keys(rest).length > 0) return rest;
    }
    return null;
  }

  function traceHref(traceId: string): string {
    return `/dashboard/traces/${encodeURIComponent(traceId)}?project=${encodeURIComponent(projectId)}`;
  }
</script>

<div class="space-y-4">
  <Card>
    <CardContent class="px-4 py-3">
      <div class="flex flex-wrap items-center gap-3">
        <Filter class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

        <select
          aria-label="Filter by type"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
          bind:value={typeFilter}
        >
          <option value="all">All types ({allItems.length.toLocaleString('en-US')})</option>
          <option value="logs">Logs ({logCount.toLocaleString('en-US')})</option>
          <option value="breadcrumbs">Breadcrumbs ({breadcrumbCount.toLocaleString('en-US')})</option>
        </select>

        <select
          aria-label="Filter by level"
          class="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
          bind:value={levelFilter}
        >
          <option value="all">All levels</option>
          <option value="error">Error{errorCount > 0 ? ` (${errorCount.toLocaleString('en-US')})` : ''}</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>

        {#if typeFilter !== 'logs'}
          <select
            aria-label="Filter by category"
            class="h-8 rounded-md border border-input bg-background px-2.5 text-sm"
            bind:value={categoryFilter}
          >
            <option value="all">All categories</option>
            <option value="ui">Click and UI</option>
            <option value="http">Network and HTTP</option>
            <option value="navigation">Navigation</option>
            <option value="console">Console</option>
            <option value="error">Error</option>
          </select>
        {/if}

        <div class="relative min-w-[180px] flex-1">
          <Search
            class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Search events"
            placeholder="Search events"
            class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
            bind:value={searchQuery}
          />
        </div>

        {#if activeFilterCount > 0}
          <Button variant="ghost" size="sm" class="h-8 text-xs" onclick={clearFilters}>Clear filters</Button>
        {/if}

        <span class="ml-auto shrink-0 text-xs text-muted-foreground">
          {timeline.length.toLocaleString('en-US')} of {allItems.length.toLocaleString('en-US')} events
        </span>
      </div>
    </CardContent>
  </Card>

  {#if timeline.length === 0}
    <div class="py-12 text-center">
      <p class="text-muted-foreground">No events match the current filters.</p>
      <Button variant="ghost" size="sm" class="mt-2" onclick={clearFilters}>Clear filters</Button>
    </div>
  {:else}
    <div class="relative">
      <div class="absolute bottom-3 left-[17px] top-3 w-px bg-border"></div>

      <div class="space-y-1">
        {#each timeline as item (item.id)}
          {@const isLog = item.type === 'log'}
          {@const iconConfig = isLog ? logIcon(item.level) : breadcrumbIcon(item.breadcrumbType)}
          {@const expandable = expandableData(item)}
          {@const isExpanded = expandedItems.has(item.id)}

          {#if isLog}
            <div class="relative py-1 pl-12" data-testid="timeline-log">
              <div
                class="absolute left-0 top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border {iconConfig.tone.badge}"
              >
                <iconConfig.icon class="size-4" aria-hidden="true" />
              </div>

              <div
                class="rounded-lg border border-l-[3px] {borderClass(item.level)} p-4 transition-colors hover:bg-muted/30"
              >
                <div class="mb-1.5 flex flex-wrap items-center gap-2.5">
                  <span class="font-mono text-xs text-muted-foreground">
                    {formatTimestamp(item.time, { precision: 'ms' })}
                  </span>
                  {#if item.level}<SeverityBadge kind="level" value={item.level} />{/if}
                  {#if item.service}
                    <Badge variant="outline" class="text-xs">{item.service}</Badge>
                  {/if}
                  {#if item.traceId}
                    <a
                      href={traceHref(item.traceId)}
                      class="font-mono text-xs text-primary hover:underline"
                      title={item.traceId}>Trace {item.traceId.slice(0, 8)}</a
                    >
                  {/if}
                  {#if item.errorGroupId && isErrorLevel(item.level)}
                    <a
                      href="/dashboard/errors/{encodeURIComponent(item.errorGroupId)}"
                      class="text-xs text-primary hover:underline">View error</a
                    >
                  {/if}
                  {#if expandable}
                    <button
                      type="button"
                      class="ml-auto rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? 'Hide metadata' : 'Show metadata'}
                      onclick={() => toggleExpanded(item.id)}
                    >
                      {#if isExpanded}
                        <ChevronDown class="size-4" aria-hidden="true" />
                      {:else}
                        <ChevronRight class="size-4" aria-hidden="true" />
                      {/if}
                    </button>
                  {/if}
                </div>
                <p
                  class="text-sm leading-relaxed {isErrorLevel(item.level)
                    ? 'font-medium text-destructive-text'
                    : ''}"
                >
                  {item.message}
                </p>

                {#if expandable && isExpanded}
                  <div class="mt-3 max-h-72 overflow-auto rounded-md bg-muted p-3">
                    <KeyValueTable data={expandable} />
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="relative py-0.5 pl-12" data-testid="timeline-breadcrumb">
              <div
                class="absolute left-[7px] top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border {iconConfig.tone.badge}"
              >
                <iconConfig.icon class="size-3.5" aria-hidden="true" />
              </div>

              <div
                class="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/30"
              >
                <span class="shrink-0 font-mono text-xs">{formatTimestamp(item.time, { precision: 'ms' })}</span>
                {#if item.category}
                  <span class="shrink-0 text-[11px] font-medium uppercase tracking-wider opacity-60"
                    >{item.category}</span
                  >
                {/if}
                <span class="truncate text-sm">{item.message}</span>
                {#if expandable}
                  <button
                    type="button"
                    class="ml-auto shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? 'Hide details' : 'Show details'}
                    onclick={() => toggleExpanded(item.id)}
                  >
                    {#if isExpanded}
                      <ChevronDown class="size-3.5" aria-hidden="true" />
                    {:else}
                      <ChevronRight class="size-3.5" aria-hidden="true" />
                    {/if}
                  </button>
                {/if}
              </div>

              {#if expandable && isExpanded}
                <div class="ml-3 mt-1.5 max-h-56 overflow-auto rounded-md bg-muted p-3">
                  <KeyValueTable data={expandable} />
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</div>
