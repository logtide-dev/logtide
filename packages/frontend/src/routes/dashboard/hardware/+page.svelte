<script lang="ts">
  import { untrack } from 'svelte';
  import type { HardwareHostSummary, Project } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { toastStore } from '$lib/stores/toast';
  import { ProjectsAPI } from '$lib/api/projects';
  import { listHardwareHosts } from '$lib/api/hardware';
  import { getAuthToken } from '$lib/utils/auth';
  import Button from '$lib/components/ui/button/button.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import HardwareHostTable from '$lib/components/hardware/HardwareHostTable.svelte';
  import HardwareSetup from '$lib/components/hardware/HardwareSetup.svelte';
  import HardwareSummaryCards from '$lib/components/hardware/HardwareSummaryCards.svelte';
  import {
    filterHosts,
    HARDWARE_DOCS_URL,
    sortHosts,
    type HardwareStatusFilter,
  } from '$lib/components/hardware/hardware-meta';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  const REFRESH_MS = 60_000;

  const org = $derived($currentOrganization);

  let projects = $state<Project[]>([]);
  let projectsLoaded = $state(false);
  const projectsAPI = new ProjectsAPI(getAuthToken);

  // The project comes from the shared scope. Until the projects of this
  // organization are loaded a stale id from another organization is ignored.
  const projectId = $derived.by(() => {
    const id = $scopeStore.projectIds[0];
    return projectsLoaded && id && projects.some((p) => p.id === id) ? id : undefined;
  });

  let hosts = $state<HardwareHostSummary[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let statusFilter = $state<HardwareStatusFilter>('all');

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');
  $effect(() => {
    const a = layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v));
    const b = layoutStore.containerPadding.subscribe((v) => (containerPadding = v));
    return () => {
      a();
      b();
    };
  });

  $effect(() => {
    const orgId = org?.id;
    if (!orgId) return;
    let cancelled = false;
    projectsLoaded = false;
    projectsAPI
      .getProjects(orgId)
      .then((res) => {
        if (cancelled) return;
        projects = res.projects;
        projectsLoaded = true;
      })
      .catch((err) => {
        if (cancelled) return;
        projectsLoaded = true;
        toastStore.error(err instanceof Error ? err.message : 'Could not load projects');
      });
    return () => {
      cancelled = true;
    };
  });

  // Newest request wins: a slow answer for another project never overwrites a newer one.
  let seq = 0;

  async function load(pid: string, silent: boolean) {
    const mine = ++seq;
    if (!silent) loading = true;
    try {
      const res = await listHardwareHosts(pid);
      if (mine !== seq) return;
      hosts = res.hosts ?? [];
      error = null;
      loaded = true;
    } catch (err) {
      if (mine !== seq) return;
      error = err instanceof Error ? err.message : 'Could not load hosts';
      // A failed background refresh keeps the last good data on screen.
      if (!silent) hosts = [];
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    const pid = projectId;
    if (!pid) {
      hosts = [];
      loaded = false;
      error = null;
      return;
    }
    untrack(() => {
      loaded = false;
      hosts = [];
      statusFilter = 'all';
      void load(pid, false);
    });
    const timer = setInterval(() => void load(pid, true), REFRESH_MS);
    return () => clearInterval(timer);
  });

  function reload() {
    if (projectId) void load(projectId, false);
  }

  const sorted = $derived(sortHosts(hosts));
  const visible = $derived(filterHosts(sorted, statusFilter));
  const showSetup = $derived(loaded && !error && hosts.length === 0);
</script>

<svelte:head>
  <title>Hardware - LogTide</title>
</svelte:head>

<div class="container mx-auto flex flex-col gap-2 {containerPadding} {maxWidthClass}">
  <PageHeader
    title="Hardware"
    description="Disk, memory, temperature, cooling, power and network health of your hosts"
    appliesTo="project"
  >
    {#snippet actions()}
      <ScopeBar mode="single" {projects} showTime={false} />
      <Button variant="outline" size="sm" onclick={reload} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  {#if !projectId}
    <EmptyState
      variant="setup"
      title={projectsLoaded && projects.length === 0 ? 'Create a project first' : 'Select a project'}
      description={projectsLoaded && projects.length === 0
        ? 'Hosts report their hardware health to a project.'
        : 'Choose a project in the scope bar to see the health of its hosts.'}
    >
      {#snippet actions()}
        {#if projectsLoaded && projects.length === 0}
          <Button size="sm" href="/dashboard/projects">Go to projects</Button>
        {/if}
      {/snippet}
    </EmptyState>
  {:else if error && !loaded && hosts.length === 0}
    <EmptyState variant="error" title="Could not load hosts" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={reload}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if showSetup}
    <HardwareSetup {projectId} />
  {:else}
    <div class="space-y-4">
      <HardwareSummaryCards hosts={sorted} bind:status={statusFilter} />

      {#if error}
        <p class="text-sm text-destructive-text" role="alert">
          Could not refresh the list: {error}
        </p>
      {/if}

      {#if loaded && visible.length === 0}
        <EmptyState
          variant="no-results"
          title="No hosts with this status"
          description="Pick another tile to see the rest of your hosts."
        >
          {#snippet actions()}
            <Button variant="outline" size="sm" onclick={() => (statusFilter = 'all')}>Show all hosts</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <HardwareHostTable hosts={visible} {loading} />
      {/if}

      <p class="text-xs text-muted-foreground">
        Refreshes every minute.
        <a class="text-primary-text hover:underline" href={HARDWARE_DOCS_URL} target="_blank" rel="noopener noreferrer">
          How Hardware Health works
        </a>
      </p>
    </div>
  {/if}
</div>
