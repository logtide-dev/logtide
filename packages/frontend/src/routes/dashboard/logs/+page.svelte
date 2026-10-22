<script lang="ts">
  // Logs explorer (spec 5.4). The page owns the explorer state: the committed
  // query, the scope (shared scope store), a run window frozen at query time,
  // the loaded rows and the cursor. Every filter is a clause of `q`, so the URL,
  // saved searches, the export and the alert pre-fill carry the same query.
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
  import { checklistStore } from "$lib/stores/checklist";
  import { toastStore } from "$lib/stores/toast";
  import { layoutStore } from "$lib/stores/layout";
  import { displayPreferences } from "$lib/stores/display-preferences";
  import {
    scopeStore,
    resolveRange,
    sanitizeRange,
    type Scope,
    type TimeRangeValue,
  } from "$lib/stores/scope";
  import { createColumnConfigStore, type ColumnConfigStore } from "$lib/stores/column-config";
  import { formatRange, formatTimestamp } from "$lib/utils/datetime";
  import { copyToClipboard } from "$lib/utils/clipboard";
  import { ProjectsAPI } from "$lib/api/projects";
  import {
    logsAPI,
    LogQueryError,
    type LogEntry,
    type LogFacet,
    type LogFieldInfo,
    type LogHistogramBucket,
  } from "$lib/api/logs";
  import { correlationAPI, type IdentifierMatch } from "$lib/api/correlation";
  import type { SavedSearch, SavedSearchState } from "$lib/api/saved-searches";
  import PageHeader from "$lib/components/app/PageHeader.svelte";
  import EmptyState from "$lib/components/app/EmptyState.svelte";
  import ScopeBar from "$lib/components/app/ScopeBar.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as Popover from "$lib/components/ui/popover";
  import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
  import EmptyLogs from "$lib/components/EmptyLogs.svelte";
  import TerminalLogView from "$lib/components/TerminalLogView.svelte";
  import LogContextDialog from "$lib/components/LogContextDialog.svelte";
  import CorrelationTimelineDialog from "$lib/components/CorrelationTimelineDialog.svelte";
  import ExportLogsDialog from "$lib/components/ExportLogsDialog.svelte";
  import LogQueryBar from "$lib/components/search/LogQueryBar.svelte";
  import LogResultsTable from "$lib/components/search/LogResultsTable.svelte";
  import LogDetailsPanel from "$lib/components/search/LogDetailsPanel.svelte";
  import LogVolumeHistogram from "$lib/components/search/LogVolumeHistogram.svelte";
  import FacetSidebar from "$lib/components/search/FacetSidebar.svelte";
  import FacetsSheet from "$lib/components/search/FacetsSheet.svelte";
  import { isMobile } from "$lib/stores/media-query";
  import SavedSearchesMenu from "$lib/components/search/SavedSearchesMenu.svelte";
  import LiveTailControls from "$lib/components/search/LiveTailControls.svelte";
  import ColumnConfigMenu from "$lib/components/search/ColumnConfigMenu.svelte";
  import {
    LIVE_TAIL_LIMITS,
    createLiveTail,
    type LiveTail,
    type LiveTailSnapshot,
  } from "$lib/components/search/live-tail";
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
  import { pickBucketSeconds } from "$lib/components/search/histogram";
  import {
    BUILTIN_FACET_KEYS,
    FACET_VALUE_LIMIT,
    facetCandidates,
    selectMetadataFacetKeys,
  } from "$lib/components/search/facet-keys";
  import { createFacetPinsStore, type FacetPinsStore } from "$lib/components/search/facet-pins";
  import {
    clearRecentSearches,
    createRecentRecorder,
    loadRecentSearches,
    recentLabel,
    recordRecentSearch,
    type RecentSearch,
  } from "$lib/components/search/recent-searches";
  import {
    LOGS_PATH,
    LOG_LINK_WINDOW_MS,
    alertPrefillUrl,
    buildExplorerUrl,
    parseExplorerUrl,
    toSavedState,
    type ExplorerState,
    type ExplorerView,
  } from "$lib/components/search/explorer-url";
  import BellPlus from "@lucide/svelte/icons/bell-plus";
  import Download from "@lucide/svelte/icons/download";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Link from "@lucide/svelte/icons/link";
  import ListFilter from "@lucide/svelte/icons/list-filter";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Rows3 from "@lucide/svelte/icons/rows-3";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import Table2 from "@lucide/svelte/icons/table-2";
  import WrapText from "@lucide/svelte/icons/wrap-text";

  const PAGE_SIZE = 50;
  const MAX_LOADED_ROWS = 5000;
  /** Extra pages a `logId` link loads while looking for its log. */
  const MAX_LINK_PAGES = 10;
  const VIEW_KEY = "logtide_view_mode";
  const DENSITY_KEY = "logtide_row_density";
  const FACETS_COLLAPSED_KEY = "logtide_facets_collapsed";
  const LIVE_LIMIT_KEY = "logtide_livetail_limit";
  const DEFAULT_LIVE_LIMIT = 100;
  const RESULTS_HEIGHT = "max(420px, calc(100dvh - 22rem))";

  /** One query execution: the window is resolved once and reused by every page of it. */
  interface Run {
    q: string;
    query: LogSearchQuery;
    projectIds: string[];
    range: TimeRangeValue;
    from: Date;
    to: Date;
    asOf: Date;
    preset: TimeRangePreset | null;
  }

  const projectsAPI = new ProjectsAPI(() => get(authStore).token);
  const logsGuard = createRequestGuard();
  const histogramGuard = createRequestGuard();
  const facetsGuard = createRequestGuard();

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

  let histogramBuckets = $state.raw<LogHistogramBucket[]>([]);
  let histogramBucketSeconds = $state(60);
  let histogramTotal = $state<number | null>(null);
  let histogramLoading = $state(false);
  let histogramError = $state<string | null>(null);

  let facets = $state.raw<LogFacet[]>([]);
  let facetsLoading = $state(false);
  let facetsError = $state<string | null>(null);
  let facetsCollapsed = $state(false);
  /** Phone only: the facets live in a full-height panel opened from the toolbar. */
  let filtersOpen = $state(false);
  let discovered = $state.raw<LogFieldInfo[]>([]);
  let pinnedKeys = $state.raw<string[]>([]);

  let selectedId = $state<string | null>(null);
  let detailsLog = $state.raw<LogEntry | null>(null);
  let logId = $state<string | null>(null);
  let logProjectId = $state<string | null>(null);
  let savedId = $state<string | null>(null);
  let centerOnId = $state<string | null>(null);
  let identifiers = $state.raw<Map<string, IdentifierMatch[]>>(new Map());
  let recent = $state.raw<RecentSearch[]>([]);

  let live = $state(false);
  let liveSnap = $state.raw<LiveTailSnapshot | null>(null);
  let liveLimit = $state(DEFAULT_LIVE_LIMIT);

  let density = $state<"comfortable" | "compact">("comfortable");
  let terminalWrap = $state(true);
  let maxWidthClass = $state("max-w-7xl");
  let containerPadding = $state("px-6 py-8");
  let resultsTable = $state<{ reveal(id: string): void; scrollToTop(): void } | null>(null);
  let terminalView = $state<{ scrollToTop(): void } | null>(null);

  let moreOpen = $state(false);
  let exportOpen = $state(false);
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
  let fieldsKey: string | null = null;
  let projectsSeq = 0;
  let runSeq = 0;
  let tail: LiveTail | null = null;
  let liveTried = false;
  const identifierRequests = new Set<string>();
  const builtinStores = new Map<string, Writable<BuiltinColumnLayout>>();
  const columnStores = new Map<string, ColumnConfigStore>();
  const pinStores = new Map<string, FacetPinsStore>();
  const recorder = createRecentRecorder((state) => {
    recent = recordRecentSearch(state);
  });

  const scopeProjects = $derived(projects.map((p) => ({ id: p.id, name: p.name })));
  const resolvedIds = $derived(resolveIds(scope.projectIds, projects));
  const projectKey = $derived(keyFor(resolvedIds));
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
  const shownTotal = $derived(histogramTotal ?? total);
  const countText = $derived.by(() => {
    const n = live ? rows.length : (shownTotal ?? rows.length);
    return `${n.toLocaleString("en-US")} ${n === 1 ? "log" : "logs"}`;
  });
  const pendingText = $derived.by(() => {
    const n = liveSnap?.pendingCount ?? 0;
    return n === 1 ? "1 new log" : `${n.toLocaleString("en-US")} new logs`;
  });
  const showPendingPill = $derived(live && liveSnap !== null && liveSnap.pausedBy !== null && liveSnap.pendingCount > 0);
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
  const hasMore = $derived(!live && nextCursor !== null && !capped);
  const discoveredKeys = $derived(discovered.map((f) => f.key));
  const candidateKeys = $derived(facetCandidates(discovered));
  const savedState = $derived(toSavedState(currentState(), customColumns));
  const exportScope = $derived(
    run
      ? { q: run.q, projectIds: run.projectIds, from: run.from.toISOString(), to: run.to.toISOString() }
      : { q: "", projectIds: [], from: new Date(0).toISOString(), to: new Date(0).toISOString() },
  );
  const canExport = $derived(!live && run !== null && rows.length > 0);
  const filterClauseCount = $derived.by(() => {
    const parsed = parseLogQuery(q);
    return parsed.ok ? parsed.query.fields.length : 0;
  });
  $effect(() => {
    if (!$isMobile) filtersOpen = false;
  });
  const gridClass = $derived(
    detailsLog
      ? facetsCollapsed
        ? "lg:grid-cols-[2.5rem_minmax(0,1fr)] xl:grid-cols-[2.5rem_minmax(0,1fr)_26rem]"
        : "lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_26rem]"
      : facetsCollapsed
        ? "lg:grid-cols-[2.5rem_minmax(0,1fr)]"
        : "lg:grid-cols-[16rem_minmax(0,1fr)]",
  );

  function scopeKey(s: Scope): string {
    return JSON.stringify([s.projectIds, s.range]);
  }

  /** Per-project settings (columns, pins) follow the first scoped project. */
  function keyFor(ids: string[]): string {
    return activeProjectKey(ids) ?? "all";
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
    const normalized: Scope = { projectIds: normalizeIds(next.projectIds), range: next.range };
    scopeKeySeen = scopeKey(normalized);
    scope = normalized;
    scopeStore.set(normalized);
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

  function pinStoreFor(key: string): FacetPinsStore {
    let store = pinStores.get(key);
    if (!store) {
      store = createFacetPinsStore(key);
      pinStores.set(key, store);
    }
    return store;
  }

  $effect(() => builtinStoreFor(projectKey).subscribe((value) => (layout = value)));
  $effect(() => columnStoreFor(projectKey).subscribe((value) => (customColumns = value)));
  $effect(() => pinStoreFor(projectKey).subscribe((value) => (pinnedKeys = value)));
  $effect(() => layoutStore.subscribe((s) => (terminalWrap = s.terminalWrapEnabled)));
  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

  function currentState(): ExplorerState {
    return {
      q,
      projectIds: scope.projectIds,
      range: scope.range,
      view,
      live,
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

  /**
   * Runs the committed query over a window frozen now; resolves true when page 1
   * was applied. Histogram and facets of the same window load alongside.
   */
  async function startRun(opts: { submitted?: boolean } = {}): Promise<boolean> {
    const parsed = parseLogQuery(q);
    if (parsed.ok === false) {
      queryError = { message: parsed.error.message, position: parsed.error.position };
      return false;
    }
    runSeq += 1;
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
      range: scope.range,
      from,
      to,
      asOf,
      preset: scope.range.kind === "preset" ? scope.range.preset : null,
    };
    run = r;
    const token = logsGuard.begin();

    if (projectsFailed) {
      stopSideRequests();
      rows = [];
      total = null;
      loading = false;
      error = "Could not load the projects of this organization.";
      return false;
    }
    if (ids.length === 0) {
      stopSideRequests();
      rows = [];
      total = 0;
      loading = false;
      return true;
    }

    // No chart on phones, so no request either.
    if (!get(isMobile)) void loadHistogram(r);
    void loadFacets(r);
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
      if (!opts.submitted) recorder.loaded(toSavedState(currentState(), customColumns));
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

  /** Drops in-flight histogram and facets answers (live tail, empty scope). */
  function stopSideRequests() {
    histogramGuard.invalidate();
    facetsGuard.invalidate();
    histogramLoading = false;
    facetsLoading = false;
  }

  async function loadHistogram(r: Run) {
    const token = histogramGuard.begin();
    const bucketSeconds = pickBucketSeconds(r.to.getTime() - r.from.getTime());
    histogramLoading = true;
    histogramError = null;
    histogramTotal = null;
    try {
      const res = await logsAPI.getHistogram({
        projectId: r.projectIds,
        q: r.q || undefined,
        from: r.from.toISOString(),
        to: r.to.toISOString(),
        bucketSeconds,
      });
      if (!histogramGuard.isCurrent(token)) return;
      histogramBuckets = Array.isArray(res.buckets) ? res.buckets : [];
      histogramBucketSeconds = typeof res.bucketSeconds === "number" ? res.bucketSeconds : bucketSeconds;
      histogramTotal = typeof res.total === "number" ? res.total : null;
    } catch (e) {
      if (!histogramGuard.isCurrent(token)) return;
      histogramBuckets = [];
      histogramError = errorText(e);
    } finally {
      if (histogramGuard.isCurrent(token)) histogramLoading = false;
    }
  }

  /** Facet counts for the run; discovered fields are re-read only when projects or range change. */
  async function loadFacets(r: Run) {
    const token = facetsGuard.begin();
    const key = JSON.stringify([r.projectIds, r.range]);
    facetsLoading = true;
    facetsError = null;
    try {
      if (key !== fieldsKey) {
        let fields: LogFieldInfo[] = [];
        try {
          fields = await logsAPI.getFields({
            projectId: r.projectIds,
            from: r.from.toISOString(),
            to: r.to.toISOString(),
          });
        } catch {
          fields = [];
        }
        if (!facetsGuard.isCurrent(token)) return;
        discovered = Array.isArray(fields) ? fields : [];
        fieldsKey = key;
      }
      const pins = get(pinStoreFor(keyFor(r.projectIds)));
      const res = await logsAPI.getFacets({
        projectId: r.projectIds,
        q: r.q || undefined,
        from: r.from.toISOString(),
        to: r.to.toISOString(),
        fields: [...BUILTIN_FACET_KEYS, ...selectMetadataFacetKeys(pins, discovered)],
        limit: FACET_VALUE_LIMIT,
      });
      if (!facetsGuard.isCurrent(token)) return;
      facets = Array.isArray(res) ? res : [];
    } catch (e) {
      if (!facetsGuard.isCurrent(token)) return;
      facetsError = errorText(e);
    } finally {
      if (facetsGuard.isCurrent(token)) facetsLoading = false;
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

  /** Live tail follows one project: several scoped projects narrow to the first one, with a notice. */
  function liveProjectId(): string | null {
    const ids = resolveIds(scope.projectIds, projects);
    if (ids.length > 1) {
      const first = ids[0];
      setScope({ projectIds: [first], range: scope.range });
      const name = projects.find((p) => p.id === first)?.name ?? first;
      toastStore.info(`Live tail works with one project at a time. Showing ${name}.`);
      return first;
    }
    return ids[0] ?? null;
  }

  /** (Re)creates the live tail for the current query and project, seeded with `initial` rows. */
  function startLive(initial: LogEntry[]) {
    stopLive();
    runSeq += 1;
    logsGuard.invalidate();
    stopSideRequests();
    loading = false;
    loadingMore = false;
    nextCursor = null;
    capped = false;
    error = null;
    hasRun = true;
    const parsed = parseLogQuery(q);
    if (parsed.ok === false) {
      queryError = { message: parsed.error.message, position: parsed.error.position };
      return;
    }
    queryError = null;
    const projectId = liveProjectId();
    if (!projectId) {
      rows = [];
      return;
    }
    const liveQ = q;
    const controller = createLiveTail({
      connect: () => logsAPI.createLogsWebSocket({ projectId, q: liveQ || undefined }),
      query: parsed.query,
      limit: liveLimit,
      onUpdate: (snapshot) => {
        if (tail !== controller) return;
        liveSnap = snapshot;
        rows = snapshot.logs;
      },
    });
    tail = controller;
    controller.start(initial.filter((log) => log.projectId === projectId));
  }

  function stopLive() {
    const current = tail;
    tail = null;
    current?.stop();
    liveSnap = null;
  }

  function setLive(next: boolean) {
    if (next === live) return;
    if (next) {
      live = true;
      if (!liveTried) {
        liveTried = true;
        void checklistStore.completeItem("try-live-tail");
      }
      startLive(rows);
    } else {
      stopLive();
      live = false;
      void startRun();
    }
    writeUrl();
  }

  function setLiveLimit(next: number) {
    if (!Number.isFinite(next) || next < LIVE_TAIL_LIMITS[0]) return;
    liveLimit = Math.min(next, LIVE_TAIL_LIMITS[LIVE_TAIL_LIMITS.length - 1]);
    try {
      localStorage.setItem(LIVE_LIMIT_KEY, String(liveLimit));
    } catch {
      // storage blocked
    }
    tail?.setLimit(liveLimit);
  }

  /** Auto-pause while the user reads older rows; resume when back at the newest ones. */
  function handleScrollTop(atTop: boolean) {
    if (!live || !tail || !liveSnap) return;
    if (!atTop) {
      if (!liveSnap.pausedBy) tail.pause("scroll");
    } else if (liveSnap.pausedBy === "scroll") {
      tail.resume();
    }
  }

  async function showPending() {
    tail?.resume();
    await tick();
    if (view === "table") resultsTable?.scrollToTop();
    else terminalView?.scrollToTop();
  }

  /** The query or the scope changed: re-run, or reconnect the live tail with it. */
  function rerun() {
    if (live) startLive([]);
    else void startRun();
  }

  function refresh() {
    if (live) tail?.retry();
    else void startRun();
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
    const parsed = parseLogQuery(q);
    if (parsed.ok) recorder.submit(toSavedState(currentState(), customColumns));
    if (live) startLive([]);
    else void startRun({ submitted: true });
    writeUrl();
  }

  function clearQuery() {
    q = "";
    draftQ = "";
    rerun();
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
    rerun();
    writeUrl();
  }

  function filterProject(projectId: string) {
    scopeStore.setProjects([projectId]);
  }

  function selectHistogramRange(from: Date, to: Date) {
    scopeStore.setRange({ kind: "custom", from: from.toISOString(), to: to.toISOString() });
  }

  function pinFacet(key: string) {
    pinStoreFor(projectKey).pin(key);
    if (run) void loadFacets(run);
  }

  function unpinFacet(key: string) {
    pinStoreFor(projectKey).unpin(key);
    if (run) void loadFacets(run);
  }

  function valuesFor(key: string): string[] {
    return facets.find((f) => f.field === key)?.values.map((v) => v.value) ?? [];
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

  function setFacetsCollapsed(next: boolean) {
    facetsCollapsed = next;
    try {
      localStorage.setItem(FACETS_COLLAPSED_KEY, String(next));
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
    logId = log.id ?? null;
    logProjectId = log.id ? log.projectId : null;
    if (log.id) void loadIdentifiers(log.id);
    writeUrl();
  }

  function closeDetails() {
    detailsLog = null;
    logId = null;
    logProjectId = null;
    writeUrl();
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

  function linkWindow(time: string): TimeRangeValue | null {
    const t = Date.parse(time);
    if (Number.isNaN(t)) return null;
    return {
      kind: "custom",
      from: new Date(t - LOG_LINK_WINDOW_MS).toISOString(),
      to: new Date(t + LOG_LINK_WINDOW_MS).toISOString(),
    };
  }

  /**
   * Runs the current state and loads more pages (at most MAX_LINK_PAGES) until
   * the log with `id` is present; then selects, centres and opens it. When it
   * never shows up, the details panel opens on `fallback` with a notice.
   */
  async function focusLog(id: string, fallback: LogEntry) {
    const ok = await startRun();
    const mine = runSeq;
    if (!ok) {
      if (mine === runSeq && !error) openDetails(fallback);
      return;
    }
    let pages = 0;
    while (mine === runSeq && !rows.some((r) => r.id === id) && nextCursor && pages < MAX_LINK_PAGES) {
      pages += 1;
      if (!(await loadMore())) break;
    }
    if (mine !== runSeq) return;
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) {
      const log = rows[index];
      const key = rowKey(log, index);
      selectedId = key;
      centerOnId = key;
      openDetails(log);
    } else {
      openDetails(fallback);
      toastStore.info("This log is outside the current results");
    }
  }

  /** `logId` deep link: fetch the log, frame its window when the link has none, find it. */
  async function openLogLink(id: string, projectId: string | null, hasRange: boolean) {
    const mine = runSeq;
    const pid = projectId ?? resolvedIds[0] ?? null;
    let found: LogEntry | null = null;
    if (pid) {
      try {
        const res = await logsAPI.getLogById(id, pid);
        found = res?.log ?? null;
      } catch {
        found = null;
      }
    }
    // Another run started meanwhile (scope or query change): that one wins.
    if (mine !== runSeq) return;
    if (!found) {
      toastStore.error("Log not found");
      logId = null;
      logProjectId = null;
      void startRun();
      writeUrl();
      return;
    }
    if (!hasRange) {
      const range = linkWindow(found.time);
      if (range) setScope({ projectIds: scope.projectIds, range });
    }
    await focusLog(id, found);
  }

  /** A context row: the explorer around that log, in its project, without a query. */
  function openAround(log: LogEntry) {
    closeContext();
    const range = linkWindow(log.time);
    if (!range) return;
    // A window around one log is a static view.
    if (live) {
      stopLive();
      live = false;
    }
    setScope({ projectIds: [log.projectId], range });
    q = "";
    draftQ = "";
    savedId = null;
    if (log.id) void focusLog(log.id, log);
    else void startRun();
    writeUrl();
  }

  function searchRange(preset: TimeRangePreset) {
    scopeStore.setRange({ kind: "preset", preset });
  }

  function rangeOfState(state: SavedSearchState): TimeRangeValue {
    if (state.range) {
      const preset = sanitizeRange({ kind: "preset", preset: state.range });
      if (preset) return preset;
    }
    if (state.from && state.to) {
      const custom = sanitizeRange({ kind: "custom", from: state.from, to: state.to });
      if (custom) return custom;
    }
    return scope.range;
  }

  function applySearchState(state: SavedSearchState) {
    q = typeof state.q === "string" ? state.q.trim() : "";
    draftQ = q;
    setScope({
      projectIds: Array.isArray(state.projectIds) ? state.projectIds : [],
      range: rangeOfState(state),
    });
    if (state.view === "table" || state.view === "terminal") view = state.view;
    detailsLog = null;
    logId = null;
    logProjectId = null;
    selectedId = null;
  }

  function applyRecent(entry: RecentSearch) {
    applySearchState(entry);
    savedId = null;
    rerun();
    writeUrl();
  }

  function clearRecent() {
    clearRecentSearches();
    recent = [];
  }

  function applySaved(saved: SavedSearch) {
    applySearchState(saved.state);
    if (Array.isArray(saved.state.columns)) columnStoreFor(projectKey).set([...saved.state.columns]);
    savedId = saved.id;
    rerun();
    writeUrl();
  }

  async function copyLink() {
    moreOpen = false;
    const href = new URL(buildExplorerUrl(currentState()), location.origin).href;
    if (await copyToClipboard(href)) toastStore.success("Link copied");
    else toastStore.error("Could not copy the link");
  }

  function createAlert() {
    moreOpen = false;
    goto(alertPrefillUrl({ q, scopeProjectIds: scope.projectIds }));
  }

  function openExport() {
    moreOpen = false;
    exportOpen = true;
  }

  /** Applies a logs URL (first load or a link from another page) and runs it. */
  function applyUrl(url: URL) {
    initialized = true;
    const parsed = parseExplorerUrl(url);
    setScope({
      projectIds: parsed.scope.projectIds ?? scope.projectIds,
      range: parsed.scope.range ?? scope.range,
    });
    q = parsed.q;
    draftQ = parsed.q;
    if (parsed.view) view = parsed.view;
    savedId = parsed.savedId;
    logId = parsed.logId;
    logProjectId = parsed.logProjectId;
    detailsLog = null;
    selectedId = null;
    centerOnId = null;
    // A log link is a static view; `live=true` alone starts the live tail (B10).
    const wantLive = parsed.live && !parsed.logId;
    if (!wantLive && live) {
      stopLive();
      live = false;
    }
    if (parsed.logId) {
      void openLogLink(parsed.logId, parsed.logProjectId, parsed.scope.range !== undefined);
    } else if (wantLive) {
      live = true;
      if (!liveTried) {
        liveTried = true;
        void checklistStore.completeItem("try-live-tail");
      }
      startLive([]);
    } else {
      void startRun();
    }
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
    stopLive();
    live = false;
    runSeq += 1;
    logsGuard.invalidate();
    histogramGuard.invalidate();
    facetsGuard.invalidate();
    recorder.cancel();
    rows = [];
    total = null;
    nextCursor = null;
    run = null;
    hasRun = false;
    loading = false;
    loadingMore = false;
    error = null;
    capped = false;
    histogramBuckets = [];
    histogramTotal = null;
    histogramLoading = false;
    histogramError = null;
    facets = [];
    facetsLoading = false;
    facetsError = null;
    discovered = [];
    fieldsKey = null;
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
      logId = null;
      logProjectId = null;
      savedId = null;
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
    rerun();
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
      facetsCollapsed = localStorage.getItem(FACETS_COLLAPSED_KEY) === "true";
      const savedLimit = Number.parseInt(localStorage.getItem(LIVE_LIMIT_KEY) ?? "", 10);
      if (Number.isFinite(savedLimit) && savedLimit >= 50 && savedLimit <= 1000) liveLimit = savedLimit;
    } catch {
      // storage blocked
    }
    recent = loadRecentSearches();
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
    stopLive();
    runSeq += 1;
    logsGuard.invalidate();
    histogramGuard.invalidate();
    facetsGuard.invalidate();
    recorder.cancel();
    shortcutsStore.unregisterScope("search");
  });
</script>

<svelte:head>
  <title>Logs - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Logs" description="Search, filter and tail logs across your projects">
    {#snippet actions()}
      <ScopeBar mode="multi" projects={scopeProjects} timeDisabled={live} canonicalUrl={false} hideZoneOnMobile />
    {/snippet}
  </PageHeader>

  <div class="mb-4 space-y-2">
    <div class="flex flex-wrap items-start gap-2">
      <div class="min-w-[280px] flex-1 max-md:min-w-0 max-md:w-full max-md:basis-full">
        <LogQueryBar
          bind:value={draftQ}
          fields={discoveredKeys}
          {valuesFor}
          serverError={queryError}
          onSubmit={handleSubmit}
          onEdit={() => recorder.cancel()}
        />
      </div>
      <div class="grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-[repeat(4,minmax(0,1fr))] md:contents">
      {#if $isMobile}
        <Button
          variant="outline"
          size="sm"
          class="h-10 w-full min-w-0 gap-1.5 md:w-auto"
          aria-label={filterClauseCount > 0 ? `Filters, ${filterClauseCount} active` : "Filters"}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onclick={() => (filtersOpen = true)}
        >
          <ListFilter class="size-4" />
          <span>Filters</span>
          {#if filterClauseCount > 0}
            <span
              data-testid="filters-count"
              class="rounded-full bg-primary px-1.5 text-xs font-medium tabular-nums text-primary-foreground"
              >{filterClauseCount}</span
            >
          {/if}
        </Button>
      {/if}
      <div class="flex min-h-9 items-center {live ? 'max-md:col-span-full min-[480px]:max-md:order-last' : 'max-md:min-w-0'} max-md:w-full">
        <LiveTailControls
          {live}
          state={liveSnap?.state ?? "disconnected"}
          pausedBy={liveSnap?.pausedBy ?? null}
          limit={liveLimit}
          disabled={projects.length === 0}
          onToggle={setLive}
          onPause={() => tail?.pause("manual")}
          onResume={() => tail?.resume()}
          onRetry={() => tail?.retry()}
          onLimitChange={setLiveLimit}
        />
      </div>
      <SavedSearchesMenu
        organizationId={$currentOrganization?.id ?? ""}
        currentUserId={$authStore.user?.id ?? null}
        currentState={savedState}
        openSavedId={savedId}
        onOpen={applySaved}
        onSaved={(saved) => {
          savedId = saved.id;
          writeUrl();
        }}
        onDeleted={(id) => {
          if (savedId !== id) return;
          savedId = null;
          writeUrl();
        }}
      />
      <Popover.Root bind:open={moreOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="icon" class="size-9 max-md:h-10 max-md:w-full max-md:min-w-0 max-md:gap-1.5" aria-label="More actions" title="More actions">
              <Ellipsis class="size-4" />
              <span class="md:hidden">More</span>
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-48 p-1" align="end">
          <div class="flex flex-col">
            <button
              type="button"
              class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onclick={copyLink}
            >
              <Link class="size-4 text-muted-foreground" />
              Copy link
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onclick={createAlert}
            >
              <BellPlus class="size-4 text-muted-foreground" />
              Create alert
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              disabled={!canExport}
              onclick={openExport}
            >
              <Download class="size-4 text-muted-foreground" />
              Export
            </button>
          </div>
        </Popover.Content>
      </Popover.Root>
      </div>
    </div>

    {#if live && liveSnap?.error && liveSnap.state === "disconnected"}
      <p role="alert" class="text-xs text-destructive-text">Live tail stopped: {liveSnap.error}</p>
    {/if}

    {#if recent.length > 0 && draftQ.trim() === ""}
      <div class="flex flex-wrap items-center gap-1.5 max-md:hidden">
        <span class="text-xs text-muted-foreground">Recent:</span>
        {#each recent as entry, i (i)}
          <button
            type="button"
            class="inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-full border bg-background px-2.5 py-0.5 font-mono text-xs transition-colors hover:bg-accent hover:text-accent-foreground sm:max-w-[16rem]"
            title={entry.q}
            onclick={() => applyRecent(entry)}
          >
            <span class="min-w-0 truncate">{recentLabel(entry)}</span>
          </button>
        {/each}
        <button
          type="button"
          class="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          aria-label="Clear recent searches"
          onclick={clearRecent}
        >
          Clear
        </button>
      </div>
    {/if}
  </div>

  {#if hasRun && !live && resultsState !== "onboarding" && !$isMobile}
    <section aria-label="Log volume" class="mb-4 rounded-lg border bg-card p-3 text-card-foreground">
      <LogVolumeHistogram
        buckets={histogramBuckets}
        bucketSeconds={histogramBucketSeconds}
        total={histogramTotal}
        loading={histogramLoading}
        error={histogramError}
        onRangeSelect={selectHistogramRange}
        onRetry={() => run && void loadHistogram(run)}
      />
    </section>
  {/if}

  <div class="grid items-start gap-4 {gridClass}">
    {#if $isMobile}
      <FacetsSheet bind:open={filtersOpen}>
        <FacetSidebar
          embedded
          {facets}
          loading={facetsLoading}
          error={facetsError}
          {q}
          {pinnedKeys}
          {candidateKeys}
          onToggle={applyFieldToggle}
          onPin={pinFacet}
          onUnpin={unpinFacet}
        />
      </FacetsSheet>
    {:else}
      <FacetSidebar
        {facets}
        loading={facetsLoading}
        error={facetsError}
        {q}
        {pinnedKeys}
        {candidateKeys}
        bind:collapsed={() => facetsCollapsed, (next) => setFacetsCollapsed(next)}
        onToggle={applyFieldToggle}
        onPin={pinFacet}
        onUnpin={unpinFacet}
      />
    {/if}

    <section aria-label="Results" class="min-w-0 bg-card text-card-foreground max-md:overflow-hidden rounded-lg border">
      <div class="flex items-center justify-between gap-2 border-b px-3 py-2 md:flex-wrap">
        <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {#if resultsState === "results" || (live && rows.length > 0)}
            <span class="font-medium">{countText}</span>
          {/if}
          {#if live}
            <span class="text-muted-foreground">Newest first, up to {liveLimit.toLocaleString("en-US")} kept</span>
          {:else if run && run.preset && hasRun}
            <span class="hidden text-muted-foreground md:inline" title={asOfTitle}>Results as of {asOfText}</span>
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
              class="gap-1.5 rounded-r-none border-r max-md:h-8 max-md:px-3"
              aria-pressed={view === "table"}
              onclick={() => setView("table")}
            >
              <Table2 class="size-4" />
              <span class="max-md:sr-only">Table</span>
            </Button>
            <Button
              variant={view === "terminal" ? "secondary" : "ghost"}
              size="sm"
              class="gap-1.5 rounded-l-none max-md:h-8 max-md:px-3"
              aria-pressed={view === "terminal"}
              onclick={() => setView("terminal")}
            >
              <SquareTerminal class="size-4" />
              <span class="max-md:sr-only">Terminal</span>
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
              <span class="max-md:sr-only">Wrap lines</span>
            </Button>
          {:else if !$isMobile}
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

      <div class="p-3 {resultsState === 'results' || (live && rows.length > 0) ? 'max-md:p-0' : ''}">
        {#if showPendingPill}
          <div class="flex justify-center pb-2 max-md:pt-2">
            <Button size="sm" class="h-7 rounded-full px-3 text-xs" onclick={showPending}>{pendingText}</Button>
          </div>
        {/if}
        {#if live && rows.length === 0}
          <EmptyState
            variant="no-data"
            title="Waiting for new logs"
            description="Logs that match the query appear here as they arrive."
          />
        {:else if resultsState === "loading"}
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
                bind:this={terminalView}
                logs={rows}
                isLiveTail={live}
                maxHeight={RESULTS_HEIGHT}
                {selectedId}
                onSelect={(log) => openDetails(log)}
                onScrollTopChange={handleScrollTop}
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
                onScrollTopChange={handleScrollTop}
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
          onFilter={(key, value, negate) => applyFieldToggle(key, value, negate ? "exclude" : "include")}
          onProjectFilter={filterProject}
          onAddColumn={(path) => columnStoreFor(projectKey).add(path)}
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
  onOpenAround={openAround}
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

<ExportLogsDialog
  bind:open={exportOpen}
  totalLogs={shownTotal ?? rows.length}
  scope={exportScope}
  projects={scopeProjects}
  {customColumns}
/>
