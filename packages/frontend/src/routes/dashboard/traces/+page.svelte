<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { currentOrganization } from "$lib/stores/organization";
  import { authStore } from "$lib/stores/auth";
  import { ProjectsAPI } from "$lib/api/projects";
  import { tracesAPI, type TraceRecord, type TraceStats, type ServiceDependencies } from "$lib/api/traces";
  import ServiceMap from "$lib/components/ServiceMap.svelte";
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
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Clock from "@lucide/svelte/icons/clock";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import Timer from "@lucide/svelte/icons/timer";
  import Layers from "@lucide/svelte/icons/layers";
  import Network from "@lucide/svelte/icons/network";

  let token = $state<string | null>(null);
  let projects = $state<Project[]>([]);
  let traces = $state<TraceRecord[]>([]);
  let stats = $state<TraceStats | null>(null);
  let dependencies = $state<ServiceDependencies | null>(null);
  let showServiceMap = $state(false);
  let totalTraces = $state(0);
  let isLoading = $state(false);
  let availableServices = $state<string[]>([]);

  // Filters
  let selectedProject = $state<string | null>(null);
  let selectedService = $state<string | null>(null);
  let errorOnly = $state(false);

  let projectsAPI = $derived(new ProjectsAPI(() => token));

  authStore.subscribe((state) => {
    token = state.token;
  });

  type TimeRangeType = "last_hour" | "last_24h" | "last_7d" | "custom";
  let timeRangeType = $state<TimeRangeType>("last_24h");
  let customFromTime = $state("");
  let customToTime = $state("");

  let pageSize = $state(25);
  let currentPage = $state(1);
  let totalPages = $derived(Math.ceil(totalTraces / pageSize));

  let lastLoadedOrg = $state<string | null>(null);

  onMount(() => {
    if ($currentOrganization) {
      loadProjects();
    }
  });

  $effect(() => {
    if (!$currentOrganization) {
      projects = [];
      traces = [];
      lastLoadedOrg = null;
      return;
    }

    if ($currentOrganization.id === lastLoadedOrg) return;

    loadProjects();
    lastLoadedOrg = $currentOrganization.id;
  });

  async function loadProjects() {
    if (!$currentOrganization) {
      projects = [];
      return;
    }

    try {
      const response = await projectsAPI.getProjects($currentOrganization.id);
      projects = response.projects;

      // Auto-select first project if none selected
      if (projects.length > 0 && !selectedProject) {
        selectedProject = projects[0].id;
        loadTraces();
        loadServices();
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
      projects = [];
    }
  }

  async function loadTraces() {
    if (!selectedProject) {
      traces = [];
      totalTraces = 0;
      return;
    }

    isLoading = true;

    try {
      const timeRange = getTimeRange(
        timeRangeType,
        customFromTime,
        customToTime,
      );

      const offset = (currentPage - 1) * pageSize;

      const response = await tracesAPI.getTraces({
        projectId: selectedProject,
        service: selectedService || undefined,
        error: errorOnly || undefined,
        from: timeRange.from.toISOString(),
        to: timeRange.to.toISOString(),
        limit: pageSize,
        offset: offset,
      });

      traces = response.traces;
      totalTraces = response.total;

      const statsResponse = await tracesAPI.getStats(
        selectedProject,
        timeRange.from.toISOString(),
        timeRange.to.toISOString()
      );
      stats = statsResponse;
    } catch (e) {
      console.error("Failed to load traces:", e);
      traces = [];
    } finally {
      isLoading = false;
    }
  }

  async function loadServices() {
    if (!selectedProject) {
      availableServices = [];
      return;
    }

    try {
      availableServices = await tracesAPI.getServices(selectedProject);
    } catch (e) {
      console.error("Failed to load services:", e);
      availableServices = [];
    }
  }

  async function loadDependencies() {
    if (!selectedProject) {
      dependencies = null;
      return;
    }

    try {
      const timeRange = getTimeRange(
        timeRangeType,
        customFromTime,
        customToTime,
      );
      dependencies = await tracesAPI.getDependencies(
        selectedProject,
        timeRange.from.toISOString(),
        timeRange.to.toISOString()
      );
    } catch (e) {
      console.error("Failed to load dependencies:", e);
      dependencies = null;
    }
  }

  function getTimeRange(
    type: TimeRangeType,
    customFrom: string,
    customTo: string,
  ): { from: Date; to: Date } {
    const now = new Date();
    let from: Date;

    switch (type) {
      case "last_hour":
        from = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "last_24h":
        from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "last_7d":
        from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "custom":
        from = customFrom
          ? new Date(customFrom)
          : new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const to = customTo ? new Date(customTo) : now;
        return { from, to };
      default:
        from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return { from, to: now };
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      currentPage = page;
      loadTraces();
    }
  }

  function nextPage() {
    if (currentPage < totalPages) {
      currentPage++;
      loadTraces();
    }
  }

  function previousPage() {
    if (currentPage > 1) {
      currentPage--;
      loadTraces();
    }
  }

  function applyFilters() {
    currentPage = 1;
    loadTraces();
    loadServices();
  }

  function setQuickTimeRange(type: TimeRangeType) {
    timeRangeType = type;
    if (type !== "custom") {
      customFromTime = "";
      customToTime = "";
    }
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

  function formatDuration(ms: number): string {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  function viewTrace(traceId: string) {
    if (selectedProject) {
      goto(`/traces/${traceId}?projectId=${selectedProject}`);
    }
  }
</script>

<svelte:head>
  <title>Traces - LogWard</title>
</svelte:head>

<div class="container mx-auto px-6 py-8 max-w-7xl">
      <div class="mb-6">
        <div class="flex items-center gap-3 mb-2">
          <GitBranch class="w-8 h-8 text-primary" />
          <h1 class="text-3xl font-bold tracking-tight">Distributed Traces</h1>
        </div>
        <p class="text-muted-foreground">
          View and analyze distributed traces from your applications
        </p>
      </div>

      {#if stats}
        <div class="grid gap-4 md:grid-cols-4 mb-6">
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <GitBranch class="w-5 h-5 text-muted-foreground" />
                <div>
                  <p class="text-sm text-muted-foreground">Total Traces</p>
                  <p class="text-2xl font-bold">{stats.total_traces}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <Layers class="w-5 h-5 text-muted-foreground" />
                <div>
                  <p class="text-sm text-muted-foreground">Total Spans</p>
                  <p class="text-2xl font-bold">{stats.total_spans}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <Timer class="w-5 h-5 text-muted-foreground" />
                <div>
                  <p class="text-sm text-muted-foreground">Avg Duration</p>
                  <p class="text-2xl font-bold">{formatDuration(stats.avg_duration_ms)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-center gap-3">
                <AlertCircle class="w-5 h-5 text-red-500" />
                <div>
                  <p class="text-sm text-muted-foreground">Error Rate</p>
                  <p class="text-2xl font-bold">{(stats.error_rate * 100).toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      {/if}

      <Card class="mb-6">
        <CardHeader class="flex flex-row items-center justify-between pb-4">
          <div class="flex items-center gap-2">
            <Network class="w-5 h-5 text-muted-foreground" />
            <CardTitle>Service Map</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onclick={() => {
              showServiceMap = !showServiceMap;
              if (showServiceMap && !dependencies) {
                loadDependencies();
              }
            }}
          >
            {showServiceMap ? "Hide" : "Show"} Service Map
          </Button>
        </CardHeader>
        <CardContent class="pt-0">
          {#if showServiceMap}
            {#if dependencies && (dependencies.nodes.length > 0 || dependencies.edges.length > 0)}
              <ServiceMap {dependencies} height="400px" />
            {:else if dependencies}
              <div class="flex items-center justify-center h-64 text-muted-foreground">
                <p>No inter-service calls detected. Service dependencies are extracted from parent-child span relationships across different services.</p>
              </div>
            {:else}
              <div class="flex items-center justify-center h-64">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            {/if}
          {/if}
        </CardContent>
      </Card>

      <Card class="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div class="space-y-2">
              <Label>Project</Label>
              <Select.Root
                type="single"
                value={{ value: selectedProject || "", label: projects.find(p => p.id === selectedProject)?.name || "Select project" }}
                onValueChange={(v) => {
                  if (v) {
                    selectedProject = v.value;
                    applyFilters();
                  }
                }}
              >
                <Select.Trigger class="w-full">
                  {projects.find((p) => p.id === selectedProject)?.name ||
                    "Select project"}
                </Select.Trigger>
                <Select.Content>
                  {#each projects as project}
                    <Select.Item value={project.id}>{project.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <div class="space-y-2">
              <Label>Service</Label>
              <Select.Root
                type="single"
                value={{ value: selectedService || "", label: selectedService || "All services" }}
                onValueChange={(v) => {
                  selectedService = v?.value || null;
                  applyFilters();
                }}
              >
                <Select.Trigger class="w-full">
                  {selectedService || "All services"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="">All services</Select.Item>
                  {#each availableServices as service}
                    <Select.Item value={service}>{service}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>

            <div class="space-y-2">
              <Label>Status</Label>
              <Select.Root
                type="single"
                value={{ value: errorOnly ? "error" : "all", label: errorOnly ? "Errors only" : "All traces" }}
                onValueChange={(v) => {
                  errorOnly = v?.value === "error";
                  applyFilters();
                }}
              >
                <Select.Trigger class="w-full">
                  {errorOnly ? "Errors only" : "All traces"}
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All traces</Select.Item>
                  <Select.Item value="error">Errors only</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div class="mt-4 space-y-3">
            <div class="flex items-center gap-2">
              <Clock class="w-4 h-4 text-muted-foreground" />
              <Label>Time Range</Label>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                variant={timeRangeType === "last_hour" ? "default" : "outline"}
                size="sm"
                onclick={() => setQuickTimeRange("last_hour")}
              >
                Last Hour
              </Button>
              <Button
                variant={timeRangeType === "last_24h" ? "default" : "outline"}
                size="sm"
                onclick={() => setQuickTimeRange("last_24h")}
              >
                Last 24 Hours
              </Button>
              <Button
                variant={timeRangeType === "last_7d" ? "default" : "outline"}
                size="sm"
                onclick={() => setQuickTimeRange("last_7d")}
              >
                Last 7 Days
              </Button>
              <Button
                variant={timeRangeType === "custom" ? "default" : "outline"}
                size="sm"
                onclick={() => setQuickTimeRange("custom")}
              >
                Custom
              </Button>
            </div>

            {#if timeRangeType === "custom"}
              <div class="grid gap-3 md:grid-cols-2 pt-2">
                <div class="space-y-2">
                  <Label for="from-time">From</Label>
                  <Input
                    id="from-time"
                    type="datetime-local"
                    bind:value={customFromTime}
                    onchange={applyFilters}
                  />
                </div>
                <div class="space-y-2">
                  <Label for="to-time">To</Label>
                  <Input
                    id="to-time"
                    type="datetime-local"
                    bind:value={customToTime}
                    onchange={applyFilters}
                  />
                </div>
              </div>
            {/if}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle>
              {#if totalTraces > 0}
                {totalTraces}
                {totalTraces === 1 ? "trace" : "traces"}
              {:else}
                No traces
              {/if}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {#if traces.length === 0}
            <div class="text-center py-12">
              <GitBranch class="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p class="text-muted-foreground">No traces found</p>
              <p class="text-sm text-muted-foreground mt-2">
                Send traces using the OTLP endpoint to see them here
              </p>
            </div>
          {:else}
            <div class="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-[180px]">Time</TableHead>
                    <TableHead class="w-[150px]">Service</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead class="w-[100px]">Duration</TableHead>
                    <TableHead class="w-[80px]">Spans</TableHead>
                    <TableHead class="w-[80px]">Status</TableHead>
                    <TableHead class="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {#each traces as trace}
                    <TableRow
                      class="cursor-pointer hover:bg-muted/50"
                      onclick={() => viewTrace(trace.trace_id)}
                    >
                      <TableCell class="font-mono text-xs">
                        {formatDateTime(trace.start_time)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {trace.root_service_name || trace.service_name}
                        </Badge>
                      </TableCell>
                      <TableCell class="max-w-md truncate">
                        {trace.root_operation_name || "-"}
                      </TableCell>
                      <TableCell class="font-mono text-sm">
                        {formatDuration(trace.duration_ms)}
                      </TableCell>
                      <TableCell class="text-center">
                        {trace.span_count}
                      </TableCell>
                      <TableCell>
                        {#if trace.error}
                          <Badge variant="destructive">Error</Badge>
                        {:else}
                          <Badge variant="secondary">OK</Badge>
                        {/if}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onclick={(e) => {
                            e.stopPropagation();
                            viewTrace(trace.trace_id);
                          }}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  {/each}
                </TableBody>
              </Table>
            </div>

            {#if traces.length > 0}
              <div class="flex items-center justify-between mt-6 px-2">
                <div class="text-sm text-muted-foreground">
                  Showing {(currentPage - 1) * pageSize + 1} to {Math.min(
                    currentPage * pageSize,
                    totalTraces,
                  )} of {totalTraces} traces
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
