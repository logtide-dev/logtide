<script lang="ts">
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { onMount, onDestroy } from "svelte";
    import { adminAPI } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import { goto } from "$app/navigation";
    import type {
        SystemStats,
        LogsStats,
        PerformanceStats,
        AlertsStats,
        RedisStats,
        HealthStats,
        PlatformTimeline,
        ActiveIssues,
        VersionCheckResult,
        IngestionHealthStats,
    } from "$lib/api/admin";
    import {
        Activity,
        Database,
        AlertTriangle,
        Users,
        Building2,
        FolderKanban,
        Zap,
        RefreshCw,
        ShieldAlert,
        HardDrive,
        Bell,
        Cpu,
        Server,
        Bug,
        ArrowUpCircle,
        CheckCircle2,
        ExternalLink,
    } from "@lucide/svelte";
    import * as Table from "$lib/components/ui/table";
    import { Button } from "$lib/components/ui/button";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";
    import PlatformTimelineChart from "$lib/components/admin/PlatformTimelineChart.svelte";

    let systemStats = $state<SystemStats | null>(null);
    let logsStats = $state<LogsStats | null>(null);
    let performanceStats = $state<PerformanceStats | null>(null);
    let alertsStats = $state<AlertsStats | null>(null);
    let redisStats = $state<RedisStats | null>(null);
    let healthStats = $state<HealthStats | null>(null);
    let platformTimeline = $state<PlatformTimeline | null>(null);
    let activeIssues = $state<ActiveIssues | null>(null);
    let versionCheck = $state<VersionCheckResult | null>(null);
    let ingestionHealth = $state<IngestionHealthStats | null>(null);
    let versionCheckFailed = $state(false);

    let loading = $state(true);
    let error = $state<string | null>(null);
    let refreshInterval: ReturnType<typeof setInterval>;
    let lastRefreshed = $state(new Date());

    let isClickHouse = $derived(healthStats?.storageEngine === 'clickhouse');
    let isMongoDB = $derived(healthStats?.storageEngine === 'mongodb');

    let engineLabel = $derived(
        isMongoDB ? 'MongoDB' : isClickHouse ? 'ClickHouse' : 'TimescaleDB'
    );
    let engineBadgeClass = $derived(
        isMongoDB ? 'bg-green-500/10 text-green-600 dark:text-green-400'
        : isClickHouse ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
        : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    );

    const usersAPI = new UsersAPI(() => get(authStore).token);

    $effect(() => {
        if (browser && $authStore.user) {
            if ($authStore.user.is_admin === undefined) {
                untrack(() => {
                    usersAPI
                        .getCurrentUser()
                        .then(({ user }) => {
                            const currentUser = get(authStore).user;
                            if (currentUser) {
                                authStore.updateUser({
                                    ...currentUser,
                                    ...user,
                                });
                                if (user.is_admin) {
                                    loadData();
                                }
                            }
                        })
                        .catch(() => {
                            goto("/dashboard");
                        });
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => {
                    goto("/dashboard");
                });
            }
        }
    });

    async function loadData() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = null;
        versionCheckFailed = false;
        try {
            const [system, logs, perf, alerts, redis, health, timeline, issues, version, ingHealth] =
                await Promise.all([
                    adminAPI.getSystemStats(),
                    adminAPI.getLogsStats(),
                    adminAPI.getPerformanceStats(),
                    adminAPI.getAlertsStats(),
                    adminAPI.getRedisStats(),
                    adminAPI.getHealthStats(),
                    adminAPI.getPlatformTimeline(24).catch(() => null),
                    adminAPI.getActiveIssues().catch(() => null),
                    adminAPI.getVersionCheck().catch(() => { versionCheckFailed = true; return null; }),
                    adminAPI.getIngestionHealth().catch(() => null),
                ]);

            systemStats = system;
            logsStats = logs;
            performanceStats = perf;
            alertsStats = alerts;
            redisStats = redis;
            healthStats = health;
            platformTimeline = timeline;
            activeIssues = issues;
            versionCheck = version;
            ingestionHealth = ingHealth;
            lastRefreshed = new Date();
        } catch (e: any) {
            console.error("Error loading admin stats:", e);
            error = e.message || "Failed to load dashboard data";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        if ($authStore.user?.is_admin) {
            loadData();
        }

        refreshInterval = setInterval(() => {
            if ($authStore.user?.is_admin) {
                loadData();
            }
        }, 30000);
    });

    onDestroy(() => {
        if (refreshInterval) clearInterval(refreshInterval);
    });

    function formatNumber(num: number) {
        if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
        if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
        return new Intl.NumberFormat(undefined).format(num);
    }

    function formatNumberFull(num: number) {
        return new Intl.NumberFormat(undefined).format(num);
    }

    let totalIssues = $derived(
        activeIssues
            ? activeIssues.openIncidents +
              activeIssues.criticalDetections24h +
              activeIssues.failedNotifications24h +
              activeIssues.openErrorGroups
            : 0,
    );

    let notificationSuccessRate = $derived.by(() => {
        if (!alertsStats) return null;
        const total =
            alertsStats.notifications.success + alertsStats.notifications.failed;
        if (total === 0) return 100;
        return Math.round(
            (alertsStats.notifications.success / total) * 100,
        );
    });

    function healthColor(status: string | undefined) {
        if (status === "healthy") return "text-green-500";
        if (status === "degraded") return "text-yellow-500";
        return "text-red-500";
    }
