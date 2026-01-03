<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
  import { page } from "$app/state";
  import { currentOrganization } from "$lib/stores/organization";
  import { authStore } from "$lib/stores/auth";
  import { checklistStore } from "$lib/stores/checklist";
  import { ProjectsAPI } from "$lib/api/projects";
  import { logsAPI } from "$lib/api/logs";
  import { toastStore } from "$lib/stores/toast";
  import type { Project } from "@logward/shared";
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
  import { ExceptionDetailsDialog } from "$lib/components/exceptions";
  import ExportLogsDialog from "$lib/components/ExportLogsDialog.svelte";
  import EmptyLogs from "$lib/components/EmptyLogs.svelte";
  import TimeRangePicker, { type TimeRangeType } from "$lib/components/TimeRangePicker.svelte";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Download from "@lucide/svelte/icons/download";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import SearchIcon from "@lucide/svelte/icons/search";
  import Radio from "@lucide/svelte/icons/radio";

  interface LogEntry {
    id?: string;
    time: string;
    service: string;
    level: "debug" | "info" | "warn" | "error" | "critical";
    message: string;
    metadata?: Record<string, any>;
    traceId?: string;
    projectId: string;
  }

  let token = $state<string | null>(null);
  let projects = $state<Project[]>([]);
  let logs = $state<LogEntry[]>([]);
  let totalLogs = $state(0);
  let expandedRows = $state(new Set<number>());
  let isLoading = $state(false);
  let logsContainer = $state<HTMLDivElement | null>(null);

  let searchQuery = $state("");
  let traceId = $state("");
  let selectedProjects = $state<string[]>([]);
  let selectedServices = $state<string[]>([]);
  let selectedLevels = $state<string[]>([]);
  let liveTail = $state(false);
  let liveTailConnectionKey = $state<string | null>(null);

  let projectsAPI = $derived(new ProjectsAPI(() => token));

  authStore.subscribe((state) => {
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
    availableServices = [];
    logs = [];
    totalLogs = 0;
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

    const fromParam = params.get("from");
    const toParam = params.get("to");
    if (fromParam && toParam && !customFromTime && !customToTime) {
      timeRangeType = "custom";
      customFromTime = formatDateForInput(fromParam);
      customToTime = formatDateForInput(toParam);
    }

    if (shouldLoadLogs && selectedProjects.length > 0) {
      urlParamsProcessed = true;
      loadServices().then(() => loadLogs());
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
      const response = await projectsAPI.getProjects($currentOrganization.id);
      projects = response.projects;

      if (projects.length > 0 && selectedProjects.length === 0) {
        selectedProjects = projects.map((p) => p.id);
        await loadServices();
        loadLogs();
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
      projects = [];
    }
  }

  // Pagination state
  let currentPage = $state(1);
  let totalPages = $derived(Math.ceil(totalLogs / pageSize));

  async function loadLogs() {
    if (selectedProjects.length === 0) {
      logs = [];
      totalLogs = 0;
      return;
    }

    isLoading = true;

    try {
      const timeRange = getTimeRange();

      const offset = (currentPage - 1) * pageSize;

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
        traceId: traceId || undefined,
        q: searchQuery || undefined,
        from: timeRange.from.toISOString(),
        to: timeRange.to.toISOString(),
        limit: pageSize,
        offset: offset,
      });

      logs = response.logs;
      totalLogs = response.total;
    } catch (e) {
      console.error("Failed to load logs:", e);
      logs = [];
    } finally {
      isLoading = false;
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      currentPage = page;
      loadLogs();
    }
  }

  function nextPage() {
    if (currentPage < totalPages) {
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
    stopLiveTail();
  });

  let availableServices = $state<string[]>([]);
  let isLoadingServices = $state(false);

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

  // Combine available services with selected services (in case selected ones aren't in current time range)
  let displayedServices = $derived(() => {
    const combined = new Set([...availableServices, ...selectedServices]);
    return [...combined].sort((a, b) => a.localeCompare(b));
  });

  let paginatedLogs = $derived(logs);
  let filteredLogs = $derived(logs);

  let effectiveTotalLogs = $derived(liveTail ? logs.length : totalLogs);

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

  function startLiveTail() {
    if (selectedProjects.length !== 1) return; // Live tail only works with single project

    try {
      const socket = logsAPI.createLogsWebSocket({
        projectId: selectedProjects[0],
        service:
          selectedServices.length === 1 ? selectedServices[0] : undefined,
        level: selectedLevels.length === 1 ? selectedLevels[0] : undefined,
      });

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "logs") {
            const newLogs = data.logs;

            logs = [...newLogs, ...logs].slice(0, 100);

            if (logsContainer) {
              setTimeout(
                () => logsContainer?.scrollTo({ top: 0, behavior: "smooth" }),
                100,
              );
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

  function openContextDialog(log: LogEntry) {
    selectedLogForContext = log;
    contextDialogOpen = true;
  }

  function closeContextDialog() {
    contextDialogOpen = false;
    selectedLogForContext = null;
  }

  function openExceptionDialog(log: LogEntry) {
    selectedLogForException = log;
    exceptionDialogOpen = true;
  }

  function closeExceptionDialog() {
    exceptionDialogOpen = false;
    selectedLogForException = null;
  }

  function isErrorLevel(level: string): boolean {
    return level === 'error' || level === 'critical';
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
    await loadServices();
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
    traceId: traceId || undefined,
    q: searchQuery || undefined,
    from: getTimeRange().from.toISOString(),
    to: getTimeRange().to.toISOString(),
  });

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
  <title>Search Logs - LogWard</title>
</svelte:head>

<div class="container mx-auto px-6 py-8 max-w-7xl">
      <div class="mb-6">
        <div class="flex items-center gap-3 mb-2">
          <SearchIcon class="w-8 h-8 text-primary" />
          <h1 class="text-3xl font-bold tracking-tight">Log Search</h1>
        </div>
        <p class="text-muted-foreground">
          Search and filter your application logs
        </p>
      </div>

      <Card class="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            <div class="space-y-2">
              <Label for="search">Search Message</Label>
              <Input
                id="search"
                type="search"
                placeholder="Search in messages..."
                bind:value={searchQuery}
                oninput={debouncedSearch}
              />
            </div>

            <div class="space-y-2">
              <Label for="traceId">Trace ID</Label>
              <Input
                id="traceId"
                type="text"
                placeholder="Filter by trace ID..."
                bind:value={traceId}
                oninput={debouncedSearch}
              />
            </div>

            <div class="space-y-2">
              <Label>Projects</Label>
              <Popover.Root>
                <Popover.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="outline"
                      role="combobox"
                      class="w-full justify-between font-normal"
                    >
                      <span class="truncate">
                        {#if selectedProjects.length === 0}
                          Select projects...
                        {:else if selectedProjects.length === projects.length}
                          All projects ({projects.length})
                        {:else if selectedProjects.length === 1}
                          {projects.find((p) => p.id === selectedProjects[0])
                            ?.name}
                        {:else}
                          {selectedProjects.length} projects selected
                        {/if}
                      </span>
                      <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  {/snippet}
                </Popover.Trigger>
                <Popover.Content class="w-[300px] p-0" align="start">
                  <div class="p-2 border-b">
                    <div class="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        class="flex-1"
                        onclick={async () => {
                          selectedProjects = projects.map((p) => p.id);
                          await loadServices();
                          applyFilters();
                        }}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        class="flex-1"
                        onclick={() => {
                          selectedProjects = [];
                          availableServices = [];
                          applyFilters();
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div class="max-h-[300px] overflow-y-auto p-2">
                    <div class="space-y-1">
                      {#each projects as project}
                        <label
                          class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm"
                        >
                          <input
                            type="checkbox"
                            value={project.id}
                            checked={selectedProjects.includes(project.id)}
                            onchange={async (e) => {
                              if (e.currentTarget.checked) {
                                selectedProjects = [
                                  ...selectedProjects,
                                  project.id,
                                ];
                              } else {
                                selectedProjects = selectedProjects.filter(
                                  (id) => id !== project.id,
                                );
                              }
                              await loadServices();
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
            </div>

            <div class="space-y-2">
              <Label>Services</Label>
              <Popover.Root>
                <Popover.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="outline"
                      role="combobox"
                      class="w-full justify-between font-normal"
                    >
                      <span class="truncate">
                        {#if selectedServices.length === 0}
                          All services
                        {:else if selectedServices.length === availableServices.length && availableServices.length > 0}
                          All services ({availableServices.length})
                        {:else if selectedServices.length === 1}
                          {selectedServices[0]}
                        {:else}
                          {selectedServices.length} services
                        {/if}
                      </span>
                      <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  {/snippet}
                </Popover.Trigger>
                <Popover.Content class="w-[300px] p-0" align="start">
                  <div class="p-2 border-b">
                    <div class="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        class="flex-1"
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
                        class="flex-1"
                        onclick={() => {
                          selectedServices = [];
                          applyFilters();
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div class="max-h-[300px] overflow-y-auto p-2">
                    {#if isLoadingServices}
                      <div
                        class="text-center py-4 text-sm text-muted-foreground"
                      >
                        Loading services...
                      </div>
                    {:else if displayedServices().length === 0}
                      <div
                        class="text-center py-4 text-sm text-muted-foreground"
                      >
                        No services available
                      </div>
                    {:else}
                      <div class="space-y-1">
                        {#each displayedServices() as service}
                          {@const hasLogsInTimeRange = availableServices.includes(service)}
                          <label
                            class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm"
                          >
                            <input
                              type="checkbox"
                              value={service}
                              checked={selectedServices.includes(service)}
                              onchange={(e) => {
                                if (e.currentTarget.checked) {
                                  selectedServices = [
                                    ...selectedServices,
                                    service,
                                  ];
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
            </div>

            <div class="space-y-2">
              <Label>Levels</Label>
              <Popover.Root>
                <Popover.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="outline"
                      role="combobox"
                      class="w-full justify-between font-normal"
                    >
                      <span class="truncate">
                        {#if selectedLevels.length === 0}
                          All levels
                        {:else if selectedLevels.length === 5}
                          All levels (5)
                        {:else if selectedLevels.length === 1}
                          {selectedLevels[0].charAt(0).toUpperCase() +
                            selectedLevels[0].slice(1)}
                        {:else}
                          {selectedLevels.length} levels
                        {/if}
                      </span>
                      <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  {/snippet}
                </Popover.Trigger>
                <Popover.Content class="w-[300px] p-0" align="start">
                  <div class="p-2 border-b">
                    <div class="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        class="flex-1"
                        onclick={() => {
                          selectedLevels = [
                            "debug",
                            "info",
                            "warn",
                            "error",
                            "critical",
                          ];
                          applyFilters();
                        }}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        class="flex-1"
                        onclick={() => {
                          selectedLevels = [];
                          applyFilters();
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div class="max-h-[300px] overflow-y-auto p-2">
                    <div class="space-y-1">
                      {#each ["debug", "info", "warn", "error", "critical"] as level}
                        <label
                          class="flex items-center gap-2 cursor-pointer hover:bg-accent px-3 py-2 rounded-sm"
                        >
                          <input
                            type="checkbox"
                            value={level}
                            checked={selectedLevels.includes(level)}
                            onchange={(e) => {
                              if (e.currentTarget.checked) {
                                selectedLevels = [...selectedLevels, level];
                              } else {
                                selectedLevels = selectedLevels.filter(
                                  (l) => l !== level,
                                );
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
            </div>

            <div class="flex items-end space-x-2 pb-2">
              <Switch id="live-tail" bind:checked={liveTail} />
              <Label for="live-tail">
                <div class="flex items-center gap-2">
                  <Radio
                    class="w-4 h-4 {liveTail
                      ? 'text-green-500 animate-pulse'
                      : ''}"
                  />
                  Live Tail
                </div>
              </Label>
            </div>
          </div>

          <div class="mt-4">
            <TimeRangePicker
              bind:this={timeRangePicker}
              initialType={timeRangeType}
              initialCustomFrom={customFromTime}
              initialCustomTo={customToTime}
              onchange={handleTimeRangeChange}
            />
          </div>

          <div class="flex gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onclick={() => (exportDialogOpen = true)}
              disabled={liveTail || totalLogs === 0}
              class="gap-2"
            >
              <Download class="w-4 h-4" />
              Export
              {#if totalLogs > 0}
                ({totalLogs.toLocaleString()})
              {/if}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle>
              {#if effectiveTotalLogs > 0}
                {effectiveTotalLogs}
                {effectiveTotalLogs === 1 ? "log" : "logs"}
                {#if liveTail}
                  <span class="text-sm font-normal text-muted-foreground"
                    >(last 100)</span
                  >
                {/if}
              {:else}
                No logs
              {/if}
            </CardTitle>
            {#if liveTail}
              <Badge variant="default">Live</Badge>
            {/if}
          </div>
        </CardHeader>
        <CardContent>
          {#if paginatedLogs.length === 0}
            <EmptyLogs />
          {:else}
            <div class="rounded-md border overflow-x-auto">
              <Table class="w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-[180px]">Time</TableHead>
                    <TableHead class="w-[120px]">Project</TableHead>
                    <TableHead class="w-[150px]">Service</TableHead>
                    <TableHead class="w-[100px]">Level</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead class="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {#each paginatedLogs as log, i}
                    {@const globalIndex = i}
                    <TableRow>
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
                        <TableCell colspan={6} class="bg-muted/50 !p-0">
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
                              <div>
                                <span class="font-semibold">Trace ID:</span>
                                <button
                                  class="ml-2 text-xs font-mono bg-purple-100 text-purple-800 px-2 py-1 rounded hover:bg-purple-200 transition-colors cursor-pointer"
                                  onclick={() => {
                                    traceId = log.traceId || "";
                                    applyFilters();
                                  }}
                                  title="Click to filter by this trace ID"
                                >
                                  {log.traceId}
                                </button>
                              </div>
                            {/if}
                            {#if log.metadata}
                              <div>
                                <span class="font-semibold">Metadata:</span>
                                <div class="mt-2 p-3 bg-background rounded-md max-h-64 overflow-auto">
                                  <pre class="text-xs w-max">{JSON.stringify(
                                    log.metadata,
                                    null,
                                    2,
                                  )}</pre>
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
                  Showing {(currentPage - 1) * pageSize + 1} to {Math.min(
                    currentPage * pageSize,
                    totalLogs,
                  )} of {totalLogs} logs
                </div>
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={previousPage}
                    disabled={currentPage === 1 || isLoading}
                  >
                    <ChevronLeft class="w-4 h-4" />
                    Previous
                  </Button>
                  <div class="flex items-center gap-1">
                    {#if totalPages <= 7}
                      {#each Array.from({ length: totalPages }, (_, i) => i + 1) as page}
                        <Button
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onclick={() => goToPage(page)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          {page}
                        </Button>
                      {/each}
                    {:else if currentPage <= 3}
                      {#each [1, 2, 3, 4] as page}
                        <Button
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onclick={() => goToPage(page)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          {page}
                        </Button>
                      {/each}
                      <span class="px-2">...</span>
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
                      <span class="px-2">...</span>
                      {#each [totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as page}
                        <Button
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onclick={() => goToPage(page)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          {page}
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
                      <span class="px-2">...</span>
                      {#each [currentPage - 1, currentPage, currentPage + 1] as page}
                        <Button
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onclick={() => goToPage(page)}
                          disabled={isLoading}
                          class="w-10"
                        >
                          {page}
                        </Button>
                      {/each}
                      <span class="px-2">...</span>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onclick={nextPage}
                    disabled={currentPage === totalPages || isLoading}
                  >
                    Next
                    <ChevronRight class="w-4 h-4" />
                  </Button>
                </div>
              </div>
            {/if}
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
  onClose={closeExceptionDialog}
/>

<ExportLogsDialog
  bind:open={exportDialogOpen}
  totalLogs={totalLogs}
  filters={exportFilters}
/>
