<script lang="ts">
    import { onMount, onDestroy, untrack, type Snippet } from "svelte";
    import { BrandIcon, engineBrand } from "$lib/components/brand";
    import { formatTimestamp } from "$lib/utils/datetime";
    import { formatCount, formatCompact, formatPercent } from "$lib/utils/format-number";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import DataTable from "$lib/components/app/DataTable.svelte";
    import type { DataTableColumn } from "$lib/components/app/data-table";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import StatsCard from "$lib/components/dashboard/StatsCard.svelte";
    import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import { Button } from "$lib/components/ui/button";
    import { adminAPI } from "$lib/api/admin";
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
    import { authStore } from "$lib/stores/auth";
    import { toastStore } from "$lib/stores/toast";
    import Users from "@lucide/svelte/icons/users";
    import Building2 from "@lucide/svelte/icons/building-2";
    import FolderKanban from "@lucide/svelte/icons/folder-kanban";
    import Database from "@lucide/svelte/icons/database";
    import Zap from "@lucide/svelte/icons/zap";
    import Bell from "@lucide/svelte/icons/bell";
    import Cpu from "@lucide/svelte/icons/cpu";
    import RefreshCw from "@lucide/svelte/icons/refresh-cw";
    import PlatformTimelineChart from "$lib/components/admin/PlatformTimelineChart.svelte";
    import OverviewHealthBanner from "$lib/components/admin/OverviewHealthBanner.svelte";
    import OverviewActiveIssues from "$lib/components/admin/OverviewActiveIssues.svelte";
    import OverviewIngestionHealth from "$lib/components/admin/OverviewIngestionHealth.svelte";
    import OverviewVersionBanner from "$lib/components/admin/OverviewVersionBanner.svelte";

    const REFRESH_MS = 30_000;

    // Each widget owns its data and error, so one failing endpoint never blanks the rest.
    type Slot<T> = { data: T | null; error: string | null; loaded: boolean };
    const emptySlot = <T,>(): Slot<T> => ({ data: null, error: null, loaded: false });

    let system = $state<Slot<SystemStats>>(emptySlot());
    let logs = $state<Slot<LogsStats>>(emptySlot());
    let perf = $state<Slot<PerformanceStats>>(emptySlot());
    let alerts = $state<Slot<AlertsStats>>(emptySlot());
    let redis = $state<Slot<RedisStats>>(emptySlot());
    let health = $state<Slot<HealthStats>>(emptySlot());
    let timeline = $state<Slot<PlatformTimeline>>(emptySlot());
    let issues = $state<Slot<ActiveIssues>>(emptySlot());
    let version = $state<Slot<VersionCheckResult>>(emptySlot());
    let ingestion = $state<Slot<IngestionHealthStats>>(emptySlot());

    let refreshing = $state(false);
    let lastRefreshed = $state<Date | null>(null);
    let timer: ReturnType<typeof setInterval> | undefined;

    const engine = $derived(health.data?.storageEngine);
    const engineLabel = $derived(
        engine === "mongodb" ? "MongoDB" : engine === "clickhouse" ? "ClickHouse" : "TimescaleDB",
    );
    const engineBrandSlug = $derived(engineBrand(engine ?? "timescale"));

    const slots = $derived([system, logs, perf, alerts, redis, health, timeline, issues, version, ingestion]);
    const everythingFailed = $derived(slots.every((s) => s.loaded && s.data === null && s.error !== null));
    const someFailed = $derived(!everythingFailed && slots.some((s) => s.error !== null));

    const notificationSuccessRate = $derived.by(() => {
        const n = alerts.data?.notifications;
        if (!n) return null;
        const total = n.success + n.failed;
        return total === 0 ? 100 : (n.success / total) * 100;
    });

    /** A finished load keeps the last good data when a refresh fails. */
    function settle<T>(prev: Slot<T>, result: PromiseSettledResult<T>): Slot<T> {
        if (result.status === "fulfilled") return { data: result.value, error: null, loaded: true };
        const message = result.reason instanceof Error ? result.reason.message : "Failed to load";
        return { data: prev.data, error: message, loaded: true };
    }

    async function loadData(background = false) {
        if ($authStore.user?.is_admin !== true) return;
        // Background refreshes never touch the loading UI.
        if (!background) refreshing = true;

        const results = await Promise.allSettled([
            adminAPI.getSystemStats(),
            adminAPI.getLogsStats(),
            adminAPI.getPerformanceStats(),
            adminAPI.getAlertsStats(),
            adminAPI.getRedisStats(),
            adminAPI.getHealthStats(),
            adminAPI.getPlatformTimeline(24),
            adminAPI.getActiveIssues(),
            adminAPI.getVersionCheck(),
            adminAPI.getIngestionHealth(),
        ]);

        system = settle(system, results[0] as PromiseSettledResult<SystemStats>);
        logs = settle(logs, results[1] as PromiseSettledResult<LogsStats>);
        perf = settle(perf, results[2] as PromiseSettledResult<PerformanceStats>);
        alerts = settle(alerts, results[3] as PromiseSettledResult<AlertsStats>);
        redis = settle(redis, results[4] as PromiseSettledResult<RedisStats>);
        health = settle(health, results[5] as PromiseSettledResult<HealthStats>);
        timeline = settle(timeline, results[6] as PromiseSettledResult<PlatformTimeline>);
        issues = settle(issues, results[7] as PromiseSettledResult<ActiveIssues>);
        version = settle(version, results[8] as PromiseSettledResult<VersionCheckResult>);
        ingestion = settle(ingestion, results[9] as PromiseSettledResult<IngestionHealthStats>);

        if (results.some((r) => r.status === "fulfilled")) lastRefreshed = new Date();
        if (!background) {
            refreshing = false;
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) toastStore.error(`${failed} overview ${failed === 1 ? "widget" : "widgets"} could not be loaded`);
        }
    }

    // First load once the admin check passes; the interval then refreshes quietly.
    let started = false;
    $effect(() => {
        if ($authStore.user?.is_admin !== true || started) return;
        started = true;
        untrack(() => void loadData());
    });

    onMount(() => {
        timer = setInterval(() => void loadData(true), REFRESH_MS);
    });

    onDestroy(() => {
        if (timer) clearInterval(timer);
    });

    type OrgRow = LogsStats["topOrganizations"][number];
    type ProjectRow = LogsStats["topProjects"][number];
    const asCell = (s: unknown) => s as Snippet<[never]>;
    const asSnippet = (s: unknown) => s as Snippet;

    const orgColumns: DataTableColumn<OrgRow>[] = [
        { key: "name", header: "Organization", cell: asCell(orgNameCell) },
        { key: "count", header: "Logs, 30 days", class: "text-right tabular-nums", cell: asCell(orgCountCell) },
    ];
    const projectColumns: DataTableColumn<ProjectRow>[] = [
        { key: "name", header: "Project", cell: asCell(projectNameCell) },
        { key: "org", header: "Organization", class: "hidden sm:table-cell", cell: asCell(projectOrgCell) },
        { key: "count", header: "Logs, 30 days", class: "text-right tabular-nums", cell: asCell(projectCountCell) },
    ];
