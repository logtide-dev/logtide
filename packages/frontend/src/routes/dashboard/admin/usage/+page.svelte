<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { adminAPI } from "$lib/api/admin";
    import {
        getUsage,
        getUsageBreakdown,
        getStorageUsage,
        type UsageRecord,
        type UsageBreakdown,
        type StorageUsageResponse,
    } from "$lib/api/usage";
    import { authStore } from "$lib/stores/auth";
    import { toastStore } from "$lib/stores/toast";
    import { formatDateShort } from "$lib/utils/datetime";
    import { formatBytes, formatCount } from "$lib/utils/format-number";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import StatsCard from "$lib/components/dashboard/StatsCard.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import { Card } from "$lib/components/ui/card";
    import BarChart3 from "@lucide/svelte/icons/bar-chart-3";
    import HardDrive from "@lucide/svelte/icons/hard-drive";
    import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
    import { levelLabel } from "$lib/utils/severity";
    import UsageOrgPicker, { type PickedOrg } from "$lib/components/admin/UsageOrgPicker.svelte";
    import UsageTable, { type UsageTableRow } from "$lib/components/admin/UsageTable.svelte";
    import { createLatestGuard } from "$lib/components/admin/latest-request";
    import { isBytesMetric, metricLabel } from "$lib/components/admin/admin-labels";
    import { mergeDaily, sumQuantity } from "$lib/components/admin/usage-data";

    const asSnippet = (s: unknown) => s as Snippet;

    const RANGES = [
        { label: "Last 7 days", days: 7 },
        { label: "Last 30 days", days: 30 },
        { label: "Last 90 days", days: 90 },
    ] as const;

    type RangeDays = (typeof RANGES)[number]["days"];

    const urlOrg = page.url?.searchParams?.get("org") ?? "";
    const urlDays = Number(page.url?.searchParams?.get("days"));
    const initialDays = (RANGES.find((r) => r.days === urlDays)?.days ?? 30) as RangeDays;

    // No organization is picked for the admin: the page waits for an explicit choice
    // (or an org id in the URL) instead of silently showing the first one.
    let selectedOrg = $state<PickedOrg | null>(null);
    let selectedDays = $state<RangeDays>(initialDays);

    let loading = $state(false);
    let error = $state("");

    let byDayEvents = $state<UsageRecord[]>([]);
    let byDayBytes = $state<UsageRecord[]>([]);
    let breakdown = $state<UsageBreakdown | null>(null);
    let storage = $state<StorageUsageResponse | null>(null);
    let storageFailed = $state(false);
    let hasData = $state(false);

    const guard = createLatestGuard();

    const rangeLabel = $derived(RANGES.find((r) => r.days === selectedDays)?.label ?? "");
    const totalEvents = $derived(sumQuantity(byDayEvents));
    const totalBytes = $derived(sumQuantity(byDayBytes));
    const dailyRows = $derived(mergeDaily(byDayEvents, byDayBytes));

    function clearData() {
        byDayEvents = [];
        byDayBytes = [];
        breakdown = null;
        storage = null;
        storageFailed = false;
        hasData = false;
    }

    async function load(org: PickedOrg, days: number) {
        const ticket = guard.begin();
        loading = true;
        error = "";
        try {
            const to = new Date().toISOString();
            const from = new Date(Date.now() - days * 86_400_000).toISOString();
            const orgId = org.id;

            const [dayEvt, dayByt, bd, stor] = await Promise.all([
                getUsage({ organizationId: orgId, from, to, groupBy: "day", type: "logs.ingested.events" }),
                getUsage({ organizationId: orgId, from, to, groupBy: "day", type: "logs.ingested.bytes" }),
                getUsageBreakdown({ organizationId: orgId, from, to }),
                getStorageUsage({ organizationId: orgId, from, to }).then(
                    (r) => ({ ok: true as const, value: r }),
                    () => ({ ok: false as const, value: null }),
                ),
            ]);
            // A newer request (another org or range) owns the page now.
            if (!guard.isCurrent(ticket)) return;

            byDayEvents = dayEvt.usage;
            byDayBytes = dayByt.usage;
            breakdown = bd.breakdown;
            storage = stor.value;
            storageFailed = !stor.ok;
            hasData = true;
        } catch (e) {
            if (!guard.isCurrent(ticket)) return;
            clearData();
            error = e instanceof Error ? e.message : "Failed to load usage data";
            toastStore.error(error);
        } finally {
            if (guard.isCurrent(ticket)) loading = false;
        }
    }

    function syncUrl(org: PickedOrg | null, days: number) {
        const params = new URLSearchParams();
        if (org) params.set("org", org.id);
        if (days !== 30) params.set("days", String(days));
        const qs = params.toString();
        const next = `${page.url?.pathname ?? "/dashboard/admin/usage"}${qs ? `?${qs}` : ""}`;
        if (qs !== (page.url?.search ?? "").replace(/^\?/, "")) {
            goto(next, { replaceState: true, keepFocus: true, noScroll: true });
        }
    }

    function onPick(org: PickedOrg) {
        if (org.id === selectedOrg?.id) return;
        // Show nothing from the previous organization while the new one loads.
        clearData();
        selectedOrg = org;
    }

    function setDays(days: RangeDays) {
        selectedDays = days;
    }

    // Resolve the organization named in the URL (shared link / reload).
    $effect(() => {
        if ($authStore.user?.is_admin !== true || !urlOrg) return;
        untrack(async () => {
            try {
                const o = await adminAPI.getOrganizationDetails(urlOrg);
                if (!selectedOrg) selectedOrg = { id: o.id, name: o.name, slug: o.slug };
            } catch (e) {
                toastStore.error(e instanceof Error ? e.message : "Organization not found");
            }
        });
    });

    $effect(() => {
        const org = selectedOrg;
        const days = selectedDays;
        if ($authStore.user?.is_admin !== true) return;
        untrack(() => syncUrl(org, days));
        if (org) untrack(() => void load(org, days));
        else guard.cancel();
    });

    function refresh() {
        if (selectedOrg) void load(selectedOrg, selectedDays);
    }

    const initialLoading = $derived(loading && !hasData);

    const typeRows = $derived<UsageTableRow[]>(
        (breakdown?.byType ?? []).map((r) => ({
            key: r.type,
            cells: [
                { text: metricLabel(r.type), sub: r.type },
                isBytesMetric(r.type) ? formatBytes(r.quantity) : formatCount(r.quantity),
            ],
        })),
    );
    const dailyTableRows = $derived<UsageTableRow[]>(
        dailyRows.map((r) => ({
            key: r.date,
            cells: [formatDateShort(r.date), formatCount(r.events), formatBytes(r.bytes)],
        })),
    );
    const projectRows = $derived<UsageTableRow[]>(
        (breakdown?.byProject ?? []).map((r) => ({
            key: r.projectId,
            cells: [r.projectName, formatCount(r.events), formatBytes(r.bytes)],
        })),
    );
    const serviceRows = $derived<UsageTableRow[]>(
        (breakdown?.byService ?? []).map((r) => ({ key: r.value, cells: [r.value, formatCount(r.count)] })),
    );
    const levelRows = $derived<UsageTableRow[]>(
        (breakdown?.byLevel ?? []).map((r) => ({ key: r.value, cells: [levelLabel(r.value), formatCount(r.count)] })),
    );
    const snapshotRows = $derived<UsageTableRow[]>(
        [...(storage?.series ?? [])]
            .sort((a, b) => b.bucket.localeCompare(a.bucket))
            .map((r) => ({ key: r.bucket, cells: [formatDateShort(r.bucket), formatBytes(r.quantity)] })),
    );