</script>

<svelte:head>
    <title>Admin Dashboard - LogTide</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
    <!-- Header -->
    <div class="flex justify-between items-center">
        <div>
            <div class="flex items-center gap-2.5">
                <h1 class="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
                {#if healthStats?.storageEngine}
                    <span class="text-xs font-medium px-2 py-0.5 rounded-full {engineBadgeClass}">
                        {engineLabel}
                    </span>
                {/if}
            </div>
            <p class="text-sm text-muted-foreground mt-0.5">
                Platform health, performance & usage overview
            </p>
        </div>
        <div class="flex items-center gap-3">
            <span class="text-xs text-muted-foreground">
                {lastRefreshed.toLocaleTimeString('en-US')}
            </span>
            <Button
                variant="outline"
                size="sm"
                onclick={loadData}
                disabled={loading}
            >
                <RefreshCw
                    class="mr-1.5 h-3.5 w-3.5 {loading ? 'animate-spin' : ''}"
                />
                Refresh
            </Button>
        </div>
    </div>

    {#if error}
        <div
            class="bg-destructive/15 text-destructive p-4 rounded-md flex items-center gap-2"
        >
            <AlertTriangle class="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
        </div>
    {/if}

    {#if $authStore.user?.is_admin}
        <!-- Version Check Banner -->
        {#if versionCheck && (versionCheck.latestStable !== null || versionCheck.latestBeta !== null)}
            {@const targetRelease = versionCheck.channel === 'beta'
                ? (versionCheck.latestBeta ?? versionCheck.latestStable)
                : versionCheck.latestStable}
            <Card class={versionCheck.updateAvailable ? 'border-blue-500/50 bg-blue-500/5' : ''}>
                <CardContent class="py-4">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            {#if versionCheck.updateAvailable && targetRelease}
                                <div class="rounded-full bg-blue-500/10 p-2">
                                    <ArrowUpCircle class="h-5 w-5 text-blue-500" />
                                </div>
                                <div>
                                    <div class="flex items-center gap-2">
                                        <span class="font-medium">Update available</span>
                                        <span class="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono">
                                            v{versionCheck.currentVersion}
                                        </span>
                                        <span class="text-muted-foreground">&rarr;</span>
                                        <span class="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 font-mono font-semibold">
                                            v{targetRelease.version}
                                        </span>
                                    </div>
                                    <p class="text-xs text-muted-foreground mt-0.5">
                                        {targetRelease.name}
                                        {#if targetRelease.prerelease}
                                            (pre-release)
                                        {/if}
                                        &middot; Channel: <span class="font-medium">{versionCheck.channel}</span>
                                    </p>
                                </div>
                            {:else}
                                <div class="rounded-full bg-green-500/10 p-2">
                                    <CheckCircle2 class="h-5 w-5 text-green-500" />
                                </div>
                                <div>
                                    <div class="flex items-center gap-2">
                                        <span class="font-medium">Up to date</span>
                                        <span class="text-xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-mono">
                                            v{versionCheck.currentVersion}
                                        </span>
                                    </div>
                                    <p class="text-xs text-muted-foreground mt-0.5">
                                        Channel: <span class="font-medium">{versionCheck.channel}</span>
                                        &middot; Checked {new Date(versionCheck.checkedAt).toLocaleTimeString('en-US')}
                                    </p>
                                </div>
                            {/if}
                        </div>
                        <div class="flex items-center gap-2">
                            {#if versionCheck.updateAvailable && targetRelease}
                                <a
                                    href={targetRelease.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    View release
                                    <ExternalLink class="h-3.5 w-3.5" />
                                </a>
                            {/if}
                        </div>
                    </div>
                </CardContent>
            </Card>
        {:else if versionCheck}
            <Card>
                <CardContent class="py-4">
                    <div class="flex items-center gap-3">
                        <div class="rounded-full bg-muted p-2">
                            <CheckCircle2 class="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                            <span class="font-medium text-muted-foreground">Version check unavailable (could not reach GitHub).</span>
                            <p class="text-xs text-muted-foreground mt-0.5">Current version: <span class="font-mono">v{versionCheck.currentVersion}</span></p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        {:else if versionCheckFailed}
            <Card>
                <CardContent class="py-4">
                    <div class="flex items-center gap-3">
                        <div class="rounded-full bg-muted p-2">
                            <CheckCircle2 class="h-5 w-5 text-muted-foreground" />
                        </div>
                        <span class="font-medium text-muted-foreground">Version check unavailable.</span>
                    </div>
                </CardContent>
            </Card>
        {/if}

        <!-- Section 1: Top Health Cards (4 columns) -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <!-- System Health -->
            <button
                class="text-left"
                onclick={() => goto("/dashboard/admin/system-health")}
            >
                <Card
                    class="transition-shadow hover:shadow-md cursor-pointer {healthStats?.overall === 'healthy'
                        ? 'border-green-500/50'
                        : healthStats?.overall === 'degraded'
                          ? 'border-yellow-500/50'
                          : 'border-red-500/50'}"
                >
                    <CardHeader
                        class="flex flex-row items-center justify-between space-y-0 pb-2"
                    >
                        <CardTitle class="text-sm font-medium"
                            >System Health</CardTitle
                        >
                        <Activity
                            class="h-4 w-4 {healthColor(healthStats?.overall)}"
                        />
                    </CardHeader>
                    <CardContent>
                        <div
                            class="text-2xl font-bold capitalize {healthColor(healthStats?.overall)}"
                        >
                            {healthStats?.overall || "..."}
                        </div>
                        <p class="text-xs text-muted-foreground mt-1">
                            DB {healthStats?.database.latency ?? "?"}ms
                            {#if healthStats?.redis.status !== "not_configured"}
                                &middot; Redis {healthStats?.redis.status ??
                                    "?"}
                            {/if}
                        </p>
                    </CardContent>
                </Card>
            </button>

            <!-- Ingestion Throughput -->
            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium"
                        >Ingestion</CardTitle
                    >
                    <Zap class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {performanceStats
                            ? performanceStats.ingestion.throughput.toFixed(1)
                            : "..."} <span class="text-sm font-normal text-muted-foreground">logs/s</span>
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        {#if performanceStats?.storage.logsSize && performanceStats.storage.logsSize !== 'N/A'}
                            Storage: {performanceStats.storage.logsSize}
                            {#if performanceStats.storage.compressionRatio}
                                &middot; <span class="text-green-500">{performanceStats.storage.compressionRatio.toFixed(1)}x</span> compression
                            {/if}
                        {:else if performanceStats}
                            {engineLabel} engine
                        {:else}
                            Storage: ...
                        {/if}
                    </p>
                </CardContent>
            </Card>

            <!-- Active Issues -->
            <Card
                class={totalIssues > 0
                    ? "border-orange-500/30"
                    : ""}
            >
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium"
                        >Active Issues</CardTitle
                    >
                    <ShieldAlert
                        class="h-4 w-4 {totalIssues > 0 ? 'text-orange-500' : 'text-muted-foreground'}"
                    />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {activeIssues ? totalIssues : "..."}
                    </div>
                    {#if activeIssues}
                        <div class="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-1">
                            {#if activeIssues.openIncidents > 0}
                                <span>{activeIssues.openIncidents} incidents</span>
                            {/if}
                            {#if activeIssues.criticalDetections24h > 0}
                                <span class="text-red-500">{activeIssues.criticalDetections24h} critical</span>
                            {/if}
                            {#if activeIssues.failedNotifications24h > 0}
                                <span class="text-orange-500">{activeIssues.failedNotifications24h} failed notif.</span>
                            {/if}
                            {#if activeIssues.openErrorGroups > 0}
                                <span>{activeIssues.openErrorGroups} errors</span>
                            {/if}
                            {#if totalIssues === 0}
                                <span class="text-green-500">All clear</span>
                            {/if}
                        </div>
                    {:else}
                        <p class="text-xs text-muted-foreground mt-1">Loading...</p>
                    {/if}
                </CardContent>
            </Card>

            <!-- Storage -->
            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium">Total Logs</CardTitle>
                    <Database class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {logsStats ? formatNumber(logsStats.total) : "..."}
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        +{logsStats
                            ? formatNumber(logsStats.growth.logsPerDay)
                            : "..."} last 24h
                    </p>
                </CardContent>
            </Card>
        </div>

        <!-- Ingestion Health Card -->
        {#if ingestionHealth}
            {@const c = ingestionHealth.counters24h}
            {@const hasIssues = c.piiRejected > 0 || c.detectionEnqueueFailed > 0 || c.exceptionEnqueueFailed > 0}
            <Card class={hasIssues ? 'border-destructive/50 bg-destructive/5' : ''}>
                <CardHeader>
                    <CardTitle>Ingestion health (24h)</CardTitle>
                </CardHeader>
                <CardContent class="grid grid-cols-2 gap-2 text-sm">
                    <div>PII rejections: <span class={c.piiRejected > 0 ? 'font-semibold text-destructive' : ''}>{c.piiRejected}</span></div>
                    <div>Detection enqueue failures: <span class={c.detectionEnqueueFailed > 0 ? 'font-semibold text-destructive' : ''}>{c.detectionEnqueueFailed}</span></div>
                    <div>Exception enqueue failures: <span class={c.exceptionEnqueueFailed > 0 ? 'font-semibold text-destructive' : ''}>{c.exceptionEnqueueFailed}</span></div>
                    <div>Identifier failures: {c.identifierFailed}</div>
                    <div class="col-span-2 flex flex-wrap gap-x-4 pt-1 text-xs text-muted-foreground border-t">
                        <span>GeoIP: <span class={ingestionHealth.enrichment.geoIp.ready ? 'text-green-500' : 'text-orange-500'}>{ingestionHealth.enrichment.geoIp.ready ? 'ready' : 'unavailable'}</span></span>
                        <span>IP reputation: <span class={ingestionHealth.enrichment.ipReputation.ready ? 'text-green-500' : 'text-orange-500'}>{ingestionHealth.enrichment.ipReputation.ready ? 'ready' : 'unavailable'}</span></span>
                    </div>
                </CardContent>
            </Card>
        {/if}

        <!-- Section 2: Platform Activity Timeline -->
        <Card>
            <CardHeader class="pb-2">
                <div class="flex items-center justify-between">
                    <CardTitle class="text-sm font-medium">Platform Activity (24h)</CardTitle>
                    <div class="flex items-center gap-4 text-xs text-muted-foreground">
                        <span class="flex items-center gap-1.5">
                            <span class="inline-block w-3 h-0.5 rounded bg-blue-500"></span>
                            Logs
                        </span>
                        <span class="flex items-center gap-1.5">
                            <span class="inline-block w-3 h-0.5 rounded bg-orange-500"></span>
                            Detections
                        </span>
                        <span class="flex items-center gap-1.5">
                            <span class="inline-block w-3 h-0.5 rounded bg-purple-500" style="border-bottom: 1px dashed;"></span>
                            Spans
                        </span>
                        <span class="flex items-center gap-1.5">
                            <span class="inline-block w-3 h-0.5 rounded bg-green-500"></span>
                            Metrics
                        </span>
                    </div>
                </div>
            </CardHeader>
            <CardContent class="pb-4">
                {#if platformTimeline && platformTimeline.timeline.length > 0}
                    <PlatformTimelineChart data={platformTimeline} />
                {:else if loading}
                    <div class="flex items-center justify-center h-[280px]">
                        <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                {:else}
                    <div class="flex flex-col items-center justify-center h-[280px] text-muted-foreground">
                        <Database class="h-8 w-8 mb-2" />
                        <p class="text-sm">No activity data yet</p>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- Section 3: Stats Grid (2 rows x 4 cols) -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <!-- Row 1: Usage -->
            <button class="text-left" onclick={() => goto("/dashboard/admin/users")}>
                <Card class="transition-shadow hover:shadow-md cursor-pointer h-full">
                    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle class="text-sm font-medium">Users</CardTitle>
                        <Users class="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div class="text-2xl font-bold">
                            {systemStats ? formatNumber(systemStats.users.total) : "..."}
                        </div>
                        <p class="text-xs text-muted-foreground mt-1">
                            {systemStats?.users.active || 0} active &middot; +{systemStats?.users.growth.today || 0} today
                        </p>
                    </CardContent>
                </Card>
            </button>

            <button class="text-left" onclick={() => goto("/dashboard/admin/organizations")}>
                <Card class="transition-shadow hover:shadow-md cursor-pointer h-full">
                    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle class="text-sm font-medium">Organizations</CardTitle>
                        <Building2 class="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div class="text-2xl font-bold">
                            {systemStats ? formatNumber(systemStats.organizations.total) : "..."}
                        </div>
                        <p class="text-xs text-muted-foreground mt-1">
                            +{systemStats?.organizations.growth.week || 0} this week
                        </p>
                    </CardContent>
                </Card>
            </button>

            <button class="text-left" onclick={() => goto("/dashboard/admin/projects")}>
                <Card class="transition-shadow hover:shadow-md cursor-pointer h-full">
                    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle class="text-sm font-medium">Projects</CardTitle>
                        <FolderKanban class="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div class="text-2xl font-bold">
                            {systemStats ? formatNumber(systemStats.projects.total) : "..."}
                        </div>
                        <p class="text-xs text-muted-foreground mt-1">
                            +{systemStats?.projects.growth.week || 0} this week
                        </p>
                    </CardContent>
                </Card>
            </button>

            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Ingestion Rate</CardTitle>
                    <HardDrive class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {logsStats ? formatNumber(logsStats.growth.logsPerHour) : "..."} <span class="text-sm font-normal text-muted-foreground">/hr</span>
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        ~{performanceStats ? performanceStats.ingestion.throughput.toFixed(1) : "..."} logs/sec
                    </p>
                </CardContent>
            </Card>

            <!-- Row 2: Operational -->
            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Alerts</CardTitle>
                    <Bell class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {alertsStats ? alertsStats.rules.active : "..."} <span class="text-sm font-normal text-muted-foreground">active rules</span>
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        {alertsStats?.triggered.last24h || 0} triggered (24h)
                        {#if notificationSuccessRate !== null}
                            &middot; <span class={notificationSuccessRate >= 95 ? 'text-green-500' : 'text-red-500'}>{notificationSuccessRate}%</span> delivery
                        {/if}
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Worker Queues</CardTitle>
                    <Cpu class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    {#if redisStats}
                        <div class="text-2xl font-bold">
                            {redisStats.queues.alertNotifications.waiting + redisStats.queues.sigmaDetection.waiting}
                            <span class="text-sm font-normal text-muted-foreground">waiting</span>
                        </div>
                        <p class="text-xs text-muted-foreground mt-1">
                            {redisStats.queues.alertNotifications.failed + redisStats.queues.sigmaDetection.failed} failed
                            &middot; {redisStats.memory.used} memory
                        </p>
                    {:else}
                        <div class="text-2xl font-bold">...</div>
                    {/if}
                </CardContent>
            </Card>

            <button class="text-left" onclick={() => goto("/dashboard/admin/system-health")}>
                <Card class="transition-shadow hover:shadow-md cursor-pointer h-full">
                    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle class="text-sm font-medium">
                            {engineLabel}
                        </CardTitle>
                        <Server class="h-4 w-4 {healthColor(isClickHouse ? healthStats?.clickhouse?.status : isMongoDB ? healthStats?.mongodb?.status : healthStats?.database.status)}" />
                    </CardHeader>
                    <CardContent>
                        {#if isClickHouse && healthStats?.clickhouse}
                            <div class="text-2xl font-bold {healthColor(healthStats.clickhouse.status)}">
                                {healthStats.clickhouse.latency >= 0 ? healthStats.clickhouse.latency : "?"}
                                <span class="text-sm font-normal text-muted-foreground">ms</span>
                            </div>
                            <p class="text-xs text-muted-foreground mt-1">
                                PG {healthStats.database.latency}ms
                                {#if healthStats.pool}
                                    &middot; {healthStats.pool.waitingRequests} waiting
                                {/if}
                            </p>
                        {:else if isMongoDB && healthStats?.mongodb}
                            <div class="text-2xl font-bold {healthColor(healthStats.mongodb.status)}">
                                {healthStats.mongodb.latency >= 0 ? healthStats.mongodb.latency : "?"}
                                <span class="text-sm font-normal text-muted-foreground">ms</span>
                            </div>
                            <p class="text-xs text-muted-foreground mt-1">
                                MongoDB {healthStats.mongodb.status}
                            </p>
                        {:else}
                            <div class="text-2xl font-bold {healthColor(healthStats?.database.status)}">
                                {healthStats?.database.latency ?? "..."}
                                <span class="text-sm font-normal text-muted-foreground">ms</span>
                            </div>
                            <p class="text-xs text-muted-foreground mt-1">
                                {healthStats?.database.connections || "?"} connections
                                {#if healthStats?.pool}
                                    &middot; {healthStats.pool.waitingRequests} waiting
                                {/if}
                            </p>
                        {/if}
                    </CardContent>
                </Card>
            </button>

            <Card class={healthStats?.redis.status === 'down' ? 'border-red-500/50' : ''}>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Redis</CardTitle>
                    <Bug class="h-4 w-4 {healthColor(healthStats?.redis.status === 'not_configured' ? 'healthy' : healthStats?.redis.status)}" />
                </CardHeader>
                <CardContent>
                    {#if healthStats?.redis.status === "not_configured"}
                        <div class="text-2xl font-bold text-muted-foreground">N/A</div>
                        <p class="text-xs text-muted-foreground mt-1">Not configured</p>
                    {:else}
                        <div class="text-2xl font-bold {healthColor(healthStats?.redis.status)}">
                            {healthStats?.redis.latency ?? "..."}
                            <span class="text-sm font-normal text-muted-foreground">ms</span>
                        </div>
                        <p class="text-xs text-muted-foreground mt-1">
                            {redisStats?.connections || "?"} connections
                        </p>
                    {/if}
                </CardContent>
            </Card>
        </div>

        <!-- Section 4: Top Orgs & Projects -->
        <div class="grid gap-4 md:grid-cols-2">
            <Card>
                <CardHeader class="pb-3">
                    <CardTitle class="text-sm font-medium">Top Organizations (by Logs)</CardTitle>
                </CardHeader>
                <CardContent>
                    {#if logsStats && logsStats.topOrganizations.length > 0}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>Organization</Table.Head>
                                    <Table.Head class="text-right">Logs (30d)</Table.Head>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each logsStats.topOrganizations as org}
                                    <Table.Row>
                                        <Table.Cell class="font-medium">{org.organizationName}</Table.Cell>
                                        <Table.Cell class="text-right">{formatNumberFull(org.count)}</Table.Cell>
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
                    {:else if !loading}
                        <p class="text-sm text-muted-foreground text-center py-6">No data</p>
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="pb-3">
                    <CardTitle class="text-sm font-medium">Top Projects (by Logs)</CardTitle>
                </CardHeader>
                <CardContent>
                    {#if logsStats && logsStats.topProjects.length > 0}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>Project</Table.Head>
                                    <Table.Head>Organization</Table.Head>
                                    <Table.Head class="text-right">Logs (30d)</Table.Head>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each logsStats.topProjects as proj}
                                    <Table.Row>
                                        <Table.Cell class="font-medium">{proj.projectName}</Table.Cell>
                                        <Table.Cell class="text-muted-foreground">{proj.organizationName}</Table.Cell>
                                        <Table.Cell class="text-right">{formatNumberFull(proj.count)}</Table.Cell>
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
                    {:else if !loading}
                        <p class="text-sm text-muted-foreground text-center py-6">No data</p>
                    {/if}
                </CardContent>
            </Card>
        </div>
    {:else}
        <div class="flex flex-col items-center justify-center p-12 text-center">
            <div class="bg-muted/50 p-6 rounded-full mb-4">
                <RefreshCw class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
            <h2 class="text-xl font-semibold">Verifying Access...</h2>
            <p class="text-muted-foreground mt-2">
                Updating your profile permissions.
            </p>
        </div>
    {/if}
</div>
