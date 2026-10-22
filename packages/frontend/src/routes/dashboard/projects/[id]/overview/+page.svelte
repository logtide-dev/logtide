<script module lang="ts">
  import { writeScopeToUrl } from '$lib/stores/scope-url';

  /**
   * Canonical drill-down link for the project overview: path plus search with
   * `project`, then `range=24h` (or `from`/`to` when a window is given) and any extras.
   */
  export function buildOverviewLink(
    path: string,
    projectId: string,
    extra: Record<string, string> = {},
    window?: { from: Date; to: Date }
  ): string {
    const withProject = writeScopeToUrl(new URL(path, 'http://local.invalid'), { projectIds: [projectId] });
    const url = writeScopeToUrl(withProject, {
      range: window
        ? { kind: 'custom', from: window.from.toISOString(), to: window.to.toISOString() }
        : { kind: 'preset', preset: '24h' },
    });
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return url.pathname + url.search;
  }

  /** Quote a query value when it contains whitespace or quotes. */
  function queryValue(value: string): string {
    return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  }
</script>

<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { currentOrganization } from '$lib/stores/organization';
  import { dashboardAPI } from '$lib/api/dashboard';
  import type { DashboardStats, TopService, RecentError, ActivityOverviewData } from '$lib/api/dashboard';
  import type { ActivityOverviewConfig } from '@logtide/shared';
  import StatsCard from '$lib/components/dashboard/StatsCard.svelte';
  import ActivityOverviewPanel from '$lib/components/custom-dashboards/panels/ActivityOverviewPanel.svelte';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import TopServicesWidget from '$lib/components/dashboard/TopServicesWidget.svelte';
  import RecentErrorsWidget from '$lib/components/dashboard/RecentErrorsWidget.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import IngestionSkewBanner from '$lib/components/projects/IngestionSkewBanner.svelte';
  import { projectsAPI } from '$lib/api/projects';
  import type { ProjectSkewHealthMap } from '$lib/api/projects';

  import Activity from '@lucide/svelte/icons/activity';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Server from '@lucide/svelte/icons/server';
  import TrendingUp from '@lucide/svelte/icons/trending-up';

  const projectId = $derived(page.params.id);

  let stats = $state<DashboardStats | null>(null);
  let activity = $state<ActivityOverviewData | null>(null);
  let topServices = $state<TopService[]>([]);
  let recentErrors = $state<RecentError[]>([]);
  let skew = $state<ProjectSkewHealthMap | null>(null);
  let loading = $state(true);
  let error = $state('');
  let lastLoadedKey = $state<string | null>(null);

  const activityConfig = $derived<ActivityOverviewConfig>({
    type: 'activity_overview',
    title: 'Activity overview',
    source: 'mixed',
    projectId: projectId ?? null,
    timeRange: '24h',
    series: ['logs', 'log_errors', 'spans', 'span_errors', 'detections', 'alerts'],
  });

  async function loadDashboard() {
    if (!$currentOrganization || !projectId) return;

    loading = true;
    error = '';

    try {
      const orgId = $currentOrganization.id;
      const [statsData, activityData, servicesData, errorsData, healthData] = await Promise.all([
        dashboardAPI.getStats(orgId, projectId),
        dashboardAPI.getActivityOverview(orgId, projectId),
        dashboardAPI.getTopServices(orgId, projectId),
        dashboardAPI.getRecentErrors(orgId, projectId),
        projectsAPI
          .getIngestionHealth(projectId)
          .catch(() => ({ skew: { logs: null, spans: null, metrics: null } })),
      ]);

      stats = statsData;
      activity = activityData;
      topServices = servicesData;
      recentErrors = errorsData;
      skew = healthData.skew;

      lastLoadedKey = `${orgId}-${projectId}`;
    } catch (e) {
      console.error('Failed to load project dashboard:', e);
      error = e instanceof Error ? e.message : 'Failed to load project dashboard';
      stats = null;
      activity = null;
      topServices = [];
      recentErrors = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!browser || !$currentOrganization || !projectId) {
      stats = null;
      activity = null;
      topServices = [];
      recentErrors = [];
      skew = null;
      lastLoadedKey = null;
      return;
    }

    const key = `${$currentOrganization.id}-${projectId}`;
    if (key === lastLoadedKey) return;

    loadDashboard();
  });

  function formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString('en-US');
  }

  function formatThroughput(throughput: number): string {
    if (throughput >= 1000) return (throughput / 1000).toFixed(1) + 'K/s';
    return throughput.toFixed(1) + '/s';
  }

  const hasActivity = $derived(
    (activity?.series ?? []).some(
      (p) =>
        p.logs > 0 ||
        p.log_errors > 0 ||
        p.spans > 0 ||
        p.span_errors > 0 ||
        p.detections > 0 ||
        p.alerts > 0
    )
  );

  let isEmpty = $derived(
    stats !== null &&
    stats.totalLogsToday.value === 0 &&
    stats.activeServices.value === 0 &&
    !hasActivity
  );

  const logsLink = (extra: Record<string, string> = {}) =>
    buildOverviewLink('/dashboard/logs', projectId ?? '', extra);

  function handleTotalLogsClick() {
    goto(logsLink());
  }

  function handleErrorRateClick() {
    goto(logsLink({ q: 'level:(error OR critical)' }));
  }

  function handleActiveServicesClick() {
    goto(logsLink());
  }

  function handleThroughputClick() {
    goto(logsLink());
  }

  function handleServiceClick(service: TopService) {
    goto(logsLink({ q: `service:${queryValue(service.name)}` }));
  }

  // Recent errors open the Errors list for this project, not the log search.
  function handleErrorClick(err: RecentError) {
    const search = err.message.trim().slice(0, 80);
    goto(buildOverviewLink('/dashboard/errors', projectId ?? '', search ? { search } : {}));
  }
