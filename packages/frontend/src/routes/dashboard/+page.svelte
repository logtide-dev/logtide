<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { currentOrganization } from '$lib/stores/organization';
  import { dashboardAPI } from '$lib/api/dashboard';
  import type { DashboardStats, TimeseriesDataPoint, TopService, RecentError } from '$lib/api/dashboard';
  import StatsCard from '$lib/components/dashboard/StatsCard.svelte';
  import LogsChart from '$lib/components/dashboard/LogsChart.svelte';
  import TopServicesWidget from '$lib/components/dashboard/TopServicesWidget.svelte';
  import RecentErrorsWidget from '$lib/components/dashboard/RecentErrorsWidget.svelte';
  import EmptyDashboard from '$lib/components/dashboard/EmptyDashboard.svelte';
  import Spinner from '$lib/components/Spinner.svelte';

  import Activity from '@lucide/svelte/icons/activity';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Server from '@lucide/svelte/icons/server';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
  import Building2 from '@lucide/svelte/icons/building-2';

  let stats = $state<DashboardStats | null>(null);
  let chartData = $state<TimeseriesDataPoint[]>([]);
  let topServices = $state<TopService[]>([]);
  let recentErrors = $state<RecentError[]>([]);
  let loading = $state(true);
  let error = $state('');
  let lastLoadedOrg = $state<string | null>(null);

  async function loadDashboard() {
    if (!$currentOrganization) {
      stats = null;
      chartData = [];
      topServices = [];
      recentErrors = [];
      return;
    }

    loading = true;
    error = '';

    try {
      const [statsData, timeseriesData, servicesData, errorsData] = await Promise.all([
        dashboardAPI.getStats($currentOrganization.id),
        dashboardAPI.getTimeseries($currentOrganization.id),
        dashboardAPI.getTopServices($currentOrganization.id),
        dashboardAPI.getRecentErrors($currentOrganization.id),
      ]);

      stats = statsData;
      chartData = timeseriesData;
      topServices = servicesData;
      recentErrors = errorsData;
      lastLoadedOrg = $currentOrganization.id;
    } catch (e) {
      console.error('Failed to load dashboard data:', e);
      error = e instanceof Error ? e.message : 'Failed to load dashboard data';
      stats = null;
      chartData = [];
      topServices = [];
      recentErrors = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (!browser || !$currentOrganization) {
      stats = null;
      chartData = [];
      topServices = [];
      recentErrors = [];
      lastLoadedOrg = null;
      return;
    }

    if ($currentOrganization.id === lastLoadedOrg) return;

    loadDashboard();
  });

  function formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  function formatThroughput(throughput: number): string {
    if (throughput >= 1000) {
      return (throughput / 1000).toFixed(1) + 'K/s';
    }
    return throughput.toFixed(1) + '/s';
  }

  // Check if dashboard has no data (new user or no logs)
  let isEmpty = $derived(
    stats !== null &&
    stats.totalLogsToday.value === 0 &&
    stats.activeServices.value === 0 &&
    chartData.length === 0
  );

  // Navigation handlers for clickable dashboard elements
  function getLast24HoursParams(): string {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return `from=${from.toISOString()}&to=${now.toISOString()}`;
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

  function handleChartClick(params: { seriesName: string; time: string; value: number }) {
    // Map series name to log level
    const levelMap: Record<string, string> = {
      'Errors': 'error',
      'Warnings': 'warn',
      'Info': 'info'
    };
    const level = levelMap[params.seriesName];

    // Create a 1-hour time window around the clicked point
    const clickedTime = new Date(params.time);
    const from = new Date(clickedTime.getTime() - 30 * 60 * 1000);
    const to = new Date(clickedTime.getTime() + 30 * 60 * 1000);

    const timeParams = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const levelParam = level ? `&level=${level}` : '';

    goto(`/dashboard/search?${timeParams}${levelParam}`);
  }

  function handleServiceClick(service: TopService) {
    goto(`/dashboard/search?service=${encodeURIComponent(service.name)}&${getLast24HoursParams()}`);
  }

  function handleErrorClick(error: RecentError) {
    // Create a 1-hour time window around the error
    const errorTime = new Date(error.time);
    const from = new Date(errorTime.getTime() - 30 * 60 * 1000);
    const to = new Date(errorTime.getTime() + 30 * 60 * 1000);

    const params = new URLSearchParams();
    params.set('service', error.service);
    params.set('level', error.level);
    params.set('from', from.toISOString());
    params.set('to', to.toISOString());
    if (error.projectId) {
      params.set('project', error.projectId);
    }
    if (error.traceId) {
      params.set('traceId', error.traceId);
    }

    goto(`/dashboard/search?${params.toString()}`);
  }
</script>

<div class="container mx-auto space-y-6 p-6">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
        <div class="flex items-center gap-2 mt-2">
          <Building2 class="w-4 h-4 text-muted-foreground" />
          <p class="text-muted-foreground">
            {$currentOrganization?.name || 'Organization'} • Overview of your log management platform
          </p>
        </div>
      </div>

      {#if loading}
        <div class="flex items-center justify-center py-24">
          <Spinner />
          <span class="ml-3 text-muted-foreground">Loading dashboard...</span>
        </div>
      {:else if error}
        <div class="text-center py-24">
          <p class="text-destructive mb-4">{error}</p>
          <button
            class="text-primary hover:underline"
            onclick={() => loadDashboard()}
          >
            Retry
          </button>
        </div>
      {:else if isEmpty}
        <EmptyDashboard />
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

        {#if chartData.length > 0}
          <LogsChart data={chartData} onDataPointClick={handleChartClick} />
        {:else}
          <div class="text-center py-12 text-muted-foreground">
            No log data available for the last 24 hours
          </div>
        {/if}

        <div class="grid gap-4 md:grid-cols-2">
          <TopServicesWidget services={topServices} onServiceClick={handleServiceClick} />
          <RecentErrorsWidget errors={recentErrors} onErrorClick={handleErrorClick} />
        </div>
      {/if}
</div>
