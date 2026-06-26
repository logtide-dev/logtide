<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { currentOrganization } from "$lib/stores/organization";
  import { authStore } from "$lib/stores/auth";
  import { shortcutsStore } from "$lib/stores/shortcuts";
  import { checklistStore } from "$lib/stores/checklist";
  import { ProjectsAPI } from "$lib/api/projects";
  import { logsAPI, type SearchMode } from "$lib/api/logs";
  import { toastStore } from "$lib/stores/toast";
  import type { Project, MetadataFilterInput } from "@logtide/shared";
  import MetadataFilterBuilder from "$lib/components/alerts/MetadataFilterBuilder.svelte";
  import Button from "$lib/components/ui/button/button.svelte";
  import Input from "$lib/components/ui/input/input.svelte";
  import Label from "$lib/components/ui/label/label.svelte";
  import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "$lib/components/ui/table";
  import * as Select from "$lib/components/ui/select";
  import * as Popover from "$lib/components/ui/popover";
  import Switch from "$lib/components/ui/switch/switch.svelte";
  import LogContextDialog from "$lib/components/LogContextDialog.svelte";
  import CorrelationTimelineDialog from "$lib/components/CorrelationTimelineDialog.svelte";
  import IdentifierBadge from "$lib/components/IdentifierBadge.svelte";
  import { ExceptionDetailsDialog } from "$lib/components/exceptions";
  import ExportLogsDialog from "$lib/components/ExportLogsDialog.svelte";
  import { correlationAPI, type IdentifierMatch, type CorrelatedLog } from "$lib/api/correlation";
  import EmptyLogs from "$lib/components/EmptyLogs.svelte";
  import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
  import TerminalLogView from "$lib/components/TerminalLogView.svelte";
  import TimeRangePicker, { type TimeRangeType } from "$lib/components/TimeRangePicker.svelte";
  import { layoutStore } from "$lib/stores/layout";
  import { createColumnConfigStore } from "$lib/stores/column-config.js";
  import ColumnConfigMenu from "$lib/components/search/ColumnConfigMenu.svelte";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Download from "@lucide/svelte/icons/download";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import SearchIcon from "@lucide/svelte/icons/search";
  import Radio from "@lucide/svelte/icons/radio";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import SquareTerminal from "@lucide/svelte/icons/square-terminal";
  import Table2 from "@lucide/svelte/icons/table-2";
  import WrapText from "@lucide/svelte/icons/wrap-text";
  import Clock from "@lucide/svelte/icons/clock";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Filter from "@lucide/svelte/icons/filter";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import { copyToClipboard } from "$lib/utils/clipboard";
  import BreadcrumbTimeline from "$lib/components/BreadcrumbTimeline.svelte";

  interface LogEntry {
    id?: string;
    time: string;
    service: string;
    level: "debug" | "info" | "warn" | "error" | "critical";
    message: string;
    metadata?: Record<string, any>;
    traceId?: string;
    sessionId?: string;
    projectId: string;
  }

  let token = $state<string | null>(null);
  let projects = $state<Project[]>([]);
  let logs = $state<LogEntry[]>([]);
  let totalLogs = $state(0);
  let hasMoreLogs = $state(false);
  let expandedRows = $state(new Set<number>());
  let isLoading = $state(false);
  let hasLoadedOnce = $state(false);
  let logsContainer = $state<HTMLDivElement | null>(null);
  let selectedLogIndex = $state(-1);

  let searchQuery = $state("");
  let searchMode = $state<SearchMode>("fulltext");
  let traceId = $state("");
  let sessionId = $state("");
  let selectedProjects = $state<string[]>([]);
  let selectedServices = $state<string[]>([]);
  let selectedHostnames = $state<string[]>([]);
  let selectedLevels = $state<string[]>([]);
  let metadataFilters = $state<MetadataFilterInput[]>([]);
  let liveTail = $state(false);
  let liveTailConnectionKey = $state<string | null>(null);
  let liveTailLimit = $state(100);
  let viewMode = $state<"table" | "terminal">("table");
  let terminalWrapEnabled = $state(true);
  let maxWidthClass = $state("max-w-7xl");
  let containerPadding = $state("px-6 py-8");

  // Custom metadata columns (persisted per project in localStorage)
  let customColumns = $state<string[]>([]);
  // Cache stores per projectId so that any selectedProjects mutation does not
  // recreate the store (and re-read localStorage) on every dependency change.
  const columnStoreCache = new Map<
    string,
    ReturnType<typeof createColumnConfigStore>
  >();
  function getColumnStore(projectId: string) {
    let store = columnStoreCache.get(projectId);
    if (!store) {
      store = createColumnConfigStore(projectId);
      columnStoreCache.set(projectId, store);
    }
    return store;
  }
  let columnStore = $derived(
    selectedProjects.length > 0
      ? getColumnStore(selectedProjects[0])
      : null
  );
  $effect(() => {
    const store = columnStore;
    if (!store) {
      customColumns = [];
      return;
    }
    const unsub = store.subscribe((v) => { customColumns = v; });
    return unsub;
  });

  $effect(() => {
    const unsubscribe = layoutStore.subscribe((state) => {
      terminalWrapEnabled = state.terminalWrapEnabled;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
      maxWidthClass = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
      containerPadding = value;
    });
    return unsubscribe;
  });

  let projectsAPI = $derived(new ProjectsAPI(() => token));

  const unsubAuthStore = authStore.subscribe((state) => {
    token = state.token;
  });

  // Time range picker reference and state
  let timeRangePicker = $state<ReturnType<typeof TimeRangePicker> | null>(null);
  let timeRangeType = $state<TimeRangeType>("last_24h");
  let customFromTime = $state("");
  let customToTime = $state("");

  // Helper to get time range from picker or fallback to local state
  function getTimeRange(): { from: Date; to: Date } {
    if (timeRangePicker) {
      return timeRangePicker.getTimeRange();
    }
    // Fallback for initial render before picker is mounted
    const now = new Date();
    switch (timeRangeType) {
      case "last_hour":
        return { from: new Date(now.getTime() - 60 * 60 * 1000), to: now };
      case "last_24h":
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
      case "last_7d":
        return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
      case "custom":
        const from = customFromTime
          ? new Date(customFromTime)
          : new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const to = customToTime ? new Date(customToTime) : now;
        return { from, to };
      default:
        return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
    }
  }

  let pageSize = $state(25);

  let lastLoadedOrg = $state<string | null>(null);

  let contextDialogOpen = $state(false);
  let selectedLogForContext = $state<LogEntry | null>(null);
  let loadingLogById = $state(false);

  // Exception dialog state
  let exceptionDialogOpen = $state(false);
  let selectedLogForException = $state<LogEntry | null>(null);

  // Export dialog state
  let exportDialogOpen = $state(false);

  // Correlation dialog state
  let correlationDialogOpen = $state(false);
  let selectedIdentifierType = $state("");
  let selectedIdentifierValue = $state("");
  let selectedLogForCorrelation = $state<LogEntry | null>(null);
  let logIdentifiers = $state<Map<string, IdentifierMatch[]>>(new Map());
  let loadingIdentifiers = $state(false);

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function debouncedSearch() {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      applyFilters();
    }, 300);
  }

  onMount(() => {
    // Register page-specific keyboard shortcuts
    shortcutsStore.setScope('search');
    shortcutsStore.register([
      {
        id: 'search:focus',
        combo: '/',
        label: 'Focus search input',
        scope: 'search',
        category: 'search',
        action: () => {
          const el = document.getElementById('search') as HTMLInputElement | null;
          el?.focus();
        },
      },
      {
        id: 'search:refresh',
        combo: 'r',
        label: 'Refresh results',
        scope: 'search',
        category: 'actions',
        action: () => loadLogs(),
      },
      {
        id: 'search:next-log',
        combo: 'j',
        label: 'Next log',
        scope: 'search',
        category: 'navigation',
        action: () => {
          if (logs.length === 0) return;
          selectedLogIndex = Math.min(selectedLogIndex + 1, logs.length - 1);
          scrollToSelectedLog();
        },
      },
      {
        id: 'search:prev-log',
        combo: 'k',
        label: 'Previous log',
        scope: 'search',
        category: 'navigation',
        action: () => {
          if (logs.length === 0) return;
          selectedLogIndex = Math.max(selectedLogIndex - 1, 0);
          scrollToSelectedLog();
        },
      },
      {
        id: 'search:expand-log',
        combo: 'enter',
        label: 'Expand/collapse selected log',
        scope: 'search',
        category: 'actions',
        action: () => {
          if (selectedLogIndex >= 0 && selectedLogIndex < logs.length) {
            toggleRow(selectedLogIndex);
          }
        },
      },
    ]);

    // Restore search mode preference from session storage
    const savedSearchMode = sessionStorage.getItem("logtide_search_mode");
    if (savedSearchMode === "fulltext" || savedSearchMode === "substring") {
      searchMode = savedSearchMode;
    }

    // Restore view mode preference from session storage
    const savedViewMode = sessionStorage.getItem("logtide_view_mode");
    if (savedViewMode === "table" || savedViewMode === "terminal") {
      viewMode = savedViewMode;
    }

    // Restore live tail limit preference
    const savedLiveTailLimit = localStorage.getItem("logtide_livetail_limit");
    if (savedLiveTailLimit) {
      const parsed = parseInt(savedLiveTailLimit, 10);
      if (!isNaN(parsed) && parsed >= 50 && parsed <= 1000) {
        liveTailLimit = parsed;
      }
    }

    if ($currentOrganization) {
      loadProjects();
    }
  });

  $effect(() => {
    if (!$currentOrganization) {
      projects = [];
      logs = [];
      selectedProjects = [];
      selectedServices = [];
      availableServices = [];
      lastLoadedOrg = null;
      return;
    }

    if ($currentOrganization.id === lastLoadedOrg) return;

    // Reset selections when org changes
    selectedProjects = [];
    selectedServices = [];
    selectedHostnames = [];
    availableServices = [];
    availableHostnames = [];
    logs = [];
    hasMoreLogs = false;
    currentPage = 1;

    loadProjects();
    lastLoadedOrg = $currentOrganization.id;
  });

  function formatDateForInput(isoString: string): string {
    try {
      const date = new Date(isoString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch (e) {
      return "";
    }
  }

  let urlParamsProcessed = $state(false);

  $effect(() => {
    if (!browser || !page.url.searchParams || urlParamsProcessed) return;

    const params = page.url.searchParams;
    let shouldLoadLogs = false;

    const projectParam = params.get("project");
    if (projectParam && selectedProjects.length === 0) {
      selectedProjects = [projectParam];
      shouldLoadLogs = true;
    }

    const serviceParam = params.get("service");
    if (serviceParam && selectedServices.length === 0) {
      selectedServices = [serviceParam];
    }

    const levelParam = params.get("level");
    if (levelParam && selectedLevels.length === 0) {
      selectedLevels = levelParam.split(",").filter(Boolean);
    }

    const traceIdParam = params.get("traceId");
    if (traceIdParam && !traceId) {
      traceId = traceIdParam;
      shouldLoadLogs = true;
    }

    const sessionIdParam = params.get("sessionId");
    if (sessionIdParam && !sessionId) {
      sessionId = sessionIdParam;
      shouldLoadLogs = true;
    }

    const fromParam = params.get("from");
    const toParam = params.get("to");
    if (fromParam && toParam && !customFromTime && !customToTime) {
      timeRangeType = "custom";
      customFromTime = formatDateForInput(fromParam);
      customToTime = formatDateForInput(toParam);
    }

    if (shouldLoadLogs && selectedProjects.length > 0) {
      urlParamsProcessed = true;
      Promise.all([loadServices(), loadHostnames()]).then(() => {
        // Sync the TimeRangePicker's internal state with URL params before querying
        if (timeRangePicker && fromParam && toParam) {
          timeRangePicker.setTimeRange("custom", fromParam, toParam);
        }
        loadLogs();
      });
    }
  });

  $effect(() => {
    if (!browser || !page.url.searchParams) return;

    const params = page.url.searchParams;
    const logIdParam = params.get("logId");
    const projectIdParam = params.get("projectId");

    if (logIdParam && projectIdParam && !loadingLogById && !selectedLogForContext) {
      loadLogById(logIdParam, projectIdParam);
    }
  });

  async function loadLogById(logId: string, projectId: string) {
    loadingLogById = true;
    try {
      const result = await logsAPI.getLogById(logId, projectId);
      if (result && result.log) {
        selectedLogForContext = result.log as LogEntry;
        contextDialogOpen = true;

        // Also select the project if not already selected
        if (!selectedProjects.includes(projectId)) {
          selectedProjects = [projectId];
        }
      } else {
        toastStore.error("Log not found");
      }
    } catch (e) {
      console.error("Failed to load log by ID:", e);
      toastStore.error("Failed to load log");
    } finally {
      loadingLogById = false;
    }
  }

  async function loadProjects() {
    if (!$currentOrganization) {
      projects = [];
      return;
    }

    try {
      const [response, availability] = await Promise.all([
        projectsAPI.getProjects($currentOrganization.id),
        projectsAPI.getProjectDataAvailability($currentOrganization.id).catch(() => null),
      ]);
      const logsProjectIds = availability?.logs;
      projects = logsProjectIds && logsProjectIds.length > 0
        ? response.projects.filter((p) => logsProjectIds.includes(p.id))
        : response.projects;

      if (projects.length > 0 && selectedProjects.length === 0) {
        selectedProjects = projects.map((p) => p.id);
        await Promise.all([loadServices(), loadHostnames()]);
        loadLogs();
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
      projects = [];
    }
  }

  // Pagination state
  let currentPage = $state(1);

  // Monotonic request counter so a slower earlier loadLogs() cannot overwrite
  // the results of a newer one when several calls are in flight at once.
  let loadLogsRequestId = 0;

  async function loadLogs() {
    if (selectedProjects.length === 0) {
      logs = [];
      hasMoreLogs = false;
      hasLoadedOnce = true;
      return;
    }

    const requestId = ++loadLogsRequestId;
    isLoading = true;

    try {
      const timeRange = getTimeRange();

      const offset = (currentPage - 1) * pageSize;

      const validMetadataFilters = metadataFilters.filter((f) => f.key.trim().length > 0);

      const response = await logsAPI.getLogs({
        projectId:
          selectedProjects.length === 1
            ? selectedProjects[0]
            : selectedProjects,
        service:
          selectedServices.length > 0
            ? selectedServices.length === 1
              ? selectedServices[0]
              : selectedServices
            : undefined,
        level:
          selectedLevels.length > 0
            ? selectedLevels.length === 1
              ? selectedLevels[0]
              : selectedLevels
            : undefined,
        hostname:
          selectedHostnames.length > 0
            ? selectedHostnames.length === 1
              ? selectedHostnames[0]
              : selectedHostnames
            : undefined,
        traceId: traceId || undefined,
        sessionId: sessionId || undefined,
        q: searchQuery || undefined,
        searchMode: searchQuery ? searchMode : undefined,
        from: timeRange.from.toISOString(),
        to: timeRange.to.toISOString(),
        limit: pageSize,
        offset: offset,
        metadataFilters: validMetadataFilters.length > 0 ? validMetadataFilters : undefined,
      });

      // A newer load started while this one was in flight; drop the stale result.
      if (requestId !== loadLogsRequestId) return;

      logs = response.logs;
      totalLogs = response.total;
      hasMoreLogs = response.hasMore ?? (response.logs.length >= pageSize);
    } catch (e) {
      if (requestId !== loadLogsRequestId) return;
      console.error("Failed to load logs:", e);
      toastStore.error("Failed to load logs. Please try again.");
      logs = [];
      hasMoreLogs = false;
    } finally {
      if (requestId === loadLogsRequestId) {
        isLoading = false;
        hasLoadedOnce = true;
      }
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page !== currentPage) {
      currentPage = page;
      loadLogs();
    }
  }

  function nextPage() {
    if (hasMoreLogs) {
      currentPage++;
      loadLogs();
    }
  }

  function previousPage() {
    if (currentPage > 1) {
      currentPage--;
      loadLogs();
    }
  }

  onDestroy(() => {
    unsubAuthStore();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    stopLiveTail();
    shortcutsStore.unregisterScope('search');
  });

  function scrollToSelectedLog() {
    if (viewMode !== 'table') return;
    const rows = logsContainer?.querySelectorAll('[data-log-row]');
    if (!rows || selectedLogIndex < 0 || selectedLogIndex >= rows.length) return;
    rows[selectedLogIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  let availableServices = $state<string[]>([]);
  let isLoadingServices = $state(false);
  let availableHostnames = $state<string[]>([]);
  let isLoadingHostnames = $state(false);

  async function loadServices() {
    if (selectedProjects.length === 0) {
      availableServices = [];
      return;
    }

    isLoadingServices = true;
    try {
      const timeRange = getTimeRange();
      const services = await logsAPI.getServices({
        projectId: selectedProjects,
        from: timeRange.from.toISOString(),
        to: timeRange.to.toISOString(),
      });
      availableServices = services;
      // Note: We intentionally do NOT remove selected services that aren't in the new time range.
      // This preserves user intent - if they selected "foo", switching time range should still
      // filter by "foo" (showing 0 results) rather than unexpectedly showing all services.
    } catch (e) {
      console.error("Failed to load services:", e);
      availableServices = [];
    } finally {
      isLoadingServices = false;
    }
  }

  async function loadHostnames() {
    if (selectedProjects.length === 0) {
      availableHostnames = [];
      return;
    }

    isLoadingHostnames = true;
    try {
      const timeRange = getTimeRange();
      const hostnames = await logsAPI.getHostnames({
        projectId: selectedProjects,
        from: timeRange.from.toISOString(),
        to: timeRange.to.toISOString(),
      });
      availableHostnames = hostnames;
    } catch (e) {
      console.error("Failed to load hostnames:", e);
      availableHostnames = [];
    } finally {
      isLoadingHostnames = false;
    }
  }

  // Combine available services with selected services (in case selected ones aren't in current time range)
  let displayedServices = $derived(() => {
    const combined = new Set([...availableServices, ...selectedServices]);
    return [...combined].sort((a, b) => a.localeCompare(b));
  });

  // Combine available hostnames with selected hostnames
  let displayedHostnames = $derived(() => {
    const combined = new Set([...availableHostnames, ...selectedHostnames]);
    return [...combined].sort((a, b) => a.localeCompare(b));
  });

  let paginatedLogs = $derived(logs);
  let effectiveTotalLogs = $derived(totalLogs > 0 ? totalLogs : logs.length);
  let totalPages = $derived(totalLogs > 0 ? Math.ceil(totalLogs / pageSize) : 0);

  // Track when live tail is activated for checklist
  let hasActivatedLiveTail = $state(false);
  $effect(() => {
    if (liveTail && !hasActivatedLiveTail) {
      hasActivatedLiveTail = true;
      checklistStore.completeItem('try-live-tail');
    }
  });

  $effect(() => {
    if (liveTail && selectedProjects.length > 1) {
      const firstProject = selectedProjects[0];
      selectedProjects = [firstProject];
      const project = projects.find((p) => p.id === firstProject);
      toastStore.info(
        `Live Tail works with one project at a time. Automatically selected: ${project?.name || "Project"}`,
      );
      return;
    }

    if (!liveTail || selectedProjects.length === 0) {
      const wasLiveTail = liveTailConnectionKey !== null;
      stopLiveTail();
      liveTailConnectionKey = null;
      if (wasLiveTail && selectedProjects.length > 0) {
        loadLogs();
      }
      return;
    }

    const connectionKey = `${selectedProjects[0]}-${selectedServices.join(",")}-${selectedLevels.join(",")}`;

    if (connectionKey === liveTailConnectionKey) {
      return;
    }

    stopLiveTail();
    startLiveTail();
    liveTailConnectionKey = connectionKey;
  });

  let ws: WebSocket | null = null;
  let liveTailSeq = 0;

  async function startLiveTail() {
    if (selectedProjects.length !== 1) return; // Live tail only works with single project

    const seq = ++liveTailSeq;
    try {
      const socket = await logsAPI.createLogsWebSocket({
        projectId: selectedProjects[0],
        service:
          selectedServices.length === 1 ? selectedServices[0] : undefined,
        level: selectedLevels.length === 1 ? selectedLevels[0] : undefined,
        hostname:
          selectedHostnames.length === 1 ? selectedHostnames[0] : undefined,
      });

      // A newer start/stop happened while the ticket request was in flight: drop
      // this now-stale socket instead of leaking it.
      if (seq !== liveTailSeq) {
        socket.close();
        return;
      }

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "logs") {
            let newLogs: LogEntry[] = data.logs;

            // Client-side filtering for criteria not sent to WS
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              newLogs = newLogs.filter((log) => {
                if (log.message?.toLowerCase().includes(q)) return true;
                if (log.service?.toLowerCase().includes(q)) return true;
                if (log.metadata && JSON.stringify(log.metadata).toLowerCase().includes(q)) return true;
                return false;
              });
            }
            if (traceId) {
              newLogs = newLogs.filter((log) => log.traceId === traceId);
            }
            if (sessionId) {
              newLogs = newLogs.filter((log) => log.sessionId === sessionId);
            }
            // The WS only carries a single level/hostname filter (startLiveTail
            // sends one only when exactly one is selected). When the user picked
            // multiple, filter the incoming logs client-side so live tail never
            // shows levels/hosts that were filtered out.
            if (selectedLevels.length > 1) {
              newLogs = newLogs.filter((log) => selectedLevels.includes(log.level));
            }
            if (selectedHostnames.length > 1) {
              newLogs = newLogs.filter((log) =>
                selectedHostnames.includes(log.metadata?.hostname),
              );
            }

            if (newLogs.length > 0) {
              const shift = newLogs.length;
              logs = [...newLogs, ...logs].slice(0, liveTailLimit);
              // Prepending shifts every existing row's index by `shift`; remap the
              // index-keyed UI state so expansion/selection stays on the same logs
              // instead of jumping to whatever now sits at the old index.
              expandedRows = new Set(
                [...expandedRows].map((i) => i + shift).filter((i) => i < logs.length)
              );
              if (selectedLogIndex >= 0) {
                const next = selectedLogIndex + shift;
                selectedLogIndex = next < logs.length ? next : -1;
              }
            }
          }
        } catch (e) {
          console.error("[LiveTail] Error parsing WS message:", e);
        }
      };

      socket.onerror = (err) => {
        console.error("[LiveTail] WebSocket error:", err);
      };

      ws = socket;
    } catch (e) {
      console.error("[LiveTail] Failed to start live tail:", e);
    }
  }

  function stopLiveTail() {
    liveTailSeq++;
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function toggleRow(index: number) {
    const newSet = new Set(expandedRows);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    expandedRows = newSet;
  }

  // Per-row breadcrumbs expand state
  let expandedBreadcrumbs = $state(new Set<number>());
  function toggleBreadcrumbs(index: number) {
    const newSet = new Set(expandedBreadcrumbs);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    expandedBreadcrumbs = newSet;
  }

  type Breadcrumb = {
    type: string;
    category?: string;
    message: string;
    level?: string;
    timestamp: number;
    data?: Record<string, unknown>;
  };
  function getBreadcrumbs(log: LogEntry): Breadcrumb[] {
    const bc = (log.metadata as Record<string, unknown> | undefined)?.breadcrumbs;
    return Array.isArray(bc) ? (bc as Breadcrumb[]) : [];
  }

  // Resolve a metadata column value, supporting dot-notation paths into nested
  // objects (e.g. "sdk.name"). Exact top-level keys win first, so flat keys that
  // literally contain dots (e.g. "debug.trace_id") still resolve correctly.
  function resolveMetadataPath(
    metadata: Record<string, any> | undefined,
    path: string,
  ): unknown {
    if (!metadata) return undefined;
    if (Object.prototype.hasOwnProperty.call(metadata, path)) return metadata[path];
    let current: any = metadata;
    for (const part of path.split(".")) {
      if (current === null || typeof current !== "object") return undefined;
      current = current[part];
    }
    return current;
  }

  function formatMetadataCell(value: unknown): string {
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function openContextDialog(log: LogEntry) {
    selectedLogForContext = log;
    contextDialogOpen = true;
  }

  function closeContextDialog() {
    contextDialogOpen = false;
    selectedLogForContext = null;

    // Remove URL params to prevent the effect from reopening the modal
    if (browser && page.url.searchParams.has("logId")) {
      const url = new URL(page.url);
      url.searchParams.delete("logId");
      url.searchParams.delete("projectId");
      goto(url.pathname + url.search, { replaceState: true });
    }
  }

  function openExceptionDialog(log: LogEntry) {
    selectedLogForException = log;
    exceptionDialogOpen = true;
  }

  function closeExceptionDialog() {
    exceptionDialogOpen = false;
    selectedLogForException = null;
  }

  function openCorrelationDialog(log: LogEntry, identifierType: string, identifierValue: string) {
    selectedLogForCorrelation = log;
    selectedIdentifierType = identifierType;
    selectedIdentifierValue = identifierValue;
    correlationDialogOpen = true;
  }

  function closeCorrelationDialog() {
    correlationDialogOpen = false;
    selectedLogForCorrelation = null;
    selectedIdentifierType = "";
    selectedIdentifierValue = "";
  }

  // Track which log IDs are currently being loaded to prevent duplicate requests
  let loadingLogIds = new Set<string>();

  async function loadIdentifiersForLogs(logIds: string[]) {
    if (logIds.length === 0) return;

    // Filter out already loaded AND currently loading identifiers
    const toLoad = logIds.filter((id) => !logIdentifiers.has(id) && !loadingLogIds.has(id));
    if (toLoad.length === 0) return;

    // Mark as loading
    toLoad.forEach(id => loadingLogIds.add(id));

    loadingIdentifiers = true;
    try {
      const result = await correlationAPI.getLogIdentifiersBatch(toLoad);
      const newMap = new Map(logIdentifiers);
      for (const [logId, identifiers] of Object.entries(result)) {
        newMap.set(logId, identifiers);
      }
      // Also mark logs with no identifiers as loaded (empty array)
      for (const id of toLoad) {
        if (!newMap.has(id)) {
          newMap.set(id, []);
        }
      }
      logIdentifiers = newMap;
    } catch (e) {
      console.error("[Correlation] Failed to load identifiers:", e);
    } finally {
      // Remove from loading set
      toLoad.forEach(id => loadingLogIds.delete(id));
      loadingIdentifiers = false;
    }
  }

  // Load identifiers when logs change - use untrack to prevent infinite loop
  $effect(() => {
    const currentLogs = logs; // Track only logs
    if (currentLogs.length > 0) {
      const logIds = currentLogs.map((log) => log.id).filter((id): id is string => !!id);
      // Use setTimeout to break out of reactive context
      setTimeout(() => loadIdentifiersForLogs(logIds), 0);
    }
  });

  function isErrorLevel(level: string): boolean {
    return level === 'error' || level === 'critical';
  }

  // Copy-to-clipboard feedback for metadata blocks, keyed per row
  let copiedMetaKey = $state<string | null>(null);
  async function copyMetadata(key: string, metadata: unknown) {
    const ok = await copyToClipboard(JSON.stringify(metadata, null, 2));
    if (ok) {
      copiedMetaKey = key;
      setTimeout(() => {
        if (copiedMetaKey === key) copiedMetaKey = null;
      }, 2000);
    }
  }

  function getLevelColor(level: LogEntry["level"]): string {
    switch (level) {
      case "critical":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-purple-300 dark:border-purple-700";
      case "error":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300 dark:border-red-700";
      case "warn":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700";
      case "info":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700";
      case "debug":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600";
    }
  }

  function applyFilters() {
    currentPage = 1;
    loadLogs();
  }

  function changePageSize(newSize: number) {
    pageSize = newSize;
    currentPage = 1;
    loadLogs();
  }

  async function handleTimeRangeChange() {
    // Sync page-level state so the chip label and fallback getTimeRange()
    // stay correct when the time-range popover closes and the picker unmounts.
    if (timeRangePicker) {
      timeRangeType = timeRangePicker.getType();
      const custom = timeRangePicker.getCustomValues();
      customFromTime = custom.from;
      customToTime = custom.to;
    }
    await Promise.all([loadServices(), loadHostnames()]);
    applyFilters();
  }

  // Compute current export filters for the dialog
  let exportFilters = $derived({
    projectId:
      selectedProjects.length === 1
        ? selectedProjects[0]
        : selectedProjects,
    service:
      selectedServices.length > 0
        ? selectedServices.length === 1
          ? selectedServices[0]
          : selectedServices
        : undefined,
    level:
      selectedLevels.length > 0
        ? selectedLevels.length === 1
          ? selectedLevels[0]
          : selectedLevels
        : undefined,
    hostname:
      selectedHostnames.length > 0
        ? selectedHostnames.length === 1
          ? selectedHostnames[0]
          : selectedHostnames
        : undefined,
    traceId: traceId || undefined,
    sessionId: sessionId || undefined,
    q: searchQuery || undefined,
    from: getTimeRange().from.toISOString(),
    to: getTimeRange().to.toISOString(),
  });

  const timeRangeLabel = $derived.by(() => {
    switch (timeRangeType) {
      case "last_hour": return "Last hour";
      case "last_24h": return "Last 24 hours";
      case "last_7d": return "Last 7 days";
      case "custom": return "Custom range";
      default: return "Time range";
    }
  });

  // Label shown inside each filter pill. Short and consistent so the pill
  // row stays scannable at a glance; truncation keeps ID-like values in bounds.
  function truncate(s: string, max = 16): string {
    return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
  }

  const projectsPillLabel = $derived.by(() => {
    if (selectedProjects.length === 0) return "Projects: none";
    if (projects.length > 0 && selectedProjects.length === projects.length) return "All projects";
    if (selectedProjects.length === 1) {
      return `Project: ${truncate(projects.find((p) => p.id === selectedProjects[0])?.name ?? "\u2014")}`;
    }
    return `Projects: ${selectedProjects.length}`;
  });
  const projectsPillActive = $derived(
    selectedProjects.length === 0 ||
    (projects.length > 0 && selectedProjects.length < projects.length)
  );

  const servicesPillLabel = $derived.by(() => {
    if (selectedServices.length === 0) return "All services";
    if (selectedServices.length === 1) return `Service: ${truncate(selectedServices[0])}`;
    return `Services: ${selectedServices.length}`;
  });
  const servicesPillActive = $derived(selectedServices.length > 0);

  const hostsPillLabel = $derived.by(() => {
    if (selectedHostnames.length === 0) return "All hosts";
    if (selectedHostnames.length === 1) return `Host: ${truncate(selectedHostnames[0])}`;
    return `Hosts: ${selectedHostnames.length}`;
  });
  const hostsPillActive = $derived(selectedHostnames.length > 0);

  const levelsPillLabel = $derived.by(() => {
    if (selectedLevels.length === 0 || selectedLevels.length === 5) return "All levels";
    if (selectedLevels.length === 1) {
      return `Level: ${selectedLevels[0]}`;
    }
    return `Levels: ${selectedLevels.length}`;
  });
  const levelsPillActive = $derived(
    selectedLevels.length > 0 && selectedLevels.length < 5
  );

  const tracePillLabel = $derived(
    traceId.trim().length > 0 ? `Trace: ${truncate(traceId, 10)}` : "Trace ID"
  );
  const tracePillActive = $derived(traceId.trim().length > 0);

  const sessionPillLabel = $derived(
    sessionId.trim().length > 0 ? `Session: ${truncate(sessionId, 10)}` : "Session ID"
  );
  const sessionPillActive = $derived(sessionId.trim().length > 0);

  const metadataPillCount = $derived(
    metadataFilters.filter((f) => f.key.trim().length > 0).length
  );
  const metadataPillLabel = $derived(
    metadataPillCount > 0 ? `Metadata: ${metadataPillCount}` : "Metadata"
  );
  const metadataPillActive = $derived(metadataPillCount > 0);

  const activeFilterCount = $derived(
    (projectsPillActive ? 1 : 0) +
    (servicesPillActive ? 1 : 0) +
    (hostsPillActive ? 1 : 0) +
    (levelsPillActive ? 1 : 0) +
    (tracePillActive ? 1 : 0) +
    (sessionPillActive ? 1 : 0) +
    metadataPillCount
  );

  function clearAllFilters() {
    traceId = "";
    sessionId = "";
    selectedProjects = projects.map((p) => p.id);
    selectedServices = [];
    selectedHostnames = [];
    selectedLevels = [];
    metadataFilters = [];
    applyFilters();
  }

  function formatDateTime(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
</script>

<svelte:head>
  <title>Search Logs - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
      <div class="mb-6">
        <div class="flex items-center gap-3 mb-2">
          <SearchIcon class="w-8 h-8 text-primary" />
          <h1 class="text-3xl font-bold tracking-tight">Log Search</h1>
        </div>
        <p class="text-muted-foreground">
          Search and filter your application logs
        </p>
      </div>

      <div class="mb-6 rounded-lg border bg-card p-2 sm:p-3 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex gap-2 flex-1 min-w-[280px]">
            <Input
              id="search"
              type="search"
              placeholder={searchMode === "fulltext" ? "Search words..." : "Find text anywhere..."}
              bind:value={searchQuery}
              oninput={debouncedSearch}
              class="flex-1 h-9"
            />
            <Select.Root
              type="single"
              value={searchMode}
              onValueChange={(v) => {
                if (v && (v === "fulltext" || v === "substring")) {
                  searchMode = v;
                  sessionStorage.setItem("logtide_search_mode", searchMode);
                  if (searchQuery) {
                    debouncedSearch();
                  }
                }
              }}
            >
              <Select.Trigger class="w-[130px] h-9" title="Search mode: Full-text (word-based) or Substring (find anywhere)">
                {searchMode === "fulltext" ? "Full-text" : "Substring"}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="fulltext">Full-text</Select.Item>
                <Select.Item value="substring">Substring</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="outline" size="sm" class="gap-2" data-testid="filter-pill-time-range">
                  <Clock class="w-4 h-4" />
                  <span>{timeRangeLabel}</span>
                  <ChevronDown class="w-4 h-4 opacity-50" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[320px] max-w-[90vw] p-4" align="end">
              <TimeRangePicker
                bind:this={timeRangePicker}
                initialType={timeRangeType}
                initialCustomFrom={customFromTime}
                initialCustomTo={customToTime}
                onchange={handleTimeRangeChange}
              />
            </Popover.Content>
          </Popover.Root>

          <div class="flex items-center gap-2 ml-auto">
            <Label for="live-tail" class="m-0 flex items-center gap-1.5 text-sm font-normal cursor-pointer">
              <Radio
                class="w-3.5 h-3.5 {liveTail
                  ? 'text-green-500 animate-pulse'
                  : 'text-muted-foreground'}"
              />
              Live tail
            </Label>
            <Switch id="live-tail" bind:checked={liveTail} />
            {#if liveTail}
              <Select.Root
                type="single"
                value={String(liveTailLimit)}
                onValueChange={(v) => {
                  if (v) {
                    liveTailLimit = parseInt(v, 10);
                    localStorage.setItem("logtide_livetail_limit", String(liveTailLimit));
                    if (logs.length > liveTailLimit) {
                      logs = logs.slice(0, liveTailLimit);
                    }
                  }
                }}
              >
                <Select.Trigger class="w-[95px] h-9">
                  {liveTailLimit}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="50">50</Select.Item>
                  <Select.Item value="100">100</Select.Item>
                  <Select.Item value="200">200</Select.Item>
                  <Select.Item value="500">500</Select.Item>
                  <Select.Item value="1000">1000</Select.Item>
                </Select.Content>
              </Select.Root>
            {/if}
          </div>

          <Button
            variant="outline"
            size="sm"
            onclick={() => (exportDialogOpen = true)}
            disabled={liveTail || logs.length === 0}
            class="gap-2"
          >
            <Download class="w-4 h-4" />
            <span class="hidden sm:inline">Export</span>
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-dashed">
          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={projectsPillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                >
                  <span>{projectsPillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[280px] max-w-[90vw] p-0" align="start">
              <div class="p-1.5 border-b">
                <div class="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={async () => {
                      selectedProjects = projects.map((p) => p.id);
                      await Promise.all([loadServices(), loadHostnames()]);
                      applyFilters();
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedProjects = [];
                      availableServices = [];
                      availableHostnames = [];
                      applyFilters();
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div class="max-h-[260px] overflow-y-auto p-1.5">
                <div class="space-y-1">
                  {#each projects as project}
                    <label
                      class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm"
                    >
                      <input
                        type="checkbox"
                        value={project.id}
                        checked={selectedProjects.includes(project.id)}
                        onchange={async (e) => {
                          if (e.currentTarget.checked) {
                            selectedProjects = [...selectedProjects, project.id];
                          } else {
                            selectedProjects = selectedProjects.filter(
                              (id) => id !== project.id,
                            );
                          }
                          await Promise.all([loadServices(), loadHostnames()]);
                          applyFilters();
                        }}
                        class="h-4 w-4 rounded border-gray-300"
                      />
                      <span class="text-sm flex-1">{project.name}</span>
                    </label>
                  {/each}
                </div>
              </div>
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={servicesPillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                >
                  <span>{servicesPillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[280px] max-w-[90vw] p-0" align="start">
              <div class="p-1.5 border-b">
                <div class="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedServices = [...availableServices];
                      applyFilters();
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedServices = [];
                      applyFilters();
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div class="max-h-[260px] overflow-y-auto p-1.5">
                {#if isLoadingServices}
                  <div class="text-center py-4 text-sm text-muted-foreground">
                    Loading services...
                  </div>
                {:else if displayedServices().length === 0}
                  <div class="text-center py-4 text-sm text-muted-foreground">
                    No services available
                  </div>
                {:else}
                  <div class="space-y-1">
                    {#each displayedServices() as service}
                      {@const hasLogsInTimeRange = availableServices.includes(service)}
                      <label
                        class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm"
                      >
                        <input
                          type="checkbox"
                          value={service}
                          checked={selectedServices.includes(service)}
                          onchange={(e) => {
                            if (e.currentTarget.checked) {
                              selectedServices = [...selectedServices, service];
                            } else {
                              selectedServices = selectedServices.filter(
                                (s) => s !== service,
                              );
                            }
                            applyFilters();
                          }}
                          class="h-4 w-4 rounded border-gray-300"
                        />
                        <span class="text-sm flex-1 {!hasLogsInTimeRange ? 'text-muted-foreground italic' : ''}">{service}</span>
                        {#if !hasLogsInTimeRange}
                          <span class="text-xs text-muted-foreground">(no logs)</span>
                        {/if}
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={hostsPillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                >
                  <span>{hostsPillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[280px] max-w-[90vw] p-0" align="start">
              <div class="p-1.5 border-b">
                <div class="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedHostnames = [...availableHostnames];
                      applyFilters();
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedHostnames = [];
                      applyFilters();
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div class="max-h-[260px] overflow-y-auto p-1.5">
                {#if isLoadingHostnames}
                  <div class="text-center py-4 text-sm text-muted-foreground">
                    Loading hostnames...
                  </div>
                {:else if displayedHostnames().length === 0}
                  <div class="text-center py-4 text-sm text-muted-foreground">
                    No hostnames available
                  </div>
                {:else}
                  <div class="space-y-1">
                    {#each displayedHostnames() as hostname}
                      {@const hasLogsInTimeRange = availableHostnames.includes(hostname)}
                      <label
                        class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm"
                      >
                        <input
                          type="checkbox"
                          value={hostname}
                          checked={selectedHostnames.includes(hostname)}
                          onchange={(e) => {
                            if (e.currentTarget.checked) {
                              selectedHostnames = [...selectedHostnames, hostname];
                            } else {
                              selectedHostnames = selectedHostnames.filter(
                                (h) => h !== hostname,
                              );
                            }
                            applyFilters();
                          }}
                          class="h-4 w-4 rounded border-gray-300"
                        />
                        <span class="text-sm flex-1 font-mono {!hasLogsInTimeRange ? 'text-muted-foreground italic' : ''}">{hostname}</span>
                        {#if !hasLogsInTimeRange}
                          <span class="text-xs text-muted-foreground">(no logs)</span>
                        {/if}
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={levelsPillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                >
                  <span>{levelsPillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[240px] max-w-[90vw] p-0" align="start">
              <div class="p-1.5 border-b">
                <div class="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedLevels = ["debug", "info", "warn", "error", "critical"];
                      applyFilters();
                    }}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="flex-1 h-7 text-xs"
                    onclick={() => {
                      selectedLevels = [];
                      applyFilters();
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div class="max-h-[260px] overflow-y-auto p-1.5">
                <div class="space-y-1">
                  {#each ["debug", "info", "warn", "error", "critical"] as level}
                    <label
                      class="flex items-center gap-2 cursor-pointer hover:bg-accent px-2 py-1 rounded-sm"
                    >
                      <input
                        type="checkbox"
                        value={level}
                        checked={selectedLevels.includes(level)}
                        onchange={(e) => {
                          if (e.currentTarget.checked) {
                            selectedLevels = [...selectedLevels, level];
                          } else {
                            selectedLevels = selectedLevels.filter((l) => l !== level);
                          }
                          applyFilters();
                        }}
                        class="h-4 w-4 rounded border-gray-300"
                      />
                      <span class="text-sm flex-1 capitalize">{level}</span>
                    </label>
                  {/each}
                </div>
              </div>
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={tracePillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                  data-testid="filter-pill-trace-id"
                >
                  <span>{tracePillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[280px] max-w-[90vw] p-2 space-y-2" align="start">
              <Label for="traceId" class="text-xs uppercase text-muted-foreground">Trace ID</Label>
              <Input
                id="traceId"
                type="text"
                placeholder="Filter by trace ID..."
                bind:value={traceId}
                oninput={debouncedSearch}
                class="h-8 text-sm"
              />
              {#if traceId.trim().length > 0}
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground"
                  onclick={() => { traceId = ""; applyFilters(); }}
                >
                  Clear
                </Button>
              {/if}
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={sessionPillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                >
                  <span>{sessionPillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[280px] max-w-[90vw] p-2 space-y-2" align="start">
              <Label for="sessionId" class="text-xs uppercase text-muted-foreground">Session ID</Label>
              <Input
                id="sessionId"
                type="text"
                placeholder="Filter by session ID..."
                bind:value={sessionId}
                oninput={debouncedSearch}
                class="h-8 text-sm"
              />
              {#if sessionId.trim().length > 0}
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground"
                  onclick={() => { sessionId = ""; applyFilters(); }}
                >
                  Clear
                </Button>
              {/if}
            </Popover.Content>
          </Popover.Root>

          <Popover.Root>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant={metadataPillActive ? "secondary" : "outline"}
                  size="sm"
                  class="h-7 gap-1.5 text-xs font-normal"
                  data-testid="filter-pill-metadata"
                >
                  <span>{metadataPillLabel}</span>
                  <ChevronDown class="w-3 h-3 opacity-60" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-[360px] max-w-[90vw] p-2 space-y-2 max-h-[70vh] overflow-y-auto" align="start">
              <Label class="text-xs uppercase text-muted-foreground">Metadata filters</Label>
              <MetadataFilterBuilder bind:filters={metadataFilters} />
              {#if metadataFilters.length > 0}
                <div class="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    data-testid="metadata-filter-apply"
                    onclick={() => applyFilters()}
                  >
                    Apply
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="metadata-filter-clear-all"
                    onclick={() => { metadataFilters = []; applyFilters(); }}
                    class="text-muted-foreground"
                  >
                    Clear
                  </Button>
                </div>
              {/if}
            </Popover.Content>
          </Popover.Root>

          {#if activeFilterCount > 0}
            <button
              type="button"
              class="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              onclick={clearAllFilters}
            >
              Clear all
            </button>
          {/if}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle>
              {#if effectiveTotalLogs > 0}
                {effectiveTotalLogs.toLocaleString("en-US")}
                {effectiveTotalLogs === 1 ? "log" : "logs"}
                {#if liveTail}
                  <span class="text-sm font-normal text-muted-foreground"
                    >(last {liveTailLimit})</span
                  >
                {/if}
              {:else}
                No logs
              {/if}
            </CardTitle>
            <div class="flex items-center gap-2">
              <div class="inline-flex rounded-md border border-input bg-background" role="group" aria-label="View mode">
                <Button
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="sm"
                  onclick={() => {
                    viewMode = "table";
                    sessionStorage.setItem("logtide_view_mode", "table");
                  }}
                  class="rounded-r-none border-r gap-1.5"
                  title="Table view"
                  aria-label="Table view"
                  aria-pressed={viewMode === "table"}
                >
                  <Table2 class="w-4 h-4" />
                  <span class="hidden sm:inline">Table</span>
                </Button>
                <Button
                  variant={viewMode === "terminal" ? "secondary" : "ghost"}
                  size="sm"
                  onclick={() => {
                    viewMode = "terminal";
                    sessionStorage.setItem("logtide_view_mode", "terminal");
                  }}
                  class="rounded-l-none gap-1.5"
                  title="Terminal view"
                  aria-label="Terminal view"
                  aria-pressed={viewMode === "terminal"}
                >
                  <SquareTerminal class="w-4 h-4" />
                  <span class="hidden sm:inline">Terminal</span>
                </Button>
              </div>
              {#if viewMode === "terminal"}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => layoutStore.toggleTerminalWrap()}
                  title={terminalWrapEnabled ? "Disable text wrapping (horizontal scroll)" : "Enable text wrapping"}
                  aria-label={terminalWrapEnabled ? "Disable wrapping" : "Enable wrapping"}
                  class="gap-1.5"
                >
                  <WrapText class="w-4 h-4 {terminalWrapEnabled ? 'text-primary' : 'text-muted-foreground'}" />
                  <span class="hidden sm:inline">{terminalWrapEnabled ? "Wrap" : "No wrap"}</span>
                </Button>
              {/if}
              {#if viewMode === "table"}
                <ColumnConfigMenu
                  bind:columns={customColumns}
                  onchange={(cols) => { columnStore?.set(cols); }}
                />
              {/if}
              {#if liveTail}
                <Badge variant="default" class="gap-1.5 animate-pulse">
                  <Radio class="w-3 h-3" />
                  Live
                </Badge>
              {/if}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {#if !hasLoadedOnce || (isLoading && logs.length === 0)}
            <SkeletonTable rows={8} columns={6} />
          {:else if paginatedLogs.length === 0}
            {#if searchQuery.trim() || activeFilterCount > 0}
              <div class="text-center py-16 text-muted-foreground space-y-2">
                <p class="text-sm">No logs match the current filters.</p>
                <button
                  type="button"
                  class="text-xs underline underline-offset-2 hover:text-foreground"
                  onclick={clearAllFilters}
                >
                  Clear filters
                </button>
              </div>
            {:else}
              <EmptyLogs />
            {/if}
          {:else if viewMode === "terminal"}
            <TableLoadingOverlay loading={isLoading}>
            <TerminalLogView
              logs={paginatedLogs}
              isLiveTail={liveTail}
              maxHeight="600px"
            />
            </TableLoadingOverlay>
          {:else}
            <TableLoadingOverlay loading={isLoading}>
            <div class="rounded-md border overflow-x-auto" bind:this={logsContainer}>
              <Table class="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-[180px]">Time</TableHead>
                    <TableHead class="w-[120px]">Project</TableHead>
                    <TableHead class="w-[150px]">Service</TableHead>
                    <TableHead class="w-[100px]">Level</TableHead>
                    <TableHead>Message</TableHead>
                    {#each customColumns as col (col)}
                      <TableHead class="w-[120px]">{col}</TableHead>
                    {/each}
                    <TableHead class="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {#each paginatedLogs as log, i}
                    {@const globalIndex = i}
                    <TableRow data-log-row class={selectedLogIndex === globalIndex ? 'bg-accent/50 ring-1 ring-primary/30' : ''}>
                      <TableCell class="font-mono text-xs">
                        {formatDateTime(log.time)}
                      </TableCell>
                      <TableCell>
                        <a
                          href="/dashboard/projects/{log.projectId}"
                          class="inline-flex items-center rounded-md border border-input bg-background px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                          {projects.find((p) => p.id === log.projectId)?.name ||
                            "Unknown"}
                        </a>
                      </TableCell>
                      <TableCell>
                        <div class="flex flex-col gap-0.5">
                          <button
                            onclick={() => {
                              if (!selectedServices.includes(log.service)) {
                                selectedServices = [
                                  ...selectedServices,
                                  log.service,
                                ];
                                applyFilters();
                              }
                            }}
                            title="Click to filter by this service"
                            class="hover:opacity-80 transition-opacity"
                          >
                            <Badge variant="outline">{log.service}</Badge>
                          </button>
                          {#if log.metadata?.hostname}
                            <button
                              onclick={() => {
                                const hostname = log.metadata?.hostname;
                                if (hostname && !selectedHostnames.includes(hostname)) {
                                  selectedHostnames = [...selectedHostnames, hostname];
                                  applyFilters();
                                }
                              }}
                              title="Click to filter by this host"
                              class="text-xs text-muted-foreground font-mono hover:text-foreground transition-colors truncate max-w-[140px]"
                            >
                              @{log.metadata.hostname}
                            </button>
                          {/if}
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase {getLevelColor(
                            log.level,
                          )} hover:opacity-80 transition-opacity cursor-pointer"
                          onclick={() => {
                            if (!selectedLevels.includes(log.level)) {
                              selectedLevels = [...selectedLevels, log.level];
                              applyFilters();
                            }
                          }}
                          title="Click to filter by this level"
                        >
                          {log.level}
                        </button>
                      </TableCell>
                      <TableCell class="max-w-md truncate"
                        >{log.message}</TableCell
                      >
                      {#each customColumns as col (col)}
                        {@const cellValue = resolveMetadataPath(log.metadata, col)}
                        <TableCell
                          class="font-mono text-xs max-w-[120px] truncate"
                          title={cellValue !== undefined && cellValue !== null
                            ? formatMetadataCell(cellValue)
                            : undefined}
                        >
                          {#if cellValue !== undefined && cellValue !== null}
                            {formatMetadataCell(cellValue)}
                          {:else}
                            <span class="text-muted-foreground">-</span>
                          {/if}
                        </TableCell>
                      {/each}
                      <TableCell>
                        <div class="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onclick={() => toggleRow(globalIndex)}
                          >
                            {expandedRows.has(globalIndex) ? "Hide" : "Details"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onclick={() => openContextDialog(log)}
                            title="View logs before and after this entry"
                          >
                            Context
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {#if expandedRows.has(globalIndex)}
                      <TableRow>
                        <TableCell colspan={6 + customColumns.length} class="bg-muted/50 !p-0">
                          <div class="p-4 space-y-3 w-0 min-w-full">
                            <div>
                              <span class="font-semibold">Full Message:</span>
                              <div
                                class="mt-2 p-3 bg-background rounded-md text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
                              >
                                {log.message}
                              </div>
                            </div>
                            {#if log.traceId}
                              <div class="flex items-center flex-wrap gap-1.5">
                                <span class="font-semibold">Trace ID:</span>
                                {#if log.projectId}
                                  <a
                                    href="/dashboard/traces/{log.traceId}?projectId={log.projectId}"
                                    class="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/10"
                                    title="Open trace timeline"
                                  >
                                    {log.traceId}
                                    <ArrowUpRight class="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
                                  </a>
                                  <button
                                    class="inline-flex items-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                    onclick={() => {
                                      traceId = log.traceId || "";
                                      applyFilters();
                                    }}
                                    title="Filter by this trace ID"
                                  >
                                    <Filter class="h-3 w-3" />
                                  </button>
                                {:else}
                                  <button
                                    class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-primary/10"
                                    onclick={() => {
                                      traceId = log.traceId || "";
                                      applyFilters();
                                    }}
                                    title="Filter by this trace ID"
                                  >
                                    {log.traceId}
                                    <Filter class="h-3 w-3 opacity-60" />
                                  </button>
                                {/if}
                              </div>
                            {/if}
                            {#if log.sessionId}
                              <div class="flex items-center flex-wrap gap-1.5">
                                <span class="font-semibold">Session ID:</span>
                                <button
                                  class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs text-teal-600 transition-colors hover:bg-teal-500/10 dark:text-teal-400"
                                  onclick={() => {
                                    sessionId = log.sessionId || "";
                                    applyFilters();
                                  }}
                                  title="Filter by this session ID"
                                >
                                  {log.sessionId}
                                  <Filter class="h-3 w-3 opacity-60" />
                                </button>
                              </div>
                            {/if}
                            {#if log.id && logIdentifiers.has(log.id) && (logIdentifiers.get(log.id)?.length ?? 0) > 0}
                              <div>
                                <span class="font-semibold">Identifiers:</span>
                                <div class="flex flex-wrap items-center gap-2 mt-2">
                                  {#each logIdentifiers.get(log.id) ?? [] as identifier}
                                    <IdentifierBadge
                                      type={identifier.type}
                                      value={identifier.value}
                                      onclick={() => openCorrelationDialog(log, identifier.type, identifier.value)}
                                    />
                                  {/each}
                                  <a
                                    href="/dashboard/settings/patterns"
                                    class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-dashed border-muted-foreground/50 text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
                                  >
                                    <Settings2 class="w-3 h-3" />
                                    <span>Configure</span>
                                  </a>
                                </div>
                              </div>
                            {/if}
                            {#if log.metadata}
                              {@const metaKey = `meta-${log.id ?? globalIndex}`}
                              <div>
                                <span class="font-semibold">Metadata:</span>
                                <div class="relative mt-2">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    class="absolute right-1 top-1 z-10 h-6 w-6 bg-background/80 backdrop-blur hover:bg-accent"
                                    title="Copy metadata"
                                    onclick={() => copyMetadata(metaKey, log.metadata)}
                                  >
                                    {#if copiedMetaKey === metaKey}
                                      <Check class="h-3 w-3 text-green-500" />
                                    {:else}
                                      <Copy class="h-3 w-3" />
                                    {/if}
                                  </Button>
                                  <div class="p-3 pr-9 bg-background rounded-md max-h-64 overflow-auto">
                                    <pre class="text-xs w-max">{JSON.stringify(
                                      log.metadata,
                                      null,
                                      2,
                                    )}</pre>
                                  </div>
                                </div>
                              </div>
                            {/if}
                            {#if isErrorLevel(log.level) && log.id}
                              <div class="pt-2 border-t mt-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onclick={() => openExceptionDialog(log)}
                                  class="gap-2"
                                >
                                  <AlertTriangle class="w-4 h-4 text-red-500" />
                                  View Exception Details
                                </Button>
                              </div>
                            {/if}
                            {#if getBreadcrumbs(log).length > 0}
                              {@const crumbs = getBreadcrumbs(log)}
                              <div class="pt-2 border-t mt-3">
                                <button
                                  type="button"
                                  class="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                                  onclick={() => toggleBreadcrumbs(globalIndex)}
                                >
                                  <ListTree class="w-4 h-4" />
                                  Breadcrumbs ({crumbs.length})
                                  <span class="text-xs ml-auto">{expandedBreadcrumbs.has(globalIndex) ? "▾" : "▸"}</span>
                                </button>
                                {#if expandedBreadcrumbs.has(globalIndex)}
                                  <div class="mt-2 max-h-64 overflow-auto">
                                    <BreadcrumbTimeline breadcrumbs={crumbs} eventTime={log.time} />
                                  </div>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        </TableCell>
                      </TableRow>
                    {/if}
                  {/each}
                </TableBody>
              </Table>
            </div>

            {#if !liveTail && logs.length > 0}
              <div class="flex items-center justify-between mt-6 px-2">
                <div class="text-sm text-muted-foreground">
                  {#if totalLogs > 0}
                    Showing {((currentPage - 1) * pageSize + 1).toLocaleString('en-US')} to {Math.min(currentPage * pageSize, totalLogs).toLocaleString('en-US')} of {totalLogs.toLocaleString('en-US')} logs
                  {:else}
                    Showing {(currentPage - 1) * pageSize + 1} to {(currentPage - 1) * pageSize + logs.length} logs
                  {/if}
                </div>
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={previousPage}
                    disabled={currentPage === 1 || isLoading}
                  >
                    <ChevronLeft class="w-4 h-4" />
                    <span class="hidden sm:inline">Previous</span>
                  </Button>
                  {#if totalPages > 0}
                    <div class="flex items-center gap-1">
                      {#if totalPages <= 7}
                        {#each Array.from({ length: totalPages }, (_, i) => i + 1) as pg}
                          <Button
                            variant={currentPage === pg ? "default" : "outline"}
                            size="sm"
                            onclick={() => goToPage(pg)}
                            disabled={isLoading}
                            class="w-10"
                          >
                            {pg}
                          </Button>
                        {/each}
                      {:else if currentPage <= 3}
                        {#each [1, 2, 3, 4] as pg}
                          <Button
                            variant={currentPage === pg ? "default" : "outline"}
                            size="sm"
                            onclick={() => goToPage(pg)}
                            disabled={isLoading}
                            class="w-10"
                          >
                            {pg}
                          </Button>
                        {/each}
                        <span class="px-2 text-muted-foreground">…</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => goToPage(totalPages)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          {totalPages}
                        </Button>
                      {:else if currentPage >= totalPages - 2}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => goToPage(1)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          1
                        </Button>
                        <span class="px-2 text-muted-foreground">…</span>
                        {#each [totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as pg}
                          <Button
                            variant={currentPage === pg ? "default" : "outline"}
                            size="sm"
                            onclick={() => goToPage(pg)}
                            disabled={isLoading}
                            class="w-10"
                          >
                            {pg}
                          </Button>
                        {/each}
                      {:else}
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => goToPage(1)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          1
                        </Button>
                        <span class="px-2 text-muted-foreground">…</span>
                        {#each [currentPage - 1, currentPage, currentPage + 1] as pg}
                          <Button
                            variant={currentPage === pg ? "default" : "outline"}
                            size="sm"
                            onclick={() => goToPage(pg)}
                            disabled={isLoading}
                            class="w-10"
                          >
                            {pg}
                          </Button>
                        {/each}
                        <span class="px-2 text-muted-foreground">…</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onclick={() => goToPage(totalPages)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          {totalPages}
                        </Button>
                      {/if}
                    </div>
                  {:else}
                    <span class="text-sm text-muted-foreground px-3">
                      Page {currentPage.toLocaleString('en-US')}
                    </span>
                  {/if}
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={nextPage}
                    disabled={!hasMoreLogs || isLoading || (totalPages > 0 && currentPage >= totalPages)}
                  >
                    <span class="hidden sm:inline">Next</span>
                    <ChevronRight class="w-4 h-4" />
                  </Button>
                </div>
              </div>
            {/if}
            </TableLoadingOverlay>
          {/if}
        </CardContent>
      </Card>
    </div>

<LogContextDialog
  open={contextDialogOpen}
  projectId={selectedLogForContext?.projectId || ""}
  organizationId={$currentOrganization?.id || ""}
  selectedLog={selectedLogForContext}
  onClose={closeContextDialog}
/>

<ExceptionDetailsDialog
  open={exceptionDialogOpen}
  logId={selectedLogForException?.id || ""}
  organizationId={$currentOrganization?.id || ""}
  metadata={selectedLogForException?.metadata}
  onClose={closeExceptionDialog}
/>

<ExportLogsDialog
  bind:open={exportDialogOpen}
  totalLogs={totalLogs}
  filters={exportFilters}
/>

<CorrelationTimelineDialog
  open={correlationDialogOpen}
  projectId={selectedLogForCorrelation?.projectId || selectedProjects[0] || ""}
  identifierType={selectedIdentifierType}
  identifierValue={selectedIdentifierValue}
  referenceTime={selectedLogForCorrelation?.time}
  onClose={closeCorrelationDialog}
  onLogClick={(correlatedLog) => {
    closeCorrelationDialog();
    const logEntry = {
      id: correlatedLog.id,
      time: correlatedLog.time,
      service: correlatedLog.service,
      level: correlatedLog.level as LogEntry["level"],
      message: correlatedLog.message,
      metadata: correlatedLog.metadata ?? undefined,
      traceId: correlatedLog.traceId ?? undefined,
      projectId: correlatedLog.projectId || "",
    };
    openContextDialog(logEntry);
  }}
/>
