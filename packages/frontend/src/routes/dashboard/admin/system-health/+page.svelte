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
        DatabaseStats,
        PerformanceStats,
        RedisStats,
        HealthStats,
        CompressionStatsItem,
        AggregateStatsItem,
        SlowQueriesStats,
    } from "$lib/api/admin";
    import {
        AlertTriangle,
        RefreshCw,
        Database,
        Server,
        Activity,
        Clock,
        Zap,
    } from "@lucide/svelte";
    import * as Table from "$lib/components/ui/table";
    import { Button } from "$lib/components/ui/button";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";

    let databaseStats = $state<DatabaseStats | null>(null);
    let performanceStats = $state<PerformanceStats | null>(null);
    let redisStats = $state<RedisStats | null>(null);
    let healthStats = $state<HealthStats | null>(null);
    let compressionStats = $state<CompressionStatsItem[]>([]);
    let aggregateStats = $state<AggregateStatsItem[]>([]);
    let slowQueries = $state<SlowQueriesStats | null>(null);

    let loading = $state(true);
    let error = $state<string | null>(null);
    let refreshInterval: ReturnType<typeof setInterval>;
    let lastRefreshed = $state(new Date());

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
                                authStore.updateUser({ ...currentUser, ...user });
                                if (user.is_admin) loadData();
                            }
                        })
                        .catch(() => goto("/dashboard"));
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => goto("/dashboard"));
            }
        }
    });

    async function loadData() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = null;
        try {
            const [db, perf, redis, health, compression, aggregates, slow] =
                await Promise.all([
                    adminAPI.getDatabaseStats(),
                    adminAPI.getPerformanceStats(),
                    adminAPI.getRedisStats(),
                    adminAPI.getHealthStats(),
                    adminAPI.getCompressionStats().catch(() => ({ hypertables: [] })),
                    adminAPI.getContinuousAggregates().catch(() => ({ aggregates: [] })),
                    adminAPI.getSlowQueries().catch(() => null),
                ]);

            databaseStats = db;
            performanceStats = perf;
            redisStats = redis;
            healthStats = health;
            compressionStats = compression.hypertables;
            aggregateStats = aggregates.aggregates;
            slowQueries = slow;
            lastRefreshed = new Date();
        } catch (e: any) {
            console.error("Error loading system health:", e);
            error = e.message || "Failed to load system health data";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        if ($authStore.user?.is_admin) loadData();

        refreshInterval = setInterval(() => {
            if ($authStore.user?.is_admin) loadData();
        }, 60000);
    });

    onDestroy(() => {
        if (refreshInterval) clearInterval(refreshInterval);
    });

    function formatNumber(num: number) {
        return new Intl.NumberFormat(undefined).format(num);
    }

    function formatBytes(bytes: number) {
        if (!bytes) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
        const i = Math.min(
            Math.floor(Math.log(bytes) / Math.log(k)),
            sizes.length - 1,
        );
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    function aggregateStaleness(agg: AggregateStatsItem): { label: string; color: string } {
        if (!agg.lastRefresh) return { label: "Never refreshed", color: "text-red-500" };
        const now = new Date();
        const last = new Date(agg.lastRefresh);
        const diffMin = Math.round((now.getTime() - last.getTime()) / 60000);
        if (diffMin < 120) return { label: `${diffMin}m ago`, color: "text-green-500" };
        if (diffMin < 1440) return { label: `${Math.round(diffMin / 60)}h ago`, color: "text-yellow-500" };
        return { label: `${Math.round(diffMin / 1440)}d ago`, color: "text-red-500" };
    }

    let totalSpaceSaved = $derived(
        compressionStats.reduce((sum, h) => sum + h.spaceSavedBytes, 0),
    );

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
</script>

<svelte:head>
    <title>System Health - LogTide Admin</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
    <!-- Header -->
    <div class="flex justify-between items-center">
        <div>
            <div class="flex items-center gap-2.5">
                <h1 class="text-2xl font-bold tracking-tight">System Health</h1>
                {#if healthStats?.storageEngine}
                    <span class="text-xs font-medium px-2 py-0.5 rounded-full {engineBadgeClass}">
                        {engineLabel}
                    </span>
                {/if}
            </div>
            <p class="text-sm text-muted-foreground mt-0.5">
                {isClickHouse
                    ? 'PostgreSQL, ClickHouse, compression & infrastructure diagnostics'
                    : isMongoDB
                    ? 'MongoDB & infrastructure diagnostics'
                    : 'Database, compression, aggregates & infrastructure diagnostics'}
            </p>
        </div>
        <div class="flex items-center gap-3">
            <span class="text-xs text-muted-foreground">
                {lastRefreshed.toLocaleTimeString('en-US')}
            </span>
            <Button variant="outline" size="sm" onclick={loadData} disabled={loading}>
                <RefreshCw class="mr-1.5 h-3.5 w-3.5 {loading ? 'animate-spin' : ''}" />
                Refresh
            </Button>
        </div>
    </div>

    {#if error}
        <div class="bg-destructive/15 text-destructive p-4 rounded-md flex items-center gap-2">
            <AlertTriangle class="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
        </div>
    {/if}

    {#if $authStore.user?.is_admin}
        <!-- Connection Pool & Health -->
        <div class="grid gap-4 md:grid-cols-2 {isClickHouse || isMongoDB ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}">
            <Card class={healthStats?.database.status === 'healthy' ? 'border-green-500/30' : healthStats?.database.status === 'degraded' ? 'border-yellow-500/30' : 'border-red-500/30'}>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">
                        {isClickHouse ? 'PostgreSQL' : isMongoDB ? 'MongoDB' : 'Database'}
                    </CardTitle>
                    <Database class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent class="space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-muted-foreground">Status</span>
                        <span class="font-medium capitalize {healthStats?.database.status === 'healthy' ? 'text-green-500' : healthStats?.database.status === 'degraded' ? 'text-yellow-500' : 'text-red-500'}">
                            {healthStats?.database.status ?? "..."}
                        </span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-muted-foreground">Latency</span>
                        <span class="font-medium">{healthStats?.database.latency ?? "..."}ms</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-muted-foreground">Connections</span>
                        <span class="font-medium">{healthStats?.database.connections ?? "..."}</span>
                    </div>
                    {#if isClickHouse || isMongoDB}
                        <p class="text-xs text-muted-foreground pt-1 border-t">Metadata store</p>
                    {/if}
                </CardContent>
            </Card>

            {#if isClickHouse && healthStats?.clickhouse}
                <Card class={healthStats.clickhouse.status === 'healthy' ? 'border-green-500/30' : healthStats.clickhouse.status === 'degraded' ? 'border-yellow-500/30' : 'border-red-500/30'}>
                    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle class="text-sm font-medium">ClickHouse</CardTitle>
                        <Database class="h-4 w-4 text-orange-500" />
                    </CardHeader>
                    <CardContent class="space-y-3">
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Status</span>
                            <span class="font-medium capitalize {healthStats.clickhouse.status === 'healthy' ? 'text-green-500' : healthStats.clickhouse.status === 'degraded' ? 'text-yellow-500' : 'text-red-500'}">
                                {healthStats.clickhouse.status}
                            </span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Latency</span>
                            <span class="font-medium">
                                {healthStats.clickhouse.latency >= 0 ? `${healthStats.clickhouse.latency}ms` : "N/A"}
                            </span>
                        </div>
                        <p class="text-xs text-muted-foreground pt-1 border-t">Logs storage engine</p>
                    </CardContent>
                </Card>
            {/if}

            {#if isMongoDB && healthStats?.mongodb}
                <Card class={healthStats.mongodb.status === 'healthy' ? 'border-green-500/30' : healthStats.mongodb.status === 'degraded' ? 'border-yellow-500/30' : 'border-red-500/30'}>
                    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle class="text-sm font-medium">MongoDB</CardTitle>
                        <Database class="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent class="space-y-3">
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Status</span>
                            <span class="font-medium capitalize {healthStats.mongodb.status === 'healthy' ? 'text-green-500' : healthStats.mongodb.status === 'degraded' ? 'text-yellow-500' : 'text-red-500'}">
                                {healthStats.mongodb.status}
                            </span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Latency</span>
                            <span class="font-medium">
                                {healthStats.mongodb.latency >= 0 ? `${healthStats.mongodb.latency}ms` : "N/A"}
                            </span>
                        </div>
                        <p class="text-xs text-muted-foreground pt-1 border-t">Logs storage engine</p>
                    </CardContent>
                </Card>
            {/if}

            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Connection Pool</CardTitle>
                    <Server class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent class="space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-muted-foreground">Total</span>
                        <span class="font-medium">{healthStats?.pool.totalConnections ?? "..."}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-muted-foreground">Idle</span>
                        <span class="font-medium">{healthStats?.pool.idleConnections ?? "..."}</span>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-sm text-muted-foreground">Waiting</span>
                        <span class="font-medium {(healthStats?.pool.waitingRequests ?? 0) > 0 ? 'text-yellow-500' : ''}">
                            {healthStats?.pool.waitingRequests ?? "..."}
                        </span>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Redis</CardTitle>
                    <Activity class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent class="space-y-3">
                    {#if healthStats?.redis.status === "not_configured"}
                        <p class="text-sm text-muted-foreground">Redis not configured</p>
                    {:else}
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Memory</span>
                            <span class="font-medium">{redisStats?.memory.used ?? "..."}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Peak Memory</span>
                            <span class="font-medium">{redisStats?.memory.peak ?? "..."}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground">Connections</span>
                            <span class="font-medium">{redisStats?.connections ?? "..."}</span>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        </div>

        <!-- Database Tables -->
        <Card>
            <CardHeader class="pb-3">
                <div class="flex items-center justify-between">
                    <CardTitle class="text-sm font-medium">Database Tables</CardTitle>
                    {#if databaseStats}
                        <span class="text-xs text-muted-foreground">
                            Total: <span class="font-medium text-foreground">{databaseStats.totalSize}</span>
                        </span>
                    {/if}
                </div>
            </CardHeader>
            <CardContent>
                {#if databaseStats}
                    <Table.Root>
                        <Table.Header>
                            <Table.Row>
                                <Table.Head>Table</Table.Head>
                                <Table.Head class="text-right">Rows</Table.Head>
                                <Table.Head class="text-right">Size</Table.Head>
                                <Table.Head class="text-right">Index Size</Table.Head>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {#each databaseStats.tables as table}
                                {@const isCh = table.name.startsWith('clickhouse.')}
                                <Table.Row>
                                    <Table.Cell class="font-mono text-sm">
                                        {#if isCh}
                                            <span class="text-orange-500">{table.name.replace('clickhouse.', '')}</span>
                                            <span class="text-xs text-orange-400/70 ml-1">CH</span>
                                        {:else}
                                            {table.name.replace('public.', '')}
                                        {/if}
                                    </Table.Cell>
                                    <Table.Cell class="text-right">{formatNumber(table.rows)}</Table.Cell>
                                    <Table.Cell class="text-right">{table.size}</Table.Cell>
                                    <Table.Cell class="text-right">{table.indexes_size}</Table.Cell>
                                </Table.Row>
                            {/each}
                        </Table.Body>
                    </Table.Root>
                {:else if loading}
                    <div class="flex justify-center p-8">
                        <RefreshCw class="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- Compression & Continuous Aggregates -->
        <div class="grid gap-4 {isClickHouse || isMongoDB ? '' : 'md:grid-cols-2'}">
            <!-- Compression Stats -->
            <Card>
                <CardHeader class="pb-3">
                    <div class="flex items-center justify-between">
                        <CardTitle class="text-sm font-medium">Compression</CardTitle>
                        {#if totalSpaceSaved > 0}
                            <span class="text-xs text-green-500 font-medium">
                                {formatBytes(totalSpaceSaved)} saved
                            </span>
                        {/if}
                    </div>
                </CardHeader>
                <CardContent>
                    {#if compressionStats.length > 0}
                        <div class="space-y-4">
                            {#each compressionStats as ht}
                                <div class="space-y-1.5">
                                    <div class="flex items-center justify-between">
                                        <span class="font-mono text-sm">{ht.hypertable}</span>
                                        <span class="text-sm font-medium text-green-500">
                                            {ht.compressionRatio > 0 ? `${ht.compressionRatio.toFixed(1)}x` : "N/A"}
                                        </span>
                                    </div>
                                    <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{ht.compressedChunks}/{ht.totalChunks} {isClickHouse ? 'parts' : isMongoDB ? 'collections' : 'chunks'}</span>
                                        <span>&middot;</span>
                                        <span>{ht.spaceSavedPretty} saved</span>
                                    </div>
                                    {#if ht.totalChunks > 0}
                                        <div class="h-1.5 bg-muted rounded-full overflow-hidden">
                                            <div
                                                class="h-full bg-green-500 rounded-full transition-all"
                                                style="width: {Math.round((ht.compressedChunks / ht.totalChunks) * 100)}%"
                                            ></div>
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {:else if loading}
                        <div class="flex justify-center p-6">
                            <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    {:else}
                        <p class="text-sm text-muted-foreground text-center py-6">No compression data</p>
                    {/if}
                </CardContent>
            </Card>

            <!-- Continuous Aggregates (TimescaleDB only) -->
            {#if !isClickHouse && !isMongoDB}
                <Card>
                    <CardHeader class="pb-3">
                        <CardTitle class="text-sm font-medium">Continuous Aggregates</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {#if aggregateStats.length > 0}
                            <div class="space-y-4">
                                {#each aggregateStats as agg}
                                    {@const staleness = aggregateStaleness(agg)}
                                    <div class="space-y-1">
                                        <div class="flex items-center justify-between">
                                            <span class="font-mono text-sm">{agg.viewName}</span>
                                            <div class="flex items-center gap-1.5">
                                                <Clock class="h-3 w-3 {staleness.color}" />
                                                <span class="text-xs {staleness.color}">{staleness.label}</span>
                                            </div>
                                        </div>
                                        <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>Refresh: {agg.refreshInterval}</span>
                                            <span>&middot;</span>
                                            <span>{formatNumber(agg.totalRows)} rows</span>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else if loading}
                            <div class="flex justify-center p-6">
                                <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        {:else}
                            <p class="text-sm text-muted-foreground text-center py-6">No aggregates found</p>
                        {/if}
                    </CardContent>
                </Card>
            {/if}
        </div>

        <!-- Performance Stats -->
        <Card>
            <CardHeader class="pb-3">
                <CardTitle class="text-sm font-medium">Storage & Performance</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="grid gap-6 md:grid-cols-2 {isClickHouse || isMongoDB ? '' : 'lg:grid-cols-4'}">
                    {#if !isClickHouse && !isMongoDB}
                        <div>
                            <div class="text-xs text-muted-foreground mb-1">Logs Storage</div>
                            <div class="text-lg font-bold">{performanceStats?.storage.logsSize || "..."}</div>
                        </div>
                        <div>
                            <div class="text-xs text-muted-foreground mb-1">Compression Ratio</div>
                            <div class="text-lg font-bold text-green-500">
                                {performanceStats?.storage.compressionRatio
                                    ? `${performanceStats.storage.compressionRatio.toFixed(1)}x`
                                    : "..."}
                            </div>
                        </div>
                    {/if}
                    <div>
                        <div class="text-xs text-muted-foreground mb-1">Ingestion Throughput</div>
                        <div class="text-lg font-bold">
                            {performanceStats
                                ? `${performanceStats.ingestion.throughput.toFixed(1)} logs/s`
                                : "..."}
                        </div>
                    </div>
                    {#if !isClickHouse && !isMongoDB}
                        <div>
                            <div class="text-xs text-muted-foreground mb-1">Avg Latency</div>
                            <div class="text-lg font-bold">
                                {performanceStats
                                    ? `${Math.round(performanceStats.ingestion.avgLatency)}ms`
                                    : "..."}
                            </div>
                        </div>
                    {/if}
                </div>
            </CardContent>
        </Card>

        <!-- Queue Details -->
        {#if healthStats?.redis.status !== "not_configured"}
            <Card>
                <CardHeader class="pb-3">
                    <CardTitle class="text-sm font-medium">Worker Queues</CardTitle>
                </CardHeader>
                <CardContent>
                    <div class="grid gap-4 md:grid-cols-2">
                        <div class="rounded-md border p-4">
                            <h4 class="text-sm font-medium mb-3">Alert Notifications</h4>
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div class="text-xs text-muted-foreground">Waiting</div>
                                    <div class="font-bold">{redisStats?.queues.alertNotifications.waiting ?? "..."}</div>
                                </div>
                                <div>
                                    <div class="text-xs text-muted-foreground">Active</div>
                                    <div class="font-bold">{redisStats?.queues.alertNotifications.active ?? "..."}</div>
                                </div>
                                <div>
                                    <div class="text-xs text-muted-foreground">Completed</div>
                                    <div class="font-bold text-green-500">{redisStats?.queues.alertNotifications.completed ?? "..."}</div>
                                </div>
                                <div>
                                    <div class="text-xs text-muted-foreground">Failed</div>
                                    <div class="font-bold {(redisStats?.queues.alertNotifications.failed ?? 0) > 0 ? 'text-red-500' : ''}">
                                        {redisStats?.queues.alertNotifications.failed ?? "..."}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="rounded-md border p-4">
                            <h4 class="text-sm font-medium mb-3">Sigma Detection</h4>
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div class="text-xs text-muted-foreground">Waiting</div>
                                    <div class="font-bold">{redisStats?.queues.sigmaDetection.waiting ?? "..."}</div>
                                </div>
                                <div>
                                    <div class="text-xs text-muted-foreground">Active</div>
                                    <div class="font-bold">{redisStats?.queues.sigmaDetection.active ?? "..."}</div>
                                </div>
                                <div>
                                    <div class="text-xs text-muted-foreground">Completed</div>
                                    <div class="font-bold text-green-500">{redisStats?.queues.sigmaDetection.completed ?? "..."}</div>
                                </div>
                                <div>
                                    <div class="text-xs text-muted-foreground">Failed</div>
                                    <div class="font-bold {(redisStats?.queues.sigmaDetection.failed ?? 0) > 0 ? 'text-red-500' : ''}">
                                        {redisStats?.queues.sigmaDetection.failed ?? "..."}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        {/if}

        <!-- Slow Queries -->
        <Card>
            <CardHeader class="pb-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Zap class="h-4 w-4 text-muted-foreground" />
                        <CardTitle class="text-sm font-medium">
                            Active {isClickHouse ? 'PostgreSQL ' : isMongoDB ? 'MongoDB ' : ''}Queries
                        </CardTitle>
                    </div>
                    {#if slowQueries}
                        <span class="text-xs text-muted-foreground">
                            {slowQueries.activeQueries.length} running
                        </span>
                    {/if}
                </div>
            </CardHeader>
            <CardContent>
                {#if slowQueries && slowQueries.activeQueries.length > 0}
                    <Table.Root>
                        <Table.Header>
                            <Table.Row>
                                <Table.Head class="w-[60px]">PID</Table.Head>
                                <Table.Head>Query</Table.Head>
                                <Table.Head class="w-[90px] text-right">Duration</Table.Head>
                                <Table.Head class="w-[80px]">State</Table.Head>
                                <Table.Head class="w-[120px]">Wait</Table.Head>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {#each slowQueries.activeQueries as q}
                                <Table.Row>
                                    <Table.Cell class="font-mono text-xs">{q.pid}</Table.Cell>
                                    <Table.Cell>
                                        <div class="font-mono text-xs truncate max-w-[400px]" title={q.query}>
                                            {q.query}
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell class="text-right font-medium {q.durationMs > 5000 ? 'text-red-500' : q.durationMs > 1000 ? 'text-yellow-500' : ''}">
                                        {q.durationMs > 1000 ? `${(q.durationMs / 1000).toFixed(1)}s` : `${q.durationMs}ms`}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <span class="text-xs capitalize">{q.state}</span>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <span class="text-xs text-muted-foreground">{q.waitEvent ?? "-"}</span>
                                    </Table.Cell>
                                </Table.Row>
                            {/each}
                        </Table.Body>
                    </Table.Root>
                {:else if slowQueries}
                    <p class="text-sm text-muted-foreground text-center py-6">No active queries</p>
                {:else if loading}
                    <div class="flex justify-center p-6">
                        <RefreshCw class="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- Top Slow Queries (pg_stat_statements) -->
        {#if slowQueries?.pgStatStatementsAvailable}
            <Card>
                <CardHeader class="pb-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <Clock class="h-4 w-4 text-muted-foreground" />
                            <CardTitle class="text-sm font-medium">Slowest Queries (Historical)</CardTitle>
                        </div>
                        <span class="text-xs text-muted-foreground">via pg_stat_statements</span>
                    </div>
                </CardHeader>
                <CardContent>
                    {#if slowQueries.topSlowQueries.length > 0}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>Query</Table.Head>
                                    <Table.Head class="text-right w-[80px]">Calls</Table.Head>
                                    <Table.Head class="text-right w-[90px]">Avg</Table.Head>
                                    <Table.Head class="text-right w-[90px]">Total</Table.Head>
                                    <Table.Head class="text-right w-[90px]">Rows/Call</Table.Head>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each slowQueries.topSlowQueries as q}
                                    <Table.Row>
                                        <Table.Cell>
                                            <div class="font-mono text-xs truncate max-w-[400px]" title={q.query}>
                                                {q.query}
                                            </div>
                                        </Table.Cell>
                                        <Table.Cell class="text-right">{formatNumber(q.calls)}</Table.Cell>
                                        <Table.Cell class="text-right font-medium {q.avg_ms > 100 ? 'text-red-500' : q.avg_ms > 10 ? 'text-yellow-500' : ''}">
                                            {q.avg_ms.toFixed(1)}ms
                                        </Table.Cell>
                                        <Table.Cell class="text-right">
                                            {q.total_ms > 1000 ? `${(q.total_ms / 1000).toFixed(1)}s` : `${q.total_ms.toFixed(0)}ms`}
                                        </Table.Cell>
                                        <Table.Cell class="text-right">{formatNumber(Math.round(q.rows_per_call))}</Table.Cell>
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
                    {:else}
                        <p class="text-sm text-muted-foreground text-center py-6">No slow query data available</p>
                    {/if}
                </CardContent>
            </Card>
        {/if}
    {:else}
        <div class="flex flex-col items-center justify-center p-12 text-center">
            <div class="bg-muted/50 p-6 rounded-full mb-4">
                <RefreshCw class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
            <h2 class="text-xl font-semibold">Verifying Access...</h2>
            <p class="text-muted-foreground mt-2">Updating your profile permissions.</p>
        </div>
    {/if}
</div>
