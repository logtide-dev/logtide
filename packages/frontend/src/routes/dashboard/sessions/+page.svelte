<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { layoutStore } from '$lib/stores/layout';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { ProjectsAPI } from '$lib/api/projects';
  import { sessionsAPI, type SessionSummary } from '$lib/api/sessions';
  import { formatDuration } from '$lib/utils/format-duration';

  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import DataTable from '$lib/components/app/DataTable.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import SessionFilters from '$lib/components/sessions/SessionFilters.svelte';
  import type { DataTableColumn } from '$lib/components/app/data-table';
  import Button from '$lib/components/ui/button/button.svelte';

  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  const PAGE_SIZE = 25;

  // Layout
  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-8 py-8');
  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  // Projects
  let token = $state<string | null>(null);
  $effect(() => authStore.subscribe((s) => (token = s.token)));
  let projectsAPI = $derived(new ProjectsAPI(() => token));

  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);
  let projectsError = $state<string | null>(null);
  let projectsRequest = 0;

  $effect(() => {
    const org = $currentOrganization;
    const api = projectsAPI;
    if (!org) return;
    const request = ++projectsRequest;
    projectsLoaded = false;
    projectsError = null;
    (async () => {
      try {
        const res = await api.getProjects(org.id);
        if (request !== projectsRequest) return;
        projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
      } catch (e) {
        if (request !== projectsRequest) return;
        projects = [];
        projectsError = e instanceof Error ? e.message : 'Could not load projects';
      } finally {
        if (request === projectsRequest) projectsLoaded = true;
      }
    })();
  });

  // Filters live in the URL (errors, service); local state mirrors them.
  function readErrors(): '' | '0' | '1' {
    const v = page.url.searchParams.get('errors');
    return v === '1' || v === '0' ? v : '';
  }
  let errors = $state<'' | '0' | '1'>(readErrors());
  let service = $state(page.url.searchParams.get('service') ?? '');

  // External navigation (back button, links) updates the filters.
  $effect(() => {
    const nextErrors = readErrors();
    const nextService = page.url.searchParams.get('service') ?? '';
    untrack(() => {
      if (nextErrors !== errors) errors = nextErrors;
      if (nextService !== service) service = nextService;
    });
  });

  function handleFilterChange(patch: { service?: string; errors?: '' | '0' | '1' }) {
    if (patch.service !== undefined) service = patch.service;
    if (patch.errors !== undefined) errors = patch.errors;
    const url = new URL(page.url);
    if (service) url.searchParams.set('service', service);
    else url.searchParams.delete('service');
    if (errors) url.searchParams.set('errors', errors);
    else url.searchParams.delete('errors');
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // Data
  let sessions = $state<SessionSummary[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let nextCursor = $state<string | undefined>(undefined);
  let cursors = $state<(string | undefined)[]>([undefined]);
  let pageIndex = $state(0);
  let refreshTick = $state(0);
  let bounds: { from: Date; to: Date } | null = null;
  let request = 0;

  let projectId = $derived($scopeStore.projectIds[0] ?? null);

  async function load() {
    const id = projectId;
    if (!id || !bounds) return;
    const token = ++request;
    loading = true;
    loadError = null;
    try {
      const result = await sessionsAPI.listSessions({
        projectId: id,
        from: bounds.from.toISOString(),
        to: bounds.to.toISOString(),
        hasErrors: errors === '' ? undefined : errors === '1',
        service: service || undefined,
        limit: PAGE_SIZE,
        cursor: cursors[pageIndex],
      });
      if (token !== request) return;
      sessions = result.sessions;
      nextCursor = result.nextCursor;
    } catch (e) {
      if (token !== request) return;
      sessions = [];
      nextCursor = undefined;
      loadError = e instanceof Error ? e.message : 'Could not load sessions';
    } finally {
      if (token === request) loading = false;
    }
  }

  // Reload on any change of project, range, filters or Refresh. Preset ranges
  // resolve against "now", so bounds are recomputed only for a real change.
  let lastBaseKey = '';
  $effect(() => {
    const scope = $scopeStore;
    const key = JSON.stringify([scope.projectIds[0] ?? null, scope.range, errors, service, refreshTick]);
    if (key === lastBaseKey) return;
    lastBaseKey = key;
    if (!scope.projectIds[0]) {
      untrack(() => {
        sessions = [];
        nextCursor = undefined;
      });
      return;
    }
    bounds = resolveRange(scope.range);
    untrack(() => {
      cursors = [undefined];
      pageIndex = 0;
      void load();
    });
  });

  function goNext() {
    if (!nextCursor || loading) return;
    cursors = [...cursors.slice(0, pageIndex + 1), nextCursor];
    pageIndex += 1;
    void load();
  }

  function goPrevious() {
    if (pageIndex === 0 || loading) return;
    pageIndex -= 1;
    void load();
  }

  function sessionHref(s: SessionSummary): string {
    return `/dashboard/sessions/${encodeURIComponent(s.sessionId)}?project=${encodeURIComponent(projectId ?? '')}`;
  }

  function shortId(id: string): string {
    return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
  }

  function deviceText(s: SessionSummary): string {
    return [s.os, s.device].filter(Boolean).join(' / ');
  }

  // Row click: follow the row's session link unless the click hit a control.
  function onTableClick(e: MouseEvent) {
    const target = e.target as Element | null;
    if (!target || target.closest('a, button, input')) return;
    const link = target.closest('tr')?.querySelector<HTMLAnchorElement>('a[data-session-link]');
    const href = link?.getAttribute('href');
    if (href) goto(href);
  }

  // Optional columns appear only when at least one row in the page has a value.
  let hasBrowser = $derived(sessions.some((s) => s.browser));
  let hasDevice = $derived(sessions.some((s) => s.os || s.device));
  let hasEntry = $derived(sessions.some((s) => s.entryUrl));
  let hasUser = $derived(sessions.some((s) => s.user));

  // The snippet type resolved from this file differs nominally from the one in
  // DataTableColumn (two copies of the svelte types), hence the cast.
  const asCell = (snippet: unknown) => snippet as DataTableColumn<SessionSummary>['cell'];

  let columns = $derived.by(() => {
    const cols: DataTableColumn<SessionSummary>[] = [
      { key: 'session', header: 'Session', cell: asCell(sessionCell) },
      { key: 'started', header: 'Started', cell: asCell(startedCell) },
      { key: 'duration', header: 'Duration', cell: asCell(durationCell) },
      { key: 'events', header: 'Events', class: 'text-right', cell: asCell(eventsCell) },
      { key: 'errors', header: 'Errors', cell: asCell(errorsCell) },
      { key: 'service', header: 'Service', cell: asCell(serviceCell) },
    ];
    if (hasBrowser) cols.push({ key: 'browser', header: 'Browser', cell: asCell(browserCell) });
    if (hasDevice) cols.push({ key: 'device', header: 'OS and device', cell: asCell(deviceCell) });
    if (hasEntry) cols.push({ key: 'entry', header: 'Entry URL', class: 'max-w-[260px]', cell: asCell(entryCell) });
    if (hasUser) cols.push({ key: 'user', header: 'User', cell: asCell(userCell) });
    return cols;
  });

  let filtersActive = $derived(errors !== '' || service !== '');
</script>

{#snippet sessionCell(s: SessionSummary)}
  <span class="inline-flex items-center gap-1">
    <a
      href={sessionHref(s)}
      data-session-link
      class="font-mono text-sm text-primary hover:underline"
      title={s.sessionId}>{shortId(s.sessionId)}</a
    >
    <CopyButton value={s.sessionId} ariaLabel="Copy session ID" />
  </span>
{/snippet}

{#snippet startedCell(s: SessionSummary)}
  <Timestamp value={s.firstEvent} precision="second" />
{/snippet}

{#snippet durationCell(s: SessionSummary)}
  <span class="whitespace-nowrap">{formatDuration(s.durationMs)}</span>
{/snippet}

{#snippet eventsCell(s: SessionSummary)}
  <span>{s.eventCount.toLocaleString('en-US')}</span>
{/snippet}

{#snippet errorsCell(s: SessionSummary)}
  {#if s.errorCount > 0}
    <span class="inline-flex items-center gap-1.5">
      <SeverityBadge kind="level" value="error" />
      <span class="text-sm">{s.errorCount.toLocaleString('en-US')}</span>
    </span>
  {/if}
{/snippet}

{#snippet serviceCell(s: SessionSummary)}
  <span>{s.service}</span>
{/snippet}

{#snippet browserCell(s: SessionSummary)}
  <span>{s.browser ?? ''}</span>
{/snippet}

{#snippet deviceCell(s: SessionSummary)}
  <span>{deviceText(s)}</span>
{/snippet}

{#snippet entryCell(s: SessionSummary)}
  <span class="block truncate font-mono text-xs" title={s.entryUrl}>{s.entryUrl ?? ''}</span>
{/snippet}

{#snippet userCell(s: SessionSummary)}
  <span>{s.user ?? ''}</span>
{/snippet}

<svelte:head>
  <title>Sessions - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Sessions" description="Browser sessions recorded by the SDK">
    {#snippet actions()}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="gap-2"
        disabled={!projectId || loading}
        onclick={() => (refreshTick += 1)}
      >
        <RefreshCw class="h-4 w-4" aria-hidden="true" />
        Refresh
      </Button>
    {/snippet}
  </PageHeader>

  {#if !projectsLoaded}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading projects</div>
  {:else if projectsError}
    <EmptyState variant="error" title="Could not load projects" description={projectsError} />
  {:else if projects.length === 0}
    <EmptyState
      variant="setup"
      title="No projects yet"
      description="Create a project and connect the browser SDK to record sessions."
    />
  {:else}
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <ScopeBar mode="single" {projects} />
      <SessionFilters {service} {errors} onChange={handleFilterChange} />
    </div>

    {#if !projectId}
      <EmptyState
        variant="no-data"
        title="No project selected"
        description="Select a project to see its sessions."
      />
    {:else if loadError}
      <EmptyState variant="error" title="Could not load sessions" description={loadError}>
        {#snippet actions()}
          <Button type="button" variant="outline" size="sm" onclick={() => void load()}>Retry</Button>
        {/snippet}
      </EmptyState>
    {:else if !loading && sessions.length === 0}
      {#if filtersActive}
        <EmptyState
          variant="no-results"
          title="No sessions match these filters"
          description="Try a wider time range or clear the filters."
        />
      {:else}
        <EmptyState
          variant="setup"
          title="No sessions in this time range"
          description="Sessions appear when the browser SDK sends logs with a session ID. Set up @logtide/browser in your app, then reload this page."
        />
      {/if}
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="rounded-md border [&_tbody_tr]:cursor-pointer" onclick={onTableClick}>
        <DataTable {columns} rows={sessions} rowKey={(s: SessionSummary) => s.sessionId} {loading} />
      </div>

      <div class="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {(pageIndex + 1).toLocaleString('en-US')}</span>
        <div class="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pageIndex === 0 || loading} onclick={goPrevious}>
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!nextCursor || loading} onclick={goNext}>
            Next
          </Button>
        </div>
      </div>
    {/if}
  {/if}
</div>