</script>

<svelte:head>
    <title>Instance overview - LogTide</title>
</svelte:head>

{#snippet orgNameCell(o: OrgRow)}
    <a
        href="/dashboard/admin/organizations/{o.organizationId}"
        class="font-medium hover:text-primary hover:underline underline-offset-4"
    >
        {o.organizationName}
    </a>
{/snippet}
{#snippet orgCountCell(o: OrgRow)}{formatCount(o.count)}{/snippet}
{#snippet projectNameCell(p: ProjectRow)}
    <a
        href="/dashboard/admin/projects/{p.projectId}"
        class="font-medium hover:text-primary hover:underline underline-offset-4"
    >
        {p.projectName}
    </a>
{/snippet}
{#snippet projectOrgCell(p: ProjectRow)}<span class="text-muted-foreground">{p.organizationName}</span>{/snippet}
{#snippet projectCountCell(p: ProjectRow)}{formatCount(p.count)}{/snippet}

{#snippet orgMobile(o: OrgRow)}
    <div class="flex items-center justify-between gap-2">
        <a href="/dashboard/admin/organizations/{o.organizationId}" class="truncate font-medium hover:text-primary">{o.organizationName}</a>
        <span class="tabular-nums">{formatCount(o.count)}</span>
    </div>
{/snippet}
{#snippet projectMobile(p: ProjectRow)}
    <div class="space-y-0.5">
        <div class="flex items-center justify-between gap-2">
            <a href="/dashboard/admin/projects/{p.projectId}" class="truncate font-medium hover:text-primary">{p.projectName}</a>
            <span class="tabular-nums">{formatCount(p.count)}</span>
        </div>
        <p class="truncate text-xs text-muted-foreground">{p.organizationName}</p>
    </div>
{/snippet}

<!-- One KPI: skeleton until its own data arrives, a dash when it failed. -->
{#snippet kpi(slot: Slot<unknown>, card: Snippet)}
    {#if !slot.loaded}
        <Skeleton class="h-28 w-full" />
    {:else}
        {@render card()}
    {/if}
{/snippet}

<div class="space-y-6">
    <PageHeader
        title="Instance overview"
        appliesTo="instance"
        description="Platform health, performance and usage"
    >
        {#snippet meta()}
            {#if engine}
                <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium">
                    {#if engineBrandSlug}<BrandIcon brand={engineBrandSlug} class="size-3.5" />{/if}
                    {engineLabel}
                </span>
            {/if}
        {/snippet}
        {#snippet actions()}
            {#if lastRefreshed}
                <span class="text-xs text-muted-foreground">
                    Updated {formatTimestamp(lastRefreshed, { precision: "second" })}
                </span>
            {/if}
            <Button variant="outline" size="sm" onclick={() => loadData()} disabled={refreshing}>
                <RefreshCw class="mr-1.5 h-3.5 w-3.5 {refreshing ? 'animate-spin' : ''}" />
                Refresh
            </Button>
        {/snippet}
    </PageHeader>

    {#if everythingFailed}
        <EmptyState variant="error" title="Could not load the overview" description={system.error ?? "The server did not respond."}>
            {#snippet actions()}
                <Button onclick={() => loadData()}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else}
        {#if someFailed}
            <div role="status" class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm">
                <span>Some widgets could not be loaded. Showing the last data available.</span>
                <Button variant="outline" size="sm" onclick={() => loadData()} disabled={refreshing}>Retry</Button>
            </div>
        {/if}

        <OverviewHealthBanner health={health.data} loading={!health.loaded} error={health.error} />

        <OverviewVersionBanner version={version.data} failed={version.loaded && version.error !== null && !version.data} />

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {#snippet usersCard()}
                <StatsCard
                    title="Users"
                    icon={Users}
                    value={formatCount(system.data?.users.total)}
                    description={system.data
                        ? `${formatCount(system.data.users.active)} active, ${formatCount(system.data.users.growth.today)} new today`
                        : "Unavailable"}
                />
            {/snippet}
            {@render kpi(system, asSnippet(usersCard))}

            {#snippet orgsCard()}
                <StatsCard
                    title="Organizations"
                    icon={Building2}
                    value={formatCount(system.data?.organizations.total)}
                    description={system.data ? `${formatCount(system.data.organizations.growth.week)} new in the last 7 days` : "Unavailable"}
                />
            {/snippet}
            {@render kpi(system, asSnippet(orgsCard))}

            {#snippet projectsCard()}
                <StatsCard
                    title="Projects"
                    icon={FolderKanban}
                    value={formatCount(system.data?.projects.total)}
                    description={system.data ? `${formatCount(system.data.projects.growth.week)} new in the last 7 days` : "Unavailable"}
                />
            {/snippet}
            {@render kpi(system, asSnippet(projectsCard))}

            {#snippet totalLogsCard()}
                <StatsCard
                    title="Total logs stored"
                    icon={Database}
                    value={formatCompact(logs.data?.total)}
                    description={logs.data ? `${formatCompact(logs.data.growth.logsPerDay)} ingested in the last 24 hours` : "Unavailable"}
                />
            {/snippet}
            {@render kpi(logs, asSnippet(totalLogsCard))}

            {#snippet ingestionCard()}
                <StatsCard
                    title="Ingestion"
                    icon={Zap}
                    value={perf.data ? `${perf.data.ingestion.throughput.toFixed(1)} logs/s` : "-"}
                    description={perf.data
                        ? `Average over the last hour${logs.data ? `, ${formatCompact(logs.data.growth.logsPerHour)} logs` : ""}`
                        : "Unavailable"}
                />
            {/snippet}
            {@render kpi(perf, asSnippet(ingestionCard))}

            {#snippet storageCard()}
                <StatsCard
                    title="Log storage"
                    icon={Database}
                    value={perf.data && perf.data.storage.logsSize && perf.data.storage.logsSize !== "N/A" ? perf.data.storage.logsSize : "-"}
                    description={perf.data?.storage.compressionRatio
                        ? `Current size, ${perf.data.storage.compressionRatio.toFixed(1)}x compression`
                        : `Current size on ${engineLabel}`}
                />
            {/snippet}
            {@render kpi(perf, asSnippet(storageCard))}

            {#snippet alertsCard()}
                <StatsCard
                    title="Alert rules"
                    icon={Bell}
                    value={formatCount(alerts.data?.rules.active)}
                    description={alerts.data
                        ? `Active now, ${formatCount(alerts.data.triggered.last24h)} triggered in the last 24 hours, ${formatPercent(notificationSuccessRate, 0)} delivered (all time)`
                        : "Unavailable"}
                />
            {/snippet}
            {@render kpi(alerts, asSnippet(alertsCard))}

            {#snippet queuesCard()}
                <StatsCard
                    title="Worker queues"
                    icon={Cpu}
                    value={redis.data
                        ? `${formatCount(redis.data.queues.alertNotifications.waiting + redis.data.queues.sigmaDetection.waiting)} waiting`
                        : "-"}
                    description={redis.data
                        ? `Now: ${formatCount(redis.data.queues.alertNotifications.failed + redis.data.queues.sigmaDetection.failed)} failed jobs, ${redis.data.memory.used} Redis memory`
                        : "Unavailable"}
                />
            {/snippet}
            {@render kpi(redis, asSnippet(queuesCard))}
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <OverviewActiveIssues issues={issues.data} loading={!issues.loaded} error={issues.error} />
            <OverviewIngestionHealth health={ingestion.data} loading={!ingestion.loaded} error={ingestion.error} />
        </div>

        <Card>
            <CardHeader class="pb-2">
                <CardTitle class="text-sm font-medium">Platform activity, last 24 hours</CardTitle>
            </CardHeader>
            <CardContent class="pb-4">
                {#if !timeline.loaded}
                    <Skeleton class="h-[280px] w-full" />
                {:else if timeline.data && timeline.data.timeline.length > 0}
                    <PlatformTimelineChart data={timeline.data} />
                {:else if timeline.error}
                    <p class="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                        Activity is unavailable: {timeline.error}
                    </p>
                {:else}
                    <div class="flex h-[280px] flex-col items-center justify-center text-muted-foreground">
                        <Database class="mb-2 h-8 w-8" />
                        <p class="text-sm">No activity data yet</p>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <div class="grid gap-4 lg:grid-cols-2">
            <section class="space-y-2" aria-labelledby="top-orgs-heading">
                <h2 id="top-orgs-heading" class="text-sm font-medium">Top organizations by logs, last 30 days</h2>
                <DataTable
                    columns={orgColumns}
                    rows={logs.data?.topOrganizations ?? []}
                    loading={!logs.loaded}
                    rowKey={(o) => o.organizationId}
                    mobileRow={asCell(orgMobile)}
                >
                    {#snippet empty()}{logs.error && !logs.data ? "Could not load this list." : "No data yet."}{/snippet}
                </DataTable>
            </section>
            <section class="space-y-2" aria-labelledby="top-projects-heading">
                <h2 id="top-projects-heading" class="text-sm font-medium">Top projects by logs, last 30 days</h2>
                <DataTable
                    columns={projectColumns}
                    rows={logs.data?.topProjects ?? []}
                    loading={!logs.loaded}
                    rowKey={(p) => p.projectId}
                    mobileRow={asCell(projectMobile)}
                >
                    {#snippet empty()}{logs.error && !logs.data ? "Could not load this list." : "No data yet."}{/snippet}
                </DataTable>
            </section>
        </div>
    {/if}
</div>
