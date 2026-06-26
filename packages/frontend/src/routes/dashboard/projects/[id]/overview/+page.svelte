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
  import Spinner from '$lib/components/Spinner.svelte';

  import Activity from '@lucide/svelte/icons/activity';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Server from '@lucide/svelte/icons/server';
  import TrendingUp from '@lucide/svelte/icons/trending-up';

  const projectId = $derived(page.params.id);

  let stats = $state<DashboardStats | null>(null);
  let activity = $state<ActivityOverviewData | null>(null);
  let topServices = $state<TopService[]>([]);
  let recentErrors = $state<RecentError[]>([]);
  let loading = $state(true);
  let error = $state('');
  let lastLoadedKey = $state<string | null>(null);

  const activityConfig = $derived<ActivityOverviewConfig>({
    type: 'activity_overview',
    title: 'Activity Overview',
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
      const [statsData, activityData, servicesData, errorsData] = await Promise.all([
        dashboardAPI.getStats(orgId, projectId),
        dashboardAPI.getActivityOverview(orgId, projectId),
        dashboardAPI.getTopServices(orgId, projectId),
        dashboardAPI.getRecentErrors(orgId, projectId),
      ]);

      stats = statsData;
      activity = activityData;
      topServices = servicesData;
      recentErrors = errorsData;

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
    return num.toString();
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

  function getLast24HoursParams(): string {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return `from=${from.toISOString()}&to=${now.toISOString()}&project=${projectId}`;
  }

  function handleTotalLogsClick() {
    goto(`/dashboard/search?${getLast24HoursParams()}`);
  }

  function handleErrorRateClick() {
    goto(`/dashboard/search?level=error,critical&${getLast24HoursParams()}`);
  }

  function handleActiveServicesClick() {
    goto(`/dashboard/search?${getLast24HoursParams()}`);
  }

  function handleThroughputClick() {
    goto(`/dashboard/search?${getLast24HoursParams()}`);
  }

  function handleServiceClick(service: TopService) {
    goto(`/dashboard/search?service=${encodeURIComponent(service.name)}&${getLast24HoursParams()}`);
  }

  function handleErrorClick(err: RecentError) {
    const errorTime = new Date(err.time);
    const from = new Date(errorTime.getTime() - 30 * 60 * 1000);
    const to = new Date(errorTime.getTime() + 30 * 60 * 1000);
    const params = new URLSearchParams();
    params.set('service', err.service);
    params.set('level', err.level);
    params.set('from', from.toISOString());
    params.set('to', to.toISOString());
    params.set('project', projectId);
    if (err.traceId) params.set('traceId', err.traceId);
    goto(`/dashboard/search?${params.toString()}`);
  }
</script>

<svelte:head>
  <title>Project Overview - LogTide</title>
</svelte:head>

<div class="space-y-6">
  {#if loading}
    <div class="flex items-center justify-center py-24">
      <Spinner />
      <span class="ml-3 text-muted-foreground">Loading project dashboard...</span>
    </div>
  {:else if error}
    <div class="text-center py-24">
      <p class="text-destructive mb-4">{error}</p>
      <button
        class="text-primary hover:underline"
        onclick={() => { lastLoadedKey = null; loadDashboard(); }}
      >
        Retry
      </button>
    </div>
  {:else if isEmpty}
    <div class="text-center py-24">
      <p class="text-lg text-muted-foreground mb-2">No data yet</p>
      <p class="text-sm text-muted-foreground">
        Start sending logs to this project to see your dashboard.
      </p>
    </div>
  {:else if stats}
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Total Logs Today"
        value={formatNumber(stats.totalLogsToday.value)}
        description="Logs ingested today"
        trend={{
          value: stats.totalLogsToday.trend,
          isPositive: stats.totalLogsToday.trend >= 0
        }}
        icon={Activity}
        onclick={handleTotalLogsClick}
      />
      <StatsCard
        title="Error Rate"
        value={stats.errorRate.value.toFixed(1) + '%'}
        description="Error rate last 24h"
        trend={{
          value: Math.abs(stats.errorRate.trend),
          isPositive: stats.errorRate.trend <= 0
        }}
        icon={AlertTriangle}
        onclick={handleErrorRateClick}
      />
      <StatsCard
        title="Active Services"
        value={stats.activeServices.value.toString()}
        description="Services reporting"
        trend={{
          value: Math.abs(stats.activeServices.trend),
          isPositive: stats.activeServices.trend >= 0
        }}
        icon={Server}
        onclick={handleActiveServicesClick}
      />
      <StatsCard
        title="Throughput"
        value={formatThroughput(stats.avgThroughput.value)}
        description="Current throughput"
        trend={{
          value: stats.avgThroughput.trend,
          isPositive: stats.avgThroughput.trend >= 0
        }}
        icon={TrendingUp}
        onclick={handleThroughputClick}
      />
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Activity Overview (Last 24 Hours)</CardTitle>
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
