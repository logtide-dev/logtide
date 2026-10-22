<script lang="ts">
  // Logs explorer (spec 5.4). The page owns the explorer state: the committed
  // query, the scope (shared scope store), a run window frozen at query time,
  // the loaded rows and the cursor. Every filter is a clause of `q`, so the URL,
  // the export and the details actions all carry exactly the same query.
  import { onMount, onDestroy, tick } from "svelte";
  import { get, type Writable } from "svelte/store";
  import { goto, afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import {
    parseLogQuery,
    TIME_RANGE_LABELS,
    type LogSearchQuery,
    type Project,
    type TimeRangePreset,
  } from "@logtide/shared";
  import { currentOrganization } from "$lib/stores/organization";
  import { authStore } from "$lib/stores/auth";
  import { shortcutsStore } from "$lib/stores/shortcuts";
  import { toastStore } from "$lib/stores/toast";
  import { layoutStore } from "$lib/stores/layout";
  import { displayPreferences } from "$lib/stores/display-preferences";
  import { scopeStore, resolveRange, type Scope } from "$lib/stores/scope";
  import { createColumnConfigStore, type ColumnConfigStore } from "$lib/stores/column-config";
  import { formatRange, formatTimestamp } from "$lib/utils/datetime";
  import { ProjectsAPI } from "$lib/api/projects";
  import { logsAPI, LogQueryError, type LogEntry } from "$lib/api/logs";
  import { correlationAPI, type IdentifierMatch } from "$lib/api/correlation";
  import PageHeader from "$lib/components/app/PageHeader.svelte";
  import EmptyState from "$lib/components/app/EmptyState.svelte";
  import ScopeBar from "$lib/components/app/ScopeBar.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
  import EmptyLogs from "$lib/components/EmptyLogs.svelte";
  import TerminalLogView from "$lib/components/TerminalLogView.svelte";
  import LogContextDialog from "$lib/components/LogContextDialog.svelte";
  import CorrelationTimelineDialog from "$lib/components/CorrelationTimelineDialog.svelte";
  import LogQueryBar from "$lib/components/search/LogQueryBar.svelte";
  import LogResultsTable from "$lib/components/search/LogResultsTable.svelte";
  import LogDetailsPanel from "$lib/components/search/LogDetailsPanel.svelte";
  import ColumnConfigMenu from "$lib/components/search/ColumnConfigMenu.svelte";
  import {
    DEFAULT_BUILTIN_LAYOUT,
    createBuiltinColumnsStore,
    visibleColumns,
    type BuiltinColumnLayout,
  } from "$lib/components/search/builtin-columns";
  import { createRequestGuard } from "$lib/components/search/request-guard";
  import { resolveResultsState } from "$lib/components/search/results-state";
  import { activeProjectKey, rowKey } from "$lib/components/search/log-fields";
  import { isQueryableKey, toggleFieldValue } from "$lib/components/search/query-edit";
  import {
    LOGS_PATH,
    buildExplorerUrl,
    parseExplorerUrl,
    type ExplorerState,
    type ExplorerView,
  } from "$lib/components/search/explorer-url";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Rows3 from "@lucide/svelte/icons/rows-3";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import Table2 from "@lucide/svelte/icons/table-2";
  import WrapText from "@lucide/svelte/icons/wrap-text";

  const PAGE_SIZE = 50;
  const MAX_LOADED_ROWS = 5000;
  const VIEW_KEY = "logtide_view_mode";
  const DENSITY_KEY = "logtide_row_density";
  const RESULTS_HEIGHT = "max(420px, calc(100dvh - 22rem))";

  /** One query execution: the window is resolved once and reused by every page of it. */
  interface Run {
    q: string;
    query: LogSearchQuery;
    projectIds: string[];
    from: Date;
    to: Date;
    asOf: Date;
    preset: TimeRangePreset | null;
  }

  const projectsAPI = new ProjectsAPI(() => get(authStore).token);
  const logsGuard = createRequestGuard();

  let projects = $state.raw<Project[]>([]);
  let projectsFailed = $state(false);
  /** Projects that ever received a log (data availability); null while unknown. */
  let projectsWithLogs = $state.raw<string[] | null>(null);
  let scope = $state.raw<Scope>(scopeStore.get());

  let q = $state("");
  let draftQ = $state("");
  let view = $state<ExplorerView>("table");
  let rows = $state.raw<LogEntry[]>([]);
  let total = $state<number | null>(null);
  let nextCursor = $state<string | null>(null);
  let run = $state.raw<Run | null>(null);
  let hasRun = $state(false);
  let loading = $state(false);
  let loadingMore = $state(false);
  let error = $state<string | null>(null);
  let queryError = $state<{ message: string; position: number } | null>(null);
  let capped = $state(false);

  let selectedId = $state<string | null>(null);
  let detailsLog = $state.raw<LogEntry | null>(null);
  let logId = $state<string | null>(null);
  let logProjectId = $state<string | null>(null);
  let savedId = $state<string | null>(null);
  let centerOnId = $state<string | null>(null);
  let identifiers = $state.raw<Map<string, IdentifierMatch[]>>(new Map());

  let density = $state<"comfortable" | "compact">("comfortable");
  let terminalWrap = $state(true);
  let maxWidthClass = $state("max-w-7xl");
  let containerPadding = $state("px-6 py-8");
  let resultsTable = $state<{ reveal(id: string): void; scrollToTop(): void } | null>(null);

  let contextOpen = $state(false);
  let contextLog = $state.raw<LogEntry | null>(null);
  let correlation = $state.raw<{ log: LogEntry; type: string; value: string } | null>(null);

  let layout = $state.raw<BuiltinColumnLayout>(DEFAULT_BUILTIN_LAYOUT);
  let customColumns = $state.raw<string[]>([]);

  // Plain variables: bookkeeping that never renders.
  let initialized = false;
  let orgId: string | null = null;
  let lastWrittenUrl: string | null = null;
  let scopeKeySeen = scopeKey(scopeStore.get());
  let projectsSeq = 0;
  const identifierRequests = new Set<string>();
  const builtinStores = new Map<string, Writable<BuiltinColumnLayout>>();
  const columnStores = new Map<string, ColumnConfigStore>();

  const scopeProjects = $derived(projects.map((p) => ({ id: p.id, name: p.name })));
  const resolvedIds = $derived(resolveIds(scope.projectIds, projects));
  const projectKey = $derived(activeProjectKey(resolvedIds) ?? "all");
  const selectedIndex = $derived(
    selectedId === null ? -1 : rows.findIndex((log, i) => rowKey(log, i) === selectedId),
  );
  const highlightQuery = $derived(run ? run.query : null);
  const everReceivedLogs = $derived.by(() => {
    if (projectsWithLogs === null || !run) return null;
    const withLogs = projectsWithLogs;
    return run.projectIds.some((id) => withLogs.includes(id));
  });
  const resultsState = $derived(
    resolveResultsState({
      hasRun,
      loading,
      error,
      rowCount: rows.length,
      projectCount: projects.length,
      everReceivedLogs,
    }),
  );
  const countText = $derived.by(() => {
    const n = total ?? rows.length;
    return `${n.toLocaleString("en-US")} ${n === 1 ? "log" : "logs"}`;
  });
  const asOfText = $derived.by(() => {
    $displayPreferences;
    return run ? formatTimestamp(run.asOf, { precision: "second", withDate: false }) : "";
  });
  const asOfTitle = $derived.by(() => {
    $displayPreferences;
    return run ? formatTimestamp(run.asOf, { precision: "second", withDate: true, withZone: true }) : "";
  });
  const rangePhrase = $derived.by(() => {
    $displayPreferences;
    if (!run) return "";
    return run.preset ? `the ${TIME_RANGE_LABELS[run.preset].toLowerCase()}` : formatRange(run.from, run.to);
  });
  const hasMore = $derived(nextCursor !== null && !capped);

  function scopeKey(s: Scope): string {
    return JSON.stringify([s.projectIds, s.range]);
  }

  /** Scope ids present in the organization, or every project when none is. */
  function resolveIds(ids: string[], list: Project[]): string[] {
    const valid = new Set(list.map((p) => p.id));
    const inOrg = ids.filter((id) => valid.has(id));
    return inOrg.length > 0 ? inOrg : list.map((p) => p.id);
  }

  /** Same rule as the scope bar in multi mode: unknown ids dropped, every project = []. */
  function normalizeIds(ids: string[]): string[] {
    if (projects.length === 0) return ids;
    const valid = new Set(projects.map((p) => p.id));
    const kept = ids.filter((id) => valid.has(id));
    return kept.length === projects.length ? [] : kept;
  }

  /** Changes the scope without the store subscription starting another run. */
  function setScope(next: Scope) {
    scopeKeySeen = scopeKey(next);
    scope = next;
    scopeStore.set(next);
  }

  function builtinStoreFor(key: string): Writable<BuiltinColumnLayout> {
    let store = builtinStores.get(key);
    if (!store) {
      store = createBuiltinColumnsStore(key);
      builtinStores.set(key, store);
    }
    return store;
  }

  function columnStoreFor(key: string): ColumnConfigStore {
    let store = columnStores.get(key);
    if (!store) {
      store = createColumnConfigStore(key);
      columnStores.set(key, store);
    }
    return store;
  }

  $effect(() => builtinStoreFor(projectKey).subscribe((value) => (layout = value)));
  $effect(() => columnStoreFor(projectKey).subscribe((value) => (customColumns = value)));
  $effect(() => layoutStore.subscribe((s) => (terminalWrap = s.terminalWrapEnabled)));
  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  function currentState(): ExplorerState {
    return {
      q,
      projectIds: scope.projectIds,
      range: scope.range,
      view,
      live: false,
      logId,
      logProjectId,
      savedId,
    };
  }

  /** Writes the canonical URL of the current state (replaceState, no scroll). */
  function writeUrl() {
    if (!initialized) return;
    const next = buildExplorerUrl(currentState());
    lastWrittenUrl = next;
    if (`${page.url.pathname}${page.url.search}` === next) return;
    goto(next, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function cursorOf(res: { hasMore?: boolean; nextCursor?: string }): string | null {
    if (res.hasMore === false) return null;
    return res.nextCursor ?? null;
  }

  function errorText(e: unknown): string {
    return e instanceof Error && e.message ? e.message : "The request failed";
  }

  /** Runs the committed query over a window frozen now; resolves true when page 1 was applied. */
  async function startRun(): Promise<boolean> {
    const parsed = parseLogQuery(q);
    if (parsed.ok === false) {
      queryError = { message: parsed.error.message, position: parsed.error.position };
      return false;
    }
    queryError = null;
    hasRun = true;
    error = null;
    capped = false;
    nextCursor = null;
    loadingMore = false;
    const asOf = new Date();
    const { from, to } = resolveRange(scope.range, asOf);
    const ids = resolveIds(scope.projectIds, projects);
    const r: Run = {
      q,
      query: parsed.query,
      projectIds: ids,
      from,
      to,
      asOf,
      preset: scope.range.kind === "preset" ? scope.range.preset : null,
    };
    run = r;
    const token = logsGuard.begin();

    if (projectsFailed) {
      rows = [];
      total = null;
      loading = false;
      error = "Could not load the projects of this organization.";
      return false;
    }
    if (ids.length === 0) {
      rows = [];
      total = 0;
      loading = false;
      return true;
    }

    loading = true;
    try {
      const res = await logsAPI.getLogs({
        projectId: ids,
        q: r.q || undefined,
        from: from.toISOString(),
        to: to.toISOString(),
        limit: PAGE_SIZE,
      });
      if (!logsGuard.isCurrent(token)) return false;
      rows = Array.isArray(res.logs) ? res.logs : [];
      total = typeof res.total === "number" ? res.total : null;
      nextCursor = cursorOf(res);
      return true;
    } catch (e) {
      if (!logsGuard.isCurrent(token)) return false;
      if (e instanceof LogQueryError) {
        // The rows of the previous query stay; the bar underlines the clause.
        queryError = { message: e.message, position: e.position };
      } else {
        rows = [];
        total = null;
        error = errorText(e);
      }
      return false;
    } finally {
      if (logsGuard.isCurrent(token)) loading = false;
    }
  }

  /** Next page of the current run: same window, the cursor of the last page. */
  async function loadMore(): Promise<boolean> {
    const r = run;
    const cursor = nextCursor;
    if (!r || !cursor || loading || loadingMore || capped) return false;
    if (rows.length >= MAX_LOADED_ROWS) {
      capped = true;
      return false;
    }
    const token = logsGuard.current();
    if (!logsGuard.isCurrent(token)) return false;
    loadingMore = true;
    try {
      const res = await logsAPI.getLogs({
        projectId: r.projectIds,
        q: r.q || undefined,
        from: r.from.toISOString(),
        to: r.to.toISOString(),
        limit: PAGE_SIZE,
        cursor,
      });
      if (!logsGuard.isCurrent(token)) return false;
      const merged = [...rows, ...(Array.isArray(res.logs) ? res.logs : [])];
      rows = merged.length > MAX_LOADED_ROWS ? merged.slice(0, MAX_LOADED_ROWS) : merged;
      nextCursor = cursorOf(res);
      if (nextCursor && rows.length >= MAX_LOADED_ROWS) capped = true;
      return true;
    } catch {
      if (!logsGuard.isCurrent(token)) return false;
      toastStore.error("Could not load more logs");
      return false;
    } finally {
      if (logsGuard.isCurrent(token)) loadingMore = false;
    }
  }

  function refresh() {
    void startRun();
  }

  async function retry() {
    if (projectsFailed && orgId) {
      const ok = await loadProjects(orgId);
      if (!ok) return;
    }
    void startRun();
  }

  function handleSubmit(next: string) {
    q = next.trim();
    void startRun();
    writeUrl();
  }

  function clearQuery() {
    q = "";
    draftQ = "";
    void startRun();
    writeUrl();
  }

  /** Facet, chip and badge clicks: toggle one value of `key` in the committed query. */
  function applyFieldToggle(key: string, value: string, mode: "include" | "exclude") {
    if (!isQueryableKey(key)) {
      toastStore.error("This field cannot be used in a query");
      return;
    }
    const next = toggleFieldValue(q, key, value, mode);
    if (next === q) {
      toastStore.error("This filter cannot be combined with the current query");
      return;
    }
    q = next;
    draftQ = next;
    void startRun();
    writeUrl();
  }

  function filterProject(projectId: string) {
    scopeStore.setProjects([projectId]);
  }

  function setView(next: ExplorerView) {
    if (view === next) return;
    view = next;
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // storage blocked: the URL still carries the view
    }
    writeUrl();
  }

  function toggleDensity() {
    density = density === "comfortable" ? "compact" : "comfortable";
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // storage blocked
    }
  }

  function sameLog(a: LogEntry | null, b: LogEntry | null): boolean {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    return a === b;
  }

  async function loadIdentifiers(id: string) {
    if (identifiers.has(id) || identifierRequests.has(id)) return;
    identifierRequests.add(id);
    let list: IdentifierMatch[] = [];
    try {
      list = await correlationAPI.getLogIdentifiers(id);
    } catch {
      list = [];
    } finally {
      identifierRequests.delete(id);
    }
    identifiers = new Map(identifiers).set(id, Array.isArray(list) ? list : []);
  }

  function openDetails(log: LogEntry) {
    const index = rows.indexOf(log);
    if (index >= 0) selectedId = rowKey(log, index);
    detailsLog = log;
    if (log.id) void loadIdentifiers(log.id);
  }

  function closeDetails() {
    detailsLog = null;
  }

  function toggleSelectedDetails() {
    const index = selectedIndex;
    if (index < 0) return;
    const log = rows[index];
    if (sameLog(detailsLog, log)) closeDetails();
    else openDetails(log);
  }

  async function moveSelection(delta: 1 | -1) {
    if (rows.length === 0) return;
    const current = selectedIndex;
    const next = current < 0 ? 0 : Math.min(Math.max(current + delta, 0), rows.length - 1);
    const key = rowKey(rows[next], next);
    selectedId = key;
    if (delta > 0 && rows.length - 1 - next < 5) void loadMore();
    await tick();
    if (view === "table") resultsTable?.reveal(key);
  }

  function openContext(log: LogEntry) {
    contextLog = log;
    contextOpen = true;
  }

  function closeContext() {
    contextOpen = false;
    contextLog = null;
  }

  function searchRange(preset: TimeRangePreset) {
    scopeStore.setRange({ kind: "preset", preset });
  }

  /** Applies a logs URL (first load or a link from another page) and runs it. */
  function applyUrl(url: URL) {
    initialized = true;
    const parsed = parseExplorerUrl(url);
    setScope({
      projectIds: parsed.scope.projectIds ? normalizeIds(parsed.scope.projectIds) : scope.projectIds,
      range: parsed.scope.range ?? scope.range,
    });
    q = parsed.q;
    draftQ = parsed.q;
    if (parsed.view) view = parsed.view;
    savedId = parsed.savedId;
    logId = null;
    logProjectId = null;
    detailsLog = null;
    selectedId = null;
    centerOnId = null;
    void startRun();
    writeUrl();
  }

  afterNavigate((nav) => {
    const url = nav.to?.url;
    if (!url || !initialized || url.pathname !== LOGS_PATH) return;
    const path = `${url.pathname}${url.search}`;
    if (path === lastWrittenUrl) return;
    const parsed = parseExplorerUrl(url);
    const candidate: ExplorerState = {
      q: parsed.q,
      projectIds: parsed.scope.projectIds ? normalizeIds(parsed.scope.projectIds) : scope.projectIds,
      range: parsed.scope.range ?? scope.range,
      view: parsed.view ?? view,
      live: parsed.live,
      logId: parsed.logId,
      logProjectId: parsed.logProjectId,
      savedId: parsed.savedId,
    };
    // Our own writes (and the scope bar's) describe the state already shown.
    if (!parsed.legacy && buildExplorerUrl(candidate) === buildExplorerUrl(currentState())) {
      lastWrittenUrl = path;
      return;
    }
    applyUrl(url);
  });

  async function loadProjects(id: string): Promise<boolean> {
    const seq = ++projectsSeq;
    try {
      const [res, availability] = await Promise.all([
        projectsAPI.getProjects(id),
        projectsAPI.getProjectDataAvailability(id).catch(() => null),
      ]);
      if (seq !== projectsSeq) return false;
      projects = Array.isArray(res?.projects) ? res.projects : [];
      projectsWithLogs = Array.isArray(availability?.logs) ? availability.logs : null;
      projectsFailed = false;
    } catch {
      if (seq !== projectsSeq) return false;
      projects = [];
      projectsWithLogs = null;
      projectsFailed = true;
    }
    return true;
  }

  function resetResults() {
    logsGuard.invalidate();
    rows = [];
    total = null;
    nextCursor = null;
    run = null;
    hasRun = false;
    loading = false;
    loadingMore = false;
    error = null;
    capped = false;
    selectedId = null;
    detailsLog = null;
    centerOnId = null;
    identifiers = new Map();
  }

  function handleOrg(id: string | null) {
    if (id === orgId) return;
    orgId = id;
    resetResults();
    if (!id) {
      projects = [];
      projectsWithLogs = null;
      return;
    }
    void loadProjects(id).then((ok) => {
      if (!ok || orgId !== id) return;
      if (!initialized) {
        applyUrl(page.url);
        return;
      }
      void startRun();
      writeUrl();
    });
  }

  function handleScope(next: Scope) {
    scope = next;
    const key = scopeKey(next);
    if (key === scopeKeySeen) return;
    scopeKeySeen = key;
    if (!initialized) return;
    void startRun();
    writeUrl();
  }

  function registerShortcuts() {
    shortcutsStore.setScope("search");
    shortcutsStore.register([
      {
        id: "search:focus",
        combo: "/",
        label: "Focus search input",
        scope: "search",
        category: "search",
        action: () => document.getElementById("search")?.focus(),
      },
      {
        id: "search:refresh",
        combo: "r",
        label: "Refresh results",
        scope: "search",
        category: "actions",
        action: () => refresh(),
      },
      {
        id: "search:next-log",
        combo: "j",
        label: "Next log",
        scope: "search",
        category: "navigation",
        action: () => void moveSelection(1),
      },
      {
        id: "search:prev-log",
        combo: "k",
        label: "Previous log",
        scope: "search",
        category: "navigation",
        action: () => void moveSelection(-1),
      },
      {
        id: "search:expand-log",
        combo: "enter",
        label: "Open or close log details",
        scope: "search",
        category: "actions",
        action: () => toggleSelectedDetails(),
      },
    ]);
  }

  function restorePreferences() {
    try {
      const savedView = sessionStorage.getItem(VIEW_KEY);
      if (savedView === "table" || savedView === "terminal") view = savedView;
    } catch {
      // storage blocked
    }
    try {
      const savedDensity = localStorage.getItem(DENSITY_KEY);
      if (savedDensity === "compact" || savedDensity === "comfortable") density = savedDensity;
    } catch {
      // storage blocked
    }
  }

  onMount(() => {
    registerShortcuts();
    restorePreferences();
    const unsubScope = scopeStore.subscribe(handleScope);
    const unsubOrg = currentOrganization.subscribe((org) => handleOrg(org?.id ?? null));
    return () => {
      unsubOrg();
      unsubScope();
    };
  });

  onDestroy(() => {
    logsGuard.invalidate();
    shortcutsStore.unregisterScope("search");
  });
</script>

<svelte:head>
  <title>Logs - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Logs" description="Search, filter and tail logs across your projects">
    {#snippet actions()}
      <ScopeBar mode="multi" projects={scopeProjects} />
    {/snippet}
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-start gap-2">
    <div class="min-w-[280px] flex-1">
      <LogQueryBar
        bind:value={draftQ}
        fields={[]}
        valuesFor={() => []}
        serverError={queryError}
        onSubmit={handleSubmit}
      />
    </div>
  </div>

  <div class="grid items-start gap-4 {detailsLog ? 'xl:grid-cols-[minmax(0,1fr)_26rem]' : ''}">
    <section aria-label="Results" class="min-w-0 rounded-lg border bg-card text-card-foreground">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {#if resultsState === "results"}
            <span class="font-medium">{countText}</span>
          {/if}
          {#if run && run.preset && hasRun}
            <span class="text-muted-foreground" title={asOfTitle}>Results as of {asOfText}</span>
            <Button
              variant="ghost"
              size="icon"
              class="size-7"
              aria-label="Refresh results"
              title="Refresh results"
              onclick={refresh}
            >
              <RefreshCw class="size-3.5" />
            </Button>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="inline-flex rounded-md border border-input bg-background" role="group" aria-label="View">
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="sm"
              class="gap-1.5 rounded-r-none border-r"
              aria-pressed={view === "table"}
              onclick={() => setView("table")}
            >
              <Table2 class="size-4" />
              <span>Table</span>
            </Button>
            <Button
              variant={view === "terminal" ? "secondary" : "ghost"}
              size="sm"
              class="gap-1.5 rounded-l-none"
              aria-pressed={view === "terminal"}
              onclick={() => setView("terminal")}
            >
              <SquareTerminal class="size-4" />
              <span>Terminal</span>
            </Button>
          </div>
          {#if view === "terminal"}
            <Button
              variant="ghost"
              size="sm"
              class="gap-1.5"
              aria-pressed={terminalWrap}
              title={terminalWrap ? "Turn off line wrapping" : "Wrap long lines"}
              onclick={() => layoutStore.toggleTerminalWrap()}
            >
              <WrapText class="size-4 {terminalWrap ? 'text-primary' : 'text-muted-foreground'}" />
              <span>Wrap lines</span>
            </Button>
          {:else}
            <Button
              variant="outline"
              size="sm"
              class="gap-1.5"
              aria-pressed={density === "compact"}
              title={density === "compact" ? "Use comfortable rows" : "Use compact rows"}
              onclick={toggleDensity}
            >
              <Rows3 class="size-4" />
              <span>Compact rows</span>
            </Button>
            <ColumnConfigMenu
              columns={customColumns}
              onchange={(cols) => columnStoreFor(projectKey).set(cols)}
              {layout}
              onLayoutChange={(next) => builtinStoreFor(projectKey).set(next)}
            />
          {/if}
        </div>
      </div>

      <div class="p-3">
        {#if resultsState === "loading"}
          <SkeletonTable rows={8} columns={6} />
        {:else if resultsState === "error"}
          <EmptyState variant="error" title="Could not load logs" description={error ?? undefined}>
            {#snippet actions()}
              <Button variant="outline" size="sm" onclick={retry}>Retry</Button>
            {/snippet}
          </EmptyState>
        {:else if resultsState === "onboarding"}
          <EmptyLogs />
        {:else if resultsState === "no-results"}
          <EmptyState
            variant="no-results"
            title="No logs match in {rangePhrase}"
            description="Try a wider time range or a simpler query."
          >
            {#snippet actions()}
              {#if run?.preset !== "24h"}
                <Button variant="outline" size="sm" onclick={() => searchRange("24h")}>Search last 24h</Button>
              {/if}
              {#if run?.preset !== "7d"}
                <Button variant="outline" size="sm" onclick={() => searchRange("7d")}>Search last 7d</Button>
              {/if}
              {#if q}
                <Button variant="ghost" size="sm" onclick={clearQuery}>Clear</Button>
              {/if}
            {/snippet}
          </EmptyState>
        {:else}
          <TableLoadingOverlay {loading}>
            {#if view === "terminal"}
              <TerminalLogView
                logs={rows}
                maxHeight={RESULTS_HEIGHT}
                {selectedId}
                onSelect={(log) => openDetails(log)}
              />
            {:else}
              <LogResultsTable
                bind:this={resultsTable}
                logs={rows}
                projects={scopeProjects}
                columns={visibleColumns(layout)}
                {customColumns}
                {density}
                {selectedId}
                {highlightQuery}
                {hasMore}
                {loadingMore}
                {centerOnId}
                onSelect={(log) => openDetails(log)}
                onFilter={(key, value) => applyFieldToggle(key, value, "include")}
                onProjectFilter={filterProject}
                onLoadMore={() => void loadMore()}
              />
            {/if}
          </TableLoadingOverlay>
          {#if capped}
            <p role="status" class="mt-2 text-center text-xs text-muted-foreground">
              Showing the newest {MAX_LOADED_ROWS.toLocaleString("en-US")} logs. Narrow the time range or the query to see
              older ones.
            </p>
          {/if}
        {/if}
      </div>
    </section>

    {#if detailsLog}
      <div
        class="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col bg-background p-2 shadow-lg xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:h-[calc(100dvh-10rem)] xl:max-w-none xl:bg-transparent xl:p-0 xl:shadow-none"
      >
        <LogDetailsPanel
          log={detailsLog}
          projectName={projects.find((p) => p.id === detailsLog?.projectId)?.name ?? detailsLog.projectId}
          identifiers={(detailsLog.id && identifiers.get(detailsLog.id)) || []}
          organizationId={$currentOrganization?.id ?? ""}
          onClose={closeDetails}
          onFilter={() => {}}
          onProjectFilter={filterProject}
          onAddColumn={() => {}}
          onOpenContext={(log) => openContext(log)}
          onOpenCorrelation={(log, type, value) => (correlation = { log, type, value })}
        />
      </div>
    {/if}
  </div>
</div>

<LogContextDialog
  open={contextOpen}
  projectId={contextLog?.projectId ?? ""}
  organizationId={$currentOrganization?.id ?? ""}
  selectedLog={contextLog}
  onClose={closeContext}
/>

<CorrelationTimelineDialog
  open={correlation !== null}
  projectId={correlation?.log.projectId ?? resolvedIds[0] ?? ""}
  identifierType={correlation?.type ?? ""}
  identifierValue={correlation?.value ?? ""}
  referenceTime={correlation?.log.time}
  onClose={() => (correlation = null)}
  onLogClick={(correlated) => {
    correlation = null;
    openContext({
      id: correlated.id,
      time: correlated.time,
      service: correlated.service,
      level: correlated.level as LogEntry["level"],
      message: correlated.message,
      metadata: correlated.metadata ?? null,
      traceId: correlated.traceId ?? null,
      projectId: correlated.projectId || "",
    });
  }}
/>
