<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { BrandIcon, engineBrand } from "$lib/components/brand";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import DataTable from "$lib/components/app/DataTable.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import Timestamp from "$lib/components/app/Timestamp.svelte";
    import type { DataTableColumn, DataTableSort } from "$lib/components/app/data-table";
    import SystemHealthBanner from "$lib/components/admin/SystemHealthBanner.svelte";
    import SystemHealthCard from "$lib/components/admin/SystemHealthCard.svelte";
    import SystemHealthQueryCell from "$lib/components/admin/SystemHealthQueryCell.svelte";
    import {
        healthState,
        parseSizeToBytes,
        formatDurationMs,
        formatUpdatedAgo,
        sortRows,
        aggregateStaleness,
    } from "$lib/components/admin/system-health";
    import { stateTone } from "$lib/utils/severity";
    import { formatCount, formatBytes } from "$lib/utils/format-number";
    import { adminAPI } from "$lib/api/admin";
    import type {
        DatabaseStats,
        PerformanceStats,
        RedisStats,
        HealthStats,
        CompressionStatsItem,
        AggregateStatsItem,
        SlowQueriesStats,
        IngestionHealthStats,
    } from "$lib/api/admin";
    import { RefreshCw, Database, Server, Activity, Clock, Zap, Layers, ShieldCheck } from "@lucide/svelte";
    import { Button } from "$lib/components/ui/button";

    // The admin layout already blocks this page until the user is confirmed as admin.

    type Res<T> = { data: T | null; error: string | null; loading: boolean };
    const blank = <T,>(): Res<T> => ({ data: null, error: null, loading: true });

    let health = $state<Res<HealthStats>>(blank());
    let db = $state<Res<DatabaseStats>>(blank());
    let perf = $state<Res<PerformanceStats>>(blank());
    let redis = $state<Res<RedisStats>>(blank());
    let compression = $state<Res<CompressionStatsItem[]>>(blank());
    let aggregates = $state<Res<AggregateStatsItem[]>>(blank());
    let slow = $state<Res<SlowQueriesStats>>(blank());
    let ingestion = $state<Res<IngestionHealthStats>>(blank());

    let manualRefreshing = $state(false);
    let updatedAt = $state<number | null>(null);
    let now = $state(Date.now());
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let tickTimer: ReturnType<typeof setInterval> | undefined;

    /** Runs one fetch. Keeps previous data on failure and never flips back to loading. */
    async function run<T>(res: Res<T>, fn: () => Promise<T>): Promise<void> {
        try {
            res.data = await fn();
            res.error = null;
        } catch (e) {
            res.error = e instanceof Error && e.message ? e.message : "Request failed";
        } finally {
            res.loading = false;
        }
    }

    const loaders = {
        health: () => run(health, () => adminAPI.getHealthStats()),
        db: () => run(db, () => adminAPI.getDatabaseStats()),
        perf: () => run(perf, () => adminAPI.getPerformanceStats()),
        redis: () => run(redis, () => adminAPI.getRedisStats()),
        compression: () => run(compression, async () => (await adminAPI.getCompressionStats()).hypertables),
        aggregates: () => run(aggregates, async () => (await adminAPI.getContinuousAggregates()).aggregates),
        slow: () => run(slow, () => adminAPI.getSlowQueries()),
        ingestion: () => run(ingestion, () => adminAPI.getIngestionHealth()),
    };

    async function loadAll(manual = false) {
        if (manual) manualRefreshing = true;
        await Promise.allSettled(Object.values(loaders).map((l) => l()));
        updatedAt = Date.now();
        manualRefreshing = false;
    }

    onMount(() => {
        loadAll();
        refreshTimer = setInterval(() => loadAll(), 60000);
        tickTimer = setInterval(() => (now = Date.now()), 1000);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
        if (tickTimer) clearInterval(tickTimer);
    });

    const updatedLabel = $derived(
        updatedAt === null ? null : formatUpdatedAgo((now - updatedAt) / 1000),
    );

    const isClickHouse = $derived(health.data?.storageEngine === "clickhouse");
    const isMongoDB = $derived(health.data?.storageEngine === "mongodb");
    const isTimescale = $derived(!isClickHouse && !isMongoDB);
    const engineLabel = $derived(isMongoDB ? "MongoDB" : isClickHouse ? "ClickHouse" : "TimescaleDB");
    const engineBrandSlug = $derived(engineBrand(health.data?.storageEngine ?? "timescale"));

    const totalSpaceSaved = $derived(
        (compression.data ?? []).reduce((sum, h) => sum + h.spaceSavedBytes, 0),
    );

    const TEXT: Record<"ok" | "warn" | "bad", string> = {
        ok: "text-success-text",
        warn: "text-warning-text",
        bad: "text-destructive-text",
    };

    function statusText(status: string | undefined): string {
        return stateTone(healthState(status).state).text;
    }

    function ms(n: number | undefined | null): string {
        return typeof n === "number" && n >= 0 ? `${formatCount(n)}ms` : "-";
    }

    // --- Tables ---
    const asCell = <T,>(snippet: unknown) => snippet as DataTableColumn<T>["cell"];

    type TableRow = { id: string; name: string; rows: number; size: string; indexes: string };
    let tableSort = $state<DataTableSort | undefined>({ key: "size", dir: "desc" });
    const tableRows = $derived.by<TableRow[]>(() => {
        const rows = (db.data?.tables ?? []).map((t) => ({
            id: t.name,
            name: t.name,
            rows: t.rows,
            size: t.size,
            indexes: t.indexes_size,
        }));
        return sortRows(rows, tableSort, {
            name: (r) => r.name,
            rows: (r) => r.rows,
            size: (r) => parseSizeToBytes(r.size),
            indexes: (r) => parseSizeToBytes(r.indexes),
        });
    });

    type ActiveRow = SlowQueriesStats["activeQueries"][number] & { id: string };
    let activeSort = $state<DataTableSort | undefined>({ key: "duration", dir: "desc" });
    const activeRows = $derived.by<ActiveRow[]>(() => {
        const rows = (slow.data?.activeQueries ?? []).map((q) => ({ ...q, id: String(q.pid) }));
        return sortRows(rows, activeSort, {
            pid: (r) => r.pid,
            duration: (r) => r.durationMs,
            state: (r) => r.state,
        });
    });

    type HistRow = SlowQueriesStats["topSlowQueries"][number] & { id: string };
    let histSort = $state<DataTableSort | undefined>({ key: "total", dir: "desc" });
    const histRows = $derived.by<HistRow[]>(() => {
        const rows = (slow.data?.topSlowQueries ?? []).map((q, i) => ({ ...q, id: `${i}` }));
        return sortRows(rows, histSort, {
            calls: (r) => r.calls,
            avg: (r) => r.avg_ms,
            total: (r) => r.total_ms,
            rowsPerCall: (r) => r.rows_per_call,
        });
    });

    const tableColumns = $derived<DataTableColumn<TableRow>[]>([
        { key: "name", header: "Table", sortable: true, cell: asCell(nameCell) },
        { key: "rows", header: "Rows", sortable: true, class: "text-right", cell: asCell(rowsCell) },
        { key: "size", header: "Size", sortable: true, class: "text-right", cell: asCell(sizeCell) },
        { key: "indexes", header: "Index size", sortable: true, class: "text-right", cell: asCell(indexCell) },
    ]);

    const activeColumns = $derived<DataTableColumn<ActiveRow>[]>([
        { key: "pid", header: "PID", sortable: true, class: "w-[70px]", cell: asCell(pidCell) },
        { key: "query", header: "Query", cell: asCell(activeQueryCell) },
        { key: "duration", header: "Duration", sortable: true, class: "w-[100px] text-right", cell: asCell(durationCell) },
        { key: "state", header: "State", sortable: true, class: "w-[100px]", cell: asCell(stateCell) },
        { key: "wait", header: "Wait event", class: "w-[130px]", cell: asCell(waitCell) },
    ]);

    const histColumns = $derived<DataTableColumn<HistRow>[]>([
        { key: "query", header: "Query", cell: asCell(histQueryCell) },
        { key: "calls", header: "Calls", sortable: true, class: "w-[90px] text-right", cell: asCell(callsCell) },
        { key: "avg", header: "Avg", sortable: true, class: "w-[100px] text-right", cell: asCell(avgCell) },
        { key: "total", header: "Total", sortable: true, class: "w-[100px] text-right", cell: asCell(totalCell) },
        { key: "rowsPerCall", header: "Rows per call", sortable: true, class: "w-[110px] text-right", cell: asCell(rowsPerCallCell) },
    ]);

    // --- Ingestion health ---
    const COUNTERS: Array<{ key: keyof IngestionHealthStats["counters24h"]; label: string; help: string }> = [
        { key: "timestampSkew", label: "Log timestamp skew", help: "Logs whose timestamp was far from server time (clock drift or replayed data), so the event time was clamped." },
        { key: "spanTimestampSkew", label: "Span timestamp skew", help: "Same as above, for trace spans." },
        { key: "metricTimestampSkew", label: "Metric timestamp skew", help: "Same as above, for metric points." },
        { key: "piiRejected", label: "PII rejected", help: "Entries rejected because they matched a PII rule configured to reject." },
        { key: "detectionEnqueueFailed", label: "Detection enqueue failed", help: "Logs stored but not queued for Sigma detection." },
        { key: "exceptionEnqueueFailed", label: "Exception enqueue failed", help: "Logs stored but not queued for error grouping." },
        { key: "identifierFailed", label: "Identifier extraction failed", help: "Logs stored without extracted identifiers." },
    ];
