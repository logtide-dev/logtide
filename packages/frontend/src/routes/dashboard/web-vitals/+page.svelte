<script lang="ts">
  import { untrack } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { layoutStore } from '$lib/stores/layout';
  import { currentOrganization } from '$lib/stores/organization';
  import { scopeStore, resolveRange } from '$lib/stores/scope';
  import { ProjectsAPI } from '$lib/api/projects';
  import { webVitalsAPI, type WebVitalsSummary } from '$lib/api/web-vitals';

  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import ScopeBar from '$lib/components/app/ScopeBar.svelte';
  import VitalCard from '$lib/components/web-vitals/VitalCard.svelte';
  import RouteTable from '$lib/components/web-vitals/RouteTable.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { MAX_VITAL_SAMPLES } from '$lib/components/web-vitals/format';

  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-8 py-8');
  $effect(() => layoutStore.maxWidthClass.subscribe((v) => (maxWidthClass = v)));
  $effect(() => layoutStore.containerPadding.subscribe((v) => (containerPadding = v)));

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

  let summary = $state<WebVitalsSummary | null>(null);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
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
      const result = await webVitalsAPI.getSummary({
        projectId: id,
        from: bounds.from.toISOString(),
        to: bounds.to.toISOString(),
      });
      if (token !== request) return;
      summary = result;
    } catch (e) {
      if (token !== request) return;
      summary = null;
      loadError = e instanceof Error ? e.message : 'Could not load web vitals';
    } finally {
      if (token === request) loading = false;
    }
  }

  // Reload on a project change, a range change or Refresh. Preset ranges resolve
  // against "now", so bounds are recomputed only for a real change.
  let lastKey = '';
  $effect(() => {
    const scope = $scopeStore;
    const key = JSON.stringify([scope.projectIds[0] ?? null, scope.range, refreshTick]);
    if (key === lastKey) return;
    lastKey = key;
    if (!scope.projectIds[0]) {
      untrack(() => {
        summary = null;
      });
      return;
    }
    bounds = resolveRange(scope.range);
    untrack(() => void load());
  });
</script>

<svelte:head>
  <title>Web vitals - LogTide</title>
</svelte:head>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <PageHeader title="Web vitals" description="Core Web Vitals reported by the browser SDK">
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
      description="Create a project and connect the browser SDK to collect web vitals."
    />
  {:else}
    <div class="mb-4">
      <ScopeBar mode="single" {projects} />
    </div>

    {#if !projectId}
      <EmptyState
        variant="no-data"
        title="No project selected"
        description="Select a project to see its web vitals."
      />
    {:else if loadError}
      <EmptyState variant="error" title="Could not load web vitals" description={loadError}>
        {#snippet actions()}
          <Button type="button" variant="outline" size="sm" onclick={() => void load()}>Retry</Button>
        {/snippet}
      </EmptyState>
    {:else if loading && !summary}
      <div class="py-16 text-center text-sm text-muted-foreground" role="status">Loading web vitals</div>
    {:else if summary && summary.sampleCount === 0}
      <EmptyState
        variant="setup"
        title="No web vitals yet"
        description="Web vitals appear when your app reports them. Install @logtide/browser and enable webVitals: true in its options, then reload this page."
      />
    {:else if summary}
      <p class="mb-4 text-sm text-muted-foreground" data-testid="sample-line">
        Based on {summary.sampleCount.toLocaleString('en-US')} samples{#if summary.truncated}
          (most recent {MAX_VITAL_SAMPLES.toLocaleString('en-US')}){/if}{#if summary.skipped > 0}
          . {summary.skipped.toLocaleString('en-US')} invalid records ignored{/if}
      </p>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" class:opacity-60={loading}>
        {#each summary.metrics as metric (metric.name)}
          <VitalCard {metric} />
        {/each}
      </div>

      <section class="mt-8 space-y-3">
        <h2 class="text-lg font-semibold">Routes</h2>
        {#if summary.routes.length === 0}
          <p class="text-sm text-muted-foreground">No route data in this time range.</p>
        {:else}
          <div class="rounded-md border">
            <RouteTable rows={summary.routes} />
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>