</script>

{#snippet retryAction()}
  <button
    type="button"
    class={buttonVariants({ variant: 'outline', size: 'sm' })}
    onclick={() => { lastLoadedKey = null; loadDashboard(); }}
  >
    Retry
  </button>
{/snippet}

{#snippet connectAction()}
  <a
    href="/dashboard/projects/{projectId}/settings#connect"
    class={buttonVariants({ variant: 'default', size: 'sm' })}
  >
    Connect
  </a>
{/snippet}

<svelte:head>
  <title>Overview - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <h2 class="sr-only">Overview</h2>
  {#if !loading && !error}
    <IngestionSkewBanner skew={skew?.logs ?? null} signal="logs" />
    <IngestionSkewBanner skew={skew?.spans ?? null} signal="spans" />
    <IngestionSkewBanner skew={skew?.metrics ?? null} signal="metrics" />
  {/if}

  {#if loading}
    <div data-testid="overview-skeleton" aria-busy="true" class="space-y-4">
      <span class="sr-only" role="status">Loading</span>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {#each [0, 1, 2, 3] as i (i)}
          <Skeleton height="6rem" rounded="lg" />
        {/each}
      </div>
      <Skeleton height="18rem" rounded="lg" />
    </div>
  {:else if error}
    <EmptyState variant="error" title="Could not load project overview" description={error} actions={retryAction} />
  {:else if isEmpty}
    <EmptyState
      variant="setup"
      title="No data yet"
      description="Start sending logs to this project to see your overview."
      actions={connectAction}
    />
  {:else if stats}
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Total logs today"
        value={formatNumber(stats.totalLogsToday.value)}
        description="Logs ingested today"
        trend={{
          value: stats.totalLogsToday.trend,
          isPositive: stats.totalLogsToday.trend >= 0,
          label: 'from yesterday'
        }}
        icon={Activity}
        onclick={handleTotalLogsClick}
      />
      <StatsCard
        title="Error rate"
        value={stats.errorRate.value.toFixed(1) + '%'}
        description="Error rate today"
        trend={{
          value: Math.abs(stats.errorRate.trend),
          isPositive: stats.errorRate.trend <= 0,
          unit: ' pp',
          label: 'from yesterday'
        }}
        icon={AlertTriangle}
        onclick={handleErrorRateClick}
      />
      <StatsCard
        title="Active services"
        value={stats.activeServices.value.toString()}
        description="Services reporting"
        trend={{
          value: Math.abs(stats.activeServices.trend),
          isPositive: stats.activeServices.trend >= 0,
          unit: '',
          label: 'vs yesterday'
        }}
        icon={Server}
        onclick={handleActiveServicesClick}
      />
      <StatsCard
        title="Throughput"
        value={formatThroughput(stats.avgThroughput.value)}
        description="Logs/sec, last hour"
        trend={{
          value: stats.avgThroughput.trend,
          isPositive: stats.avgThroughput.trend >= 0,
          label: 'from last hour'
        }}
        icon={TrendingUp}
        onclick={handleThroughputClick}
      />
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Activity overview (last 24 hours)</CardTitle>
      </CardHeader>
      <CardContent>
        {#if hasActivity}
          <div class="h-72">
            <ActivityOverviewPanel config={activityConfig} data={activity} loading={false} error={null} />
          </div>
        {:else}
          <div class="text-center py-12 text-muted-foreground">
            No activity in the last 24 hours
          </div>
        {/if}
      </CardContent>
    </Card>

    <div class="grid gap-4 md:grid-cols-2">
      <TopServicesWidget services={topServices} onServiceClick={handleServiceClick} />
      <RecentErrorsWidget errors={recentErrors} onErrorClick={handleErrorClick} />
    </div>
  {/if}
</div>
