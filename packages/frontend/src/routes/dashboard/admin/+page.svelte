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
        DatabaseStats,
        LogsStats,
        PerformanceStats,
        AlertsStats,
        RedisStats,
        HealthStats,
    } from "$lib/api/admin";
    import {
        Activity,
        Database,
        Server,
        AlertTriangle,
        Users,
        HardDrive,
        Zap,
        RefreshCw,
    } from "lucide-svelte";
    import * as Table from "$lib/components/ui/table";
    import { Button } from "$lib/components/ui/button";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";

    let systemStats = $state<SystemStats | null>(null);
    let databaseStats = $state<DatabaseStats | null>(null);
    let logsStats = $state<LogsStats | null>(null);
    let performanceStats = $state<PerformanceStats | null>(null);
    let alertsStats = $state<AlertsStats | null>(null);
    let redisStats = $state<RedisStats | null>(null);
    let healthStats = $state<HealthStats | null>(null);

    let loading = $state(true);
    let error = $state<string | null>(null);
    let refreshInterval: ReturnType<typeof setInterval>;
    let lastRefreshed = $state(new Date());

    const usersAPI = new UsersAPI(() => get(authStore).token);

    $effect(() => {
        if (browser && $authStore.user) {
            if ($authStore.user.is_admin === undefined) {
                untrack(() => {
                    console.log("Admin status unknown, refreshing profile...");
                    usersAPI
                        .getCurrentUser()
                        .then(({ user }) => {
                            console.log("Profile refreshed:", user);
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
                        .catch((err) => {
                            console.error("Failed to refresh profile:", err);
                            goto("/dashboard");
                        });
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => {
                    console.warn(
                        "Access denied: User is not admin. Redirecting to dashboard.",
                    );
                    goto("/dashboard");
                });
            }
        }
    });

    async function loadData() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = null;
        try {
            const [system, db, logs, perf, alerts, redis, health] =
                await Promise.all([
                    adminAPI.getSystemStats(),
                    adminAPI.getDatabaseStats(),
                    adminAPI.getLogsStats(),
                    adminAPI.getPerformanceStats(),
                    adminAPI.getAlertsStats(),
                    adminAPI.getRedisStats(),
                    adminAPI.getHealthStats(),
                ]);

            systemStats = system;
            databaseStats = db;
            logsStats = logs;
            performanceStats = perf;
            alertsStats = alerts;
            redisStats = redis;
            healthStats = health;
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

    function formatBytes(bytes: any) {
        if (!bytes) return "0 B";
        if (typeof bytes === "string") return bytes;
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    function formatNumber(num: number) {
        return new Intl.NumberFormat("en-US").format(num);
    }
</script>

<div class="container mx-auto p-6 space-y-8">
    <div class="flex justify-between items-center">
        <div>
            <h1 class="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p class="text-muted-foreground mt-1">
                System-wide monitoring and statistics
            </p>
        </div>
        <div class="flex items-center gap-4">
            <span class="text-sm text-muted-foreground">
                Last updated: {lastRefreshed.toLocaleTimeString()}
            </span>
            <Button
                variant="outline"
                size="sm"
                onclick={loadData}
                disabled={loading}
            >
                <RefreshCw
                    class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}"
                />
                Refresh
            </Button>
        </div>
    </div>

    {#if error}
        <div
            class="bg-destructive/15 text-destructive p-4 rounded-md flex items-center gap-2"
        >
            <AlertTriangle class="h-5 w-5" />
            <span>{error}</span>
        </div>
    {/if}

    {#if $authStore.user?.is_admin}
        <div class="grid gap-4 md:grid-cols-3">
            <Card
                class={healthStats?.overall === "healthy"
                    ? "border-green-500/50 bg-green-500/5"
                    : healthStats?.overall === "degraded"
                      ? "border-yellow-500/50 bg-yellow-500/5"
                      : "border-red-500/50 bg-red-500/5"}
            >
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium"
                        >System Health</CardTitle
                    >
                    <Activity class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold capitalize">
                        {healthStats?.overall || "Unknown"}
                    </div>
                    <div class="text-xs text-muted-foreground mt-1">
                        DB: {healthStats?.database.status} ({healthStats
                            ?.database.latency}ms) | Redis: {healthStats?.redis
                            .status}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium"
                        >Total Users</CardTitle
                    >
                    <Users class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {systemStats
                            ? formatNumber(systemStats.users.total)
                            : "-"}
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        +{systemStats?.users.growth.today || 0} today | {systemStats
                            ?.users.active || 0} active
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium">Total Logs</CardTitle
                    >
                    <Database class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {logsStats ? formatNumber(logsStats.total) : "-"}
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        +{logsStats
                            ? formatNumber(logsStats.growth.logsPerDay)
                            : 0} last 24h
                    </p>
                </CardContent>
            </Card>
        </div>

        <!-- Detailed Stats Grid -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <!-- Main Database Stats -->
            <Card class="col-span-4">
                <CardHeader>
                    <CardTitle>Database Tables</CardTitle>
                </CardHeader>
                <CardContent>
                    {#if databaseStats}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>Table Name</Table.Head>
                                    <Table.Head class="text-right"
                                        >Rows</Table.Head
                                    >
                                    <Table.Head class="text-right"
                                        >Size</Table.Head
                                    >
                                    <Table.Head class="text-right"
                                        >Index Size</Table.Head
                                    >
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each databaseStats.tables as table}
                                    <Table.Row>
                                        <Table.Cell class="font-medium"
                                            >{table.name}</Table.Cell
                                        >
                                        <Table.Cell class="text-right"
                                            >{formatNumber(
                                                table.rows,
                                            )}</Table.Cell
                                        >
                                        <Table.Cell class="text-right"
                                            >{table.size}</Table.Cell
                                        >
                                        <Table.Cell class="text-right"
                                            >{table.indexes_size}</Table.Cell
                                        >
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
                        <div
                            class="mt-4 text-sm text-muted-foreground text-right"
                        >
                            Total DB Size: <span
                                class="font-bold text-foreground"
                                >{databaseStats.totalSize}</span
                            >
                        </div>
                    {:else}
                        <div class="flex justify-center p-8">
                            <RefreshCw
                                class="h-8 w-8 animate-spin text-muted-foreground"
                            />
                        </div>
                    {/if}
                </CardContent>
            </Card>

            <div class="col-span-3 space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <Zap class="h-4 w-4" /> Performance
                        </CardTitle>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground"
                                >Ingestion Rate</span
                            >
                            <span class="font-bold"
                                >{performanceStats
                                    ? performanceStats.ingestion.throughput.toFixed(
                                          1,
                                      )
                                    : "-"} logs/sec</span
                            >
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground"
                                >Redis Memory</span
                            >
                            <span class="font-bold"
                                >{redisStats
                                    ? redisStats.memory.used
                                    : "-"}</span
                            >
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground"
                                >Redis Connections</span
                            >
                            <span class="font-bold"
                                >{redisStats
                                    ? redisStats.connections
                                    : "-"}</span
                            >
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-sm text-muted-foreground"
                                >DB Connections</span
                            >
                            <span class="font-bold"
                                >{healthStats
                                    ? healthStats.database.connections
                                    : "-"}</span
                            >
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <AlertTriangle class="h-4 w-4" /> Alert System
                        </CardTitle>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="bg-muted/50 p-3 rounded-md text-center">
                                <div class="text-2xl font-bold">
                                    {alertsStats
                                        ? alertsStats.rules.active
                                        : "-"}
                                </div>
                                <div class="text-xs text-muted-foreground">
                                    Active Rules
                                </div>
                            </div>
                            <div class="bg-muted/50 p-3 rounded-md text-center">
                                <div class="text-2xl font-bold">
                                    {alertsStats
                                        ? alertsStats.triggered.last24h
                                        : "-"}
                                </div>
                                <div class="text-xs text-muted-foreground">
                                    Triggered (24h)
                                </div>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <div class="flex justify-between text-sm">
                                <span class="text-muted-foreground"
                                    >Notifications Sent</span
                                >
                                <span class="text-green-500 font-medium"
                                    >{alertsStats
                                        ? alertsStats.notifications.success
                                        : "-"}</span
                                >
                            </div>
                            <div class="flex justify-between text-sm">
                                <span class="text-muted-foreground"
                                    >Notifications Failed</span
                                >
                                <span class="text-red-500 font-medium"
                                    >{alertsStats
                                        ? alertsStats.notifications.failed
                                        : "-"}</span
                                >
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle>Top Organizations (by Logs)</CardTitle>
                </CardHeader>
                <CardContent>
                    {#if logsStats}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>Organization</Table.Head>
                                    <Table.Head class="text-right"
                                        >Logs</Table.Head
                                    >
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each logsStats.topOrganizations as org}
                                    <Table.Row>
                                        <Table.Cell class="font-medium"
                                            >{org.organizationName}</Table.Cell
                                        >
                                        <Table.Cell class="text-right"
                                            >{formatNumber(
                                                org.count,
                                            )}</Table.Cell
                                        >
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Top Projects (by Logs)</CardTitle>
                </CardHeader>
                <CardContent>
                    {#if logsStats}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>Project</Table.Head>
                                    <Table.Head>Organization</Table.Head>
                                    <Table.Head class="text-right"
                                        >Logs</Table.Head
                                    >
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each logsStats.topProjects as proj}
                                    <Table.Row>
                                        <Table.Cell class="font-medium"
                                            >{proj.projectName}</Table.Cell
                                        >
                                        <Table.Cell
                                            class="text-muted-foreground"
                                            >{proj.organizationName}</Table.Cell
                                        >
                                        <Table.Cell class="text-right"
                                            >{formatNumber(
                                                proj.count,
                                            )}</Table.Cell
                                        >
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
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