</script>

<svelte:head>
    <title>System health - LogTide</title>
</svelte:head>

{#snippet kv(label: string, value: string, cls: string = "")}
    <div class="flex items-center justify-between">
        <span class="text-sm text-muted-foreground">{label}</span>
        <span class="font-medium tabular-nums {cls}">{value}</span>
    </div>
{/snippet}

{#snippet nameCell(r: TableRow)}
    {@const isCh = r.name.startsWith("clickhouse.")}
    <span class="font-mono text-sm">{r.name.replace(/^(clickhouse|public)\./, "")}</span>
    {#if isCh}<span class="ml-1 text-xs text-muted-foreground">ClickHouse</span>{/if}
{/snippet}
{#snippet rowsCell(r: TableRow)}<span class="tabular-nums">{formatCount(r.rows)}</span>{/snippet}
{#snippet sizeCell(r: TableRow)}<span class="tabular-nums">{r.size}</span>{/snippet}
{#snippet indexCell(r: TableRow)}<span class="tabular-nums">{r.indexes}</span>{/snippet}

{#snippet pidCell(r: ActiveRow)}<span class="font-mono text-xs">{r.pid}</span>{/snippet}
{#snippet activeQueryCell(r: ActiveRow)}<SystemHealthQueryCell query={r.query} />{/snippet}
{#snippet durationCell(r: ActiveRow)}
    <span class="font-medium tabular-nums {r.durationMs > 5000 ? TEXT.bad : r.durationMs > 1000 ? TEXT.warn : ''}">
        {formatDurationMs(r.durationMs)}
    </span>
{/snippet}
{#snippet stateCell(r: ActiveRow)}<span class="text-xs capitalize">{r.state}</span>{/snippet}
{#snippet waitCell(r: ActiveRow)}<span class="text-xs text-muted-foreground">{r.waitEvent ?? "-"}</span>{/snippet}

{#snippet histQueryCell(r: HistRow)}<SystemHealthQueryCell query={r.query} />{/snippet}
{#snippet callsCell(r: HistRow)}<span class="tabular-nums">{formatCount(r.calls)}</span>{/snippet}
{#snippet avgCell(r: HistRow)}
    <span class="font-medium tabular-nums {r.avg_ms > 100 ? TEXT.bad : r.avg_ms > 10 ? TEXT.warn : ''}">
        {formatDurationMs(r.avg_ms)}
    </span>
{/snippet}
{#snippet totalCell(r: HistRow)}<span class="tabular-nums">{formatDurationMs(r.total_ms)}</span>{/snippet}
{#snippet rowsPerCallCell(r: HistRow)}<span class="tabular-nums">{formatCount(Math.round(r.rows_per_call))}</span>{/snippet}

{#snippet activeMobile(r: ActiveRow)}
    <div class="space-y-1">
        <div class="flex items-center justify-between text-xs">
            <span class="font-mono">PID {r.pid}</span>
            <span class="font-medium tabular-nums">{formatDurationMs(r.durationMs)}</span>
        </div>
        <SystemHealthQueryCell query={r.query} />
        <p class="text-xs capitalize text-muted-foreground">{r.state}{r.waitEvent ? `, waiting on ${r.waitEvent}` : ""}</p>
    </div>
{/snippet}
{#snippet histMobile(r: HistRow)}
    <div class="space-y-1">
        <SystemHealthQueryCell query={r.query} />
        <p class="text-xs text-muted-foreground">
            {formatCount(r.calls)} calls, avg {formatDurationMs(r.avg_ms)}, total {formatDurationMs(r.total_ms)}
        </p>
    </div>
{/snippet}
{#snippet tableMobile(r: TableRow)}
    <div class="space-y-0.5">
        <p class="font-mono text-sm">{r.name.replace(/^(clickhouse|public)\./, "")}</p>
        <p class="text-xs text-muted-foreground">{formatCount(r.rows)} rows, {r.size} (indexes {r.indexes})</p>
    </div>
{/snippet}

<div class="space-y-6">
    <PageHeader
        title="System health"
        appliesTo="instance"
        description={isClickHouse
            ? "PostgreSQL, ClickHouse, compression and infrastructure diagnostics"
            : isMongoDB
              ? "MongoDB and infrastructure diagnostics"
              : "Database, compression, aggregates and infrastructure diagnostics"}
    >
        {#snippet meta()}
            {#if health.data?.storageEngine}
                <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium">
                    {#if engineBrandSlug}<BrandIcon brand={engineBrandSlug} class="size-3.5" />{/if}
                    {engineLabel}
                </span>
            {/if}
        {/snippet}
        {#snippet actions()}
            {#if updatedLabel}
                <span class="text-xs text-muted-foreground">Updated {updatedLabel}</span>
            {/if}
            <Button variant="outline" size="sm" onclick={() => loadAll(true)} disabled={manualRefreshing}>
                <RefreshCw class="mr-1.5 h-3.5 w-3.5 {manualRefreshing ? 'animate-spin' : ''}" aria-hidden="true" />
                Refresh
            </Button>
        {/snippet}
    </PageHeader>

    <SystemHealthBanner overall={health.data?.overall ?? null} loading={health.loading} error={health.error} />

    <!-- Connections -->
    <div class="grid gap-4 md:grid-cols-2 {isTimescale ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}">
        <SystemHealthCard
            title={isClickHouse ? "PostgreSQL" : isMongoDB ? "MongoDB" : "Database"}
            icon={Database}
            loading={health.loading}
            error={health.error}
            hasData={!!health.data}
            onRetry={loaders.health}
        >
            {#if health.data}
                <div class="space-y-3">
                    {@render kv("Status", healthState(health.data.database.status).label, statusText(health.data.database.status))}
                    {@render kv("Latency", ms(health.data.database.latency))}
                    {@render kv("Connections", formatCount(health.data.database.connections))}
                    {#if !isTimescale}
                        <p class="border-t pt-2 text-xs text-muted-foreground">Metadata store</p>
                    {/if}
                </div>
            {/if}
        </SystemHealthCard>

        {#if isClickHouse && health.data?.clickhouse}
            <SystemHealthCard title="ClickHouse" icon={Database} loading={false} hasData={true} onRetry={loaders.health}>
                <div class="space-y-3">
                    {@render kv("Status", healthState(health.data.clickhouse.status).label, statusText(health.data.clickhouse.status))}
                    {@render kv("Latency", ms(health.data.clickhouse.latency))}
                    <p class="border-t pt-2 text-xs text-muted-foreground">Logs storage engine</p>
                </div>
            </SystemHealthCard>
        {/if}

        {#if isMongoDB && health.data?.mongodb}
            <SystemHealthCard title="MongoDB" icon={Database} loading={false} hasData={true} onRetry={loaders.health}>
                <div class="space-y-3">
                    {@render kv("Status", healthState(health.data.mongodb.status).label, statusText(health.data.mongodb.status))}
                    {@render kv("Latency", ms(health.data.mongodb.latency))}
                    <p class="border-t pt-2 text-xs text-muted-foreground">Logs storage engine</p>
                </div>
            </SystemHealthCard>
        {/if}

        <SystemHealthCard
            title="Connection pool"
            icon={Server}
            loading={health.loading}
            error={health.error}
            hasData={!!health.data}
            onRetry={loaders.health}
        >
            {#if health.data}
                <div class="space-y-3">
                    {@render kv("Total", formatCount(health.data.pool.totalConnections))}
                    {@render kv("Idle", formatCount(health.data.pool.idleConnections))}
                    {@render kv("Waiting", formatCount(health.data.pool.waitingRequests), health.data.pool.waitingRequests > 0 ? TEXT.warn : "")}
                </div>
            {/if}
        </SystemHealthCard>

        <SystemHealthCard
            title="Redis"
            icon={Activity}
            loading={redis.loading}
            error={redis.error}
            hasData={!!redis.data || health.data?.redis.status === "not_configured"}
            onRetry={loaders.redis}
        >
            {#if health.data?.redis.status === "not_configured"}
                <p class="text-sm text-muted-foreground">Redis is not configured.</p>
            {:else if redis.data}
                <div class="space-y-3">
                    {@render kv("Status", healthState(health.data?.redis.status).label, statusText(health.data?.redis.status))}
                    {@render kv("Memory", redis.data.memory.used || "-")}
                    {@render kv("Peak memory", redis.data.memory.peak || "-")}
                    {@render kv("Connections", formatCount(redis.data.connections))}
                </div>
            {/if}
        </SystemHealthCard>
    </div>

    <!-- Database tables -->
    <SystemHealthCard
        title="Database tables"
        icon={Layers}
        loading={db.loading}
        error={db.error}
        hasData={!!db.data}
        onRetry={loaders.db}
        skeletonRows={5}
    >
        {#snippet headerExtra()}
            {#if db.data}
                <span class="text-xs text-muted-foreground">
                    Total: <span class="font-medium text-foreground">{db.data.totalSize}</span>
                    ({formatCount(db.data.totalRows)} rows)
                </span>
            {/if}
        {/snippet}
        <DataTable
            columns={tableColumns}
            rows={tableRows}
            rowKey={(r: TableRow) => r.id}
            bind:sort={tableSort}
            mobileRow={asCell<TableRow>(tableMobile)}
        >
            {#snippet empty()}No tables reported{/snippet}
        </DataTable>
    </SystemHealthCard>

    <!-- Compression & aggregates -->
    <div class="grid gap-4 {isTimescale ? 'md:grid-cols-2' : ''}">
        <SystemHealthCard
            title="Compression"
            icon={Layers}
            loading={compression.loading}
            error={compression.error}
            hasData={!!compression.data}
            onRetry={loaders.compression}
        >
            {#snippet headerExtra()}
                {#if totalSpaceSaved > 0}
                    <span class="text-xs font-medium text-success-text">{formatBytes(totalSpaceSaved)} saved</span>
                {/if}
            {/snippet}
            {#if compression.data && compression.data.length > 0}
                <div class="space-y-4">
                    {#each compression.data as ht (ht.hypertable)}
                        <div class="space-y-1.5">
                            <div class="flex items-center justify-between">
                                <span class="font-mono text-sm">{ht.hypertable}</span>
                                <span class="text-sm font-medium text-success-text">
                                    {ht.compressionRatio > 0 ? `${ht.compressionRatio.toFixed(1)}x` : "-"}
                                </span>
                            </div>
                            <div class="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{formatCount(ht.compressedChunks)}/{formatCount(ht.totalChunks)} {isClickHouse ? "parts" : isMongoDB ? "collections" : "chunks"}</span>
                                <span aria-hidden="true">&middot;</span>
                                <span>{formatBytes(ht.spaceSavedBytes)} saved</span>
                            </div>
                            {#if ht.totalChunks > 0}
                                <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div
                                        class="h-full rounded-full bg-success transition-all"
                                        style="width: {Math.round((ht.compressedChunks / ht.totalChunks) * 100)}%"
                                    ></div>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="py-4 text-center text-sm text-muted-foreground">No compression data</p>
            {/if}
        </SystemHealthCard>

        {#if isTimescale}
            <SystemHealthCard
                title="Continuous aggregates"
                icon={Clock}
                loading={aggregates.loading}
                error={aggregates.error}
                hasData={!!aggregates.data}
                onRetry={loaders.aggregates}
            >
                {#if aggregates.data && aggregates.data.length > 0}
                    <div class="space-y-4">
                        {#each aggregates.data as agg (agg.viewName)}
                            {@const st = aggregateStaleness(agg.lastRefresh, now)}
                            <div class="space-y-1">
                                <div class="flex items-center justify-between gap-2">
                                    <span class="font-mono text-sm">{agg.viewName}</span>
                                    <span class="flex items-center gap-1.5 text-xs {TEXT[st.tone]}">
                                        <Clock class="h-3 w-3" aria-hidden="true" />
                                        {st.label}
                                    </span>
                                </div>
                                <p class="text-xs text-muted-foreground">
                                    Refresh every {agg.refreshInterval}, {formatCount(agg.totalRows)} rows
                                </p>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <p class="py-4 text-center text-sm text-muted-foreground">No aggregates found</p>
                {/if}
            </SystemHealthCard>
        {/if}
    </div>

    <!-- Storage & performance -->
    <SystemHealthCard
        title="Storage and performance"
        icon={Activity}
        loading={perf.loading}
        error={perf.error}
        hasData={!!perf.data}
        onRetry={loaders.perf}
    >
        {#if perf.data}
            <div class="grid gap-6 md:grid-cols-2 {isTimescale ? 'lg:grid-cols-4' : ''}">
                {#if isTimescale}
                    <div>
                        <div class="mb-1 text-xs text-muted-foreground">Logs storage</div>
                        <div class="text-lg font-bold">{perf.data.storage.logsSize || "-"}</div>
                    </div>
                    <div>
                        <div class="mb-1 text-xs text-muted-foreground">Compression ratio</div>
                        <div class="text-lg font-bold text-success-text">
                            {perf.data.storage.compressionRatio ? `${perf.data.storage.compressionRatio.toFixed(1)}x` : "-"}
                        </div>
                    </div>
                {/if}
                <div>
                    <div class="mb-1 text-xs text-muted-foreground">Ingestion throughput</div>
                    <div class="text-lg font-bold tabular-nums">{perf.data.ingestion.throughput.toFixed(1)} logs/s</div>
                </div>
                {#if isTimescale}
                    <div>
                        <div class="mb-1 text-xs text-muted-foreground">Average ingestion latency</div>
                        <div class="text-lg font-bold tabular-nums">{ms(Math.round(perf.data.ingestion.avgLatency))}</div>
                    </div>
                {/if}
            </div>
        {/if}
    </SystemHealthCard>

    <!-- Ingestion health -->
    <SystemHealthCard
        title="Ingestion health, last 24 hours"
        icon={ShieldCheck}
        loading={ingestion.loading}
        error={ingestion.error}
        hasData={!!ingestion.data}
        onRetry={loaders.ingestion}
        skeletonRows={4}
    >
        {#if ingestion.data}
            <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {#each COUNTERS as c (c.key)}
                    {@const value = ingestion.data.counters24h[c.key]}
                    <div class="rounded-md border p-3">
                        <dt class="text-xs text-muted-foreground">{c.label}</dt>
                        <dd class="text-lg font-bold tabular-nums {value > 0 ? TEXT.warn : ''}">{formatCount(value)}</dd>
                        <p class="mt-1 text-xs text-muted-foreground">{c.help}</p>
                    </div>
                {/each}
            </dl>
            <div class="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
                <div>
                    <p class="font-medium">IP reputation</p>
                    <p class="text-xs text-muted-foreground">
                        {#if !ingestion.data.enrichment.ipReputation.configured}
                            Not configured
                        {:else if ingestion.data.enrichment.ipReputation.ready}
                            Ready, {formatCount(ingestion.data.enrichment.ipReputation.totalIps)} IPs
                            {#if ingestion.data.enrichment.ipReputation.lastUpdate}
                                , updated <Timestamp value={ingestion.data.enrichment.ipReputation.lastUpdate} />
                            {/if}
                        {:else}
                            Configured, not loaded yet
                        {/if}
                    </p>
                </div>
                <div>
                    <p class="font-medium">GeoIP</p>
                    <p class="text-xs text-muted-foreground">
                        {#if !ingestion.data.enrichment.geoIp.configured}
                            Not configured
                        {:else if ingestion.data.enrichment.geoIp.ready}
                            Ready
                            {#if ingestion.data.enrichment.geoIp.lastUpdate}
                                , updated <Timestamp value={ingestion.data.enrichment.geoIp.lastUpdate} />
                            {/if}
                        {:else}
                            Configured, not loaded yet
                        {/if}
                    </p>
                </div>
            </div>
        {/if}
    </SystemHealthCard>

    <!-- Worker queues -->
    {#if health.data?.redis.status !== "not_configured"}
        <SystemHealthCard
            title="Worker queues"
            icon={Server}
            loading={redis.loading}
            error={redis.error}
            hasData={!!redis.data}
            onRetry={loaders.redis}
            skeletonRows={4}
        >
            {#if redis.data}
                <div class="grid gap-4 md:grid-cols-2">
                    {#each [{ name: "Alert notifications", q: redis.data.queues.alertNotifications }, { name: "Sigma detection", q: redis.data.queues.sigmaDetection }] as item (item.name)}
                        <div class="rounded-md border p-4">
                            <h4 class="mb-3 text-sm font-medium">{item.name}</h4>
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div><div class="text-xs text-muted-foreground">Waiting</div><div class="font-bold tabular-nums">{formatCount(item.q.waiting)}</div></div>
                                <div><div class="text-xs text-muted-foreground">Active</div><div class="font-bold tabular-nums">{formatCount(item.q.active)}</div></div>
                                <div><div class="text-xs text-muted-foreground">Completed</div><div class="font-bold tabular-nums text-success-text">{formatCount(item.q.completed)}</div></div>
                                <div><div class="text-xs text-muted-foreground">Failed</div><div class="font-bold tabular-nums {item.q.failed > 0 ? TEXT.bad : ''}">{formatCount(item.q.failed)}</div></div>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </SystemHealthCard>
    {/if}

    <!-- Active queries (pg_stat_activity) -->
    <SystemHealthCard
        title="Active PostgreSQL queries"
        icon={Zap}
        loading={slow.loading}
        error={slow.error}
        hasData={!!slow.data}
        onRetry={loaders.slow}
        skeletonRows={4}
    >
        {#snippet headerExtra()}
            {#if slow.data}
                <span class="text-xs text-muted-foreground">{formatCount(slow.data.activeQueries.length)} running, from pg_stat_activity</span>
            {/if}
        {/snippet}
        <DataTable
            columns={activeColumns}
            rows={activeRows}
            rowKey={(r: ActiveRow) => r.id}
            bind:sort={activeSort}
            mobileRow={asCell<ActiveRow>(activeMobile)}
        >
            {#snippet empty()}
                <EmptyState variant="no-data" title="No active queries" description="Nothing is running on the PostgreSQL metadata database right now." />
            {/snippet}
        </DataTable>
    </SystemHealthCard>

    <!-- Slowest queries (pg_stat_statements) -->
    {#if slow.data?.pgStatStatementsAvailable}
        <SystemHealthCard
            title="Slowest queries, historical"
            icon={Clock}
            loading={false}
            hasData={true}
            onRetry={loaders.slow}
        >
            {#snippet headerExtra()}
                <span class="text-xs text-muted-foreground">via pg_stat_statements</span>
            {/snippet}
            <DataTable
                columns={histColumns}
                rows={histRows}
                rowKey={(r: HistRow) => r.id}
                bind:sort={histSort}
                mobileRow={asCell<HistRow>(histMobile)}
            >
                {#snippet empty()}No slow query data available{/snippet}
            </DataTable>
        </SystemHealthCard>
    {/if}
</div>
