<script lang="ts">
  import { untrack } from 'svelte';
  import type { HardwareHostSummary } from '@logtide/shared';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore } from '$lib/stores/scope';
  import { layoutStore } from '$lib/stores/layout';
  import { startVisiblePolling } from '$lib/utils/visible-polling';
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

  // Hardware Health of every host, across the projects in scope (all of them
  // when none is selected). A host opens the Hardware tab of its host page.

  const REFRESH_MS = 60_000;

  const org = $derived($currentOrganization);
  const projectsAPI = new ProjectsAPI(getAuthToken);

  let projects = $state<{ id: string; name: string }[]>([]);
  let projectsLoaded = $state(false);

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
        projects = res.projects.map((p) => ({ id: p.id, name: p.name }));
        projectsLoaded = true;
      })
      .catch(() => {
        if (cancelled) return;
        projects = [];
        projectsLoaded = true;
      });
    return () => {
      cancelled = true;
    };
  });

  // The selected projects of this organization; none selected means all of them.
  const projectIds = $derived.by(() => {
    if (!projectsLoaded) return [];
    const known = new Set(projects.map((p) => p.id));
    const selected = $scopeStore.projectIds.filter((id) => known.has(id));
    return selected.length > 0 ? selected : projects.map((p) => p.id);
  });
  const projectsKey = $derived(projectIds.join(','));
  const projectNames = $derived(new Map(projects.map((p) => [p.id, p.name])));

  let hosts = $state<HardwareHostSummary[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  /** Projects whose list could not be read while others could. */
  let failedProjects = $state<string[]>([]);
  let statusFilter = $state<HardwareStatusFilter>('all');

  // Newest request wins: a slow answer for an older scope never overwrites a newer one.
  let seq = 0;

  async function load(ids: string[], silent: boolean) {
    const mine = ++seq;
    if (!silent) loading = true;
    try {
      const results = await Promise.allSettled(ids.map((id) => listHardwareHosts(id)));
      if (mine !== seq) return;
      const ok = results.filter((r): r is PromiseFulfilledResult<{ hosts: HardwareHostSummary[] }> => r.status === 'fulfilled');
      const failed = ids.filter((_, i) => results[i].status === 'rejected');
      if (ok.length === 0 && failed.length > 0) {
        const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        throw first.reason;
      }
      hosts = ok.flatMap((r) => r.value.hosts ?? []);
      failedProjects = failed;
      error = null;
      loaded = true;
    } catch (err) {
      if (mine !== seq) return;
      error = err instanceof Error ? err.message : 'Could not load hosts';
      // A failed background refresh keeps the last good data on screen.
      if (!silent) {
        hosts = [];
        failedProjects = [];
      }
    } finally {
      if (mine === seq) loading = false;
    }
  }

  $effect(() => {
    const key = projectsKey;
    if (!key) {
      hosts = [];
      loaded = false;
      error = null;
      return;
    }
    const ids = key.split(',');
    untrack(() => {
      loaded = false;
      hosts = [];
      statusFilter = 'all';
      void load(ids, false);
    });
    const stop = startVisiblePolling(() => void load(ids, true), REFRESH_MS);
    return () => {
      stop();
      seq++;
    };
  });

  function reload() {
    if (projectIds.length > 0) void load(projectIds, false);
  }

  const sorted = $derived(sortHosts(hosts));
  const visible = $derived(filterHosts(sorted, statusFilter));
  const showSetup = $derived(loaded && !error && hosts.length === 0 && failedProjects.length === 0);
  // The project column only helps when hosts of several projects are on screen.
  const showProjectColumn = $derived(new Set(hosts.map((h) => h.projectId)).size > 1);
  const failedNames = $derived(failedProjects.map((id) => projectNames.get(id) ?? id).join(', '));
</script>

<svelte:head>
  <title>Hardware - LogTide</title>
</svelte:head>

<div class="container mx-auto flex flex-col gap-2 {containerPadding} {maxWidthClass}">
  <PageHeader
    title="Hardware"
    description="Disk, memory, temperature, cooling, power and network health of your hosts"
    appliesTo="organization"
  >
    {#snippet actions()}
      <ScopeBar mode="multi" {projects} showTime={false} />
      <Button variant="outline" size="sm" onclick={reload} aria-label="Refresh">
        <RefreshCw class="h-4 w-4" />
      </Button>
    {/snippet}
  </PageHeader>

  {#if !projectsLoaded}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading hosts</div>
  {:else if projects.length === 0}
    <EmptyState variant="setup" title="Create a project first" description="Hosts report their hardware health to a project.">
      {#snippet actions()}
        <Button size="sm" href="/dashboard/projects">Go to projects</Button>
      {/snippet}
    </EmptyState>
  {:else if error && !loaded && hosts.length === 0}
    <EmptyState variant="error" title="Could not load hosts" description={error}>
      {#snippet actions()}
        <Button variant="outline" size="sm" onclick={reload}>Try again</Button>
      {/snippet}
    </EmptyState>
  {:else if showSetup}
    <HardwareSetup projectId={projectIds.length === 1 ? projectIds[0] : undefined} />
  {:else if !loaded}
    <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading hosts</div>
  {:else}
    <div class="space-y-4">
      <HardwareSummaryCards hosts={sorted} bind:status={statusFilter} />
      {#if error}
        <p class="text-sm text-destructive-text" role="alert">Could not refresh the list: {error}</p>
      {/if}
      {#if failedProjects.length > 0}
        <p class="text-sm text-warning-text" role="alert">Could not load the hosts of {failedNames}.</p>
      {/if}
      {#if visible.length === 0}
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
        <HardwareHostTable hosts={visible} {loading} projectNames={showProjectColumn ? projectNames : null} />
      {/if}
      <p class="text-xs text-muted-foreground">
        Refreshes every minute. Open a host to see its components, findings and trends next to its CPU, memory and disks.
        <a class="text-primary-text hover:underline" href={HARDWARE_DOCS_URL} target="_blank" rel="noopener noreferrer">
          How Hardware Health works
        </a>
      </p>
    </div>
  {/if}
</div>