</script>

<svelte:head>
    <title>Instance usage - LogTide</title>
</svelte:head>

{#snippet section(title: string, description: string, body: Snippet)}
    <section class="space-y-2">
        <div>
            <h2 class="text-base font-semibold">{title}</h2>
            <p class="text-sm text-muted-foreground">{description}</p>
        </div>
        <Card class="overflow-x-auto p-0">
            {@render body()}
        </Card>
    </section>
{/snippet}

<div class="space-y-6">
    <PageHeader
        title="Instance usage"
        appliesTo="instance"
        description="Metering data for one organization at a time"
    />

    <div class="flex flex-wrap items-end gap-3">
        <div class="space-y-1">
            <label for="usage-org-picker" class="text-xs font-medium text-muted-foreground">Organization</label>
            <UsageOrgPicker selected={selectedOrg} onSelect={onPick} />
        </div>

        <div class="space-y-1">
            <span class="text-xs font-medium text-muted-foreground" id="usage-range-label">Range</span>
            <div class="flex items-center gap-1 rounded-md border bg-muted/50 p-1" role="group" aria-labelledby="usage-range-label">
                {#each RANGES as range (range.days)}
                    <button
                        type="button"
                        aria-pressed={selectedDays === range.days}
                        onclick={() => setDays(range.days)}
                        class="rounded px-3 py-1 text-sm font-medium transition-colors {selectedDays === range.days
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'}"
                    >
                        {range.label}
                    </button>
                {/each}
            </div>
        </div>

        <Button variant="outline" size="sm" onclick={refresh} disabled={loading || !selectedOrg}>
            <RotateCcw class="mr-1.5 h-4 w-4 {loading ? 'animate-spin' : ''}" />
            Refresh
        </Button>
    </div>

    {#if !selectedOrg}
        <EmptyState
            variant="setup"
            title="Select an organization"
            description="Pick an organization above to see how much it ingested and how much it stores."
        />
    {:else if error}
        <EmptyState variant="error" title="Could not load usage" description={error}>
            {#snippet actions()}
                <Button onclick={refresh}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else}
        <div class="space-y-6 {loading && hasData ? 'opacity-60 transition-opacity' : ''}" aria-busy={loading}>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {#if initialLoading}
                    <Skeleton class="h-28 w-full" />
                    <Skeleton class="h-28 w-full" />
                {:else}
                    <StatsCard
                        title="Events ingested"
                        value={formatCount(totalEvents)}
                        icon={BarChart3}
                        description="{selectedOrg.name}, {rangeLabel.toLowerCase()}"
                    />
                    <StatsCard
                        title="Bytes ingested"
                        value={formatBytes(totalBytes)}
                        icon={BarChart3}
                        description="{selectedOrg.name}, {rangeLabel.toLowerCase()}"
                    />
                {/if}
            </div>

            {#snippet typeBody()}
                <UsageTable
                    headers={[{ label: "Signal" }, { label: "Quantity", align: "right" }]}
                    rows={typeRows}
                    loading={initialLoading}
                />
            {/snippet}
            {@render section("By signal", `Volume per metered signal, ${rangeLabel.toLowerCase()}`, asSnippet(typeBody))}

            {#snippet dailyBody()}
                <UsageTable
                    headers={[{ label: "Date" }, { label: "Events", align: "right" }, { label: "Bytes", align: "right" }]}
                    rows={dailyTableRows}
                    loading={initialLoading}
                    empty="No usage data for this period."
                />
            {/snippet}
            {@render section("Daily breakdown", `Ingestion per day for ${selectedOrg.name}`, asSnippet(dailyBody))}

            {#snippet projectBody()}
                <UsageTable
                    headers={[{ label: "Project" }, { label: "Events", align: "right" }, { label: "Bytes", align: "right" }]}
                    rows={projectRows}
                    loading={initialLoading}
                    empty="No project data for this period."
                />
            {/snippet}
            {@render section("By project", `Ingestion totals per project, ${rangeLabel.toLowerCase()}`, asSnippet(projectBody))}

            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {#snippet serviceBody()}
                    <UsageTable
                        headers={[{ label: "Service" }, { label: "Events", align: "right" }]}
                        rows={serviceRows}
                        loading={initialLoading}
                    />
                {/snippet}
                {@render section("By service", "Which services produced the logs", asSnippet(serviceBody))}

                {#snippet levelBody()}
                    <UsageTable
                        headers={[{ label: "Level" }, { label: "Events", align: "right" }]}
                        rows={levelRows}
                        loading={initialLoading}
                    />
                {/snippet}
                {@render section("By level", "Log level distribution", asSnippet(levelBody))}
            </div>

            <!-- The storage numbers are a point-in-time estimate, so they sit apart from the range-based sections. -->
            <section
                class="space-y-4 rounded-lg border border-dashed border-border bg-muted/30 p-4 sm:p-6"
                aria-labelledby="usage-storage-heading"
                data-testid="usage-storage"
            >
                <div class="flex items-start gap-3">
                    <HardDrive class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div>
                        <h2 id="usage-storage-heading" class="text-base font-semibold">Current storage</h2>
                        <p class="text-sm text-muted-foreground">
                            Current snapshot, not tied to the range above. An estimate of the logical bytes held within retention, refreshed daily.
                        </p>
                    </div>
                </div>
                {#if initialLoading}
                    <Skeleton class="h-10 w-40" />
                {:else if storageFailed}
                    <p class="text-sm text-muted-foreground">Storage data could not be loaded.</p>
                {:else}
                    <p class="text-3xl font-semibold tabular-nums">{formatBytes(storage?.current ?? null)}</p>
                    <div class="space-y-2">
                        <h3 class="text-sm font-medium">Daily snapshots in the selected range</h3>
                        <Card class="overflow-x-auto p-0">
                            <UsageTable
                                headers={[{ label: "Date" }, { label: "Storage", align: "right" }]}
                                rows={snapshotRows}
                                empty="No storage snapshots for this period."
                            />
                        </Card>
                    </div>
                {/if}
            </section>
        </div>
    {/if}
</div>
