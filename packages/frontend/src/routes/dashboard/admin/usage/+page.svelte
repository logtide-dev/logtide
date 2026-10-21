<script lang="ts">
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import { onMount, untrack } from 'svelte';
    import { get } from 'svelte/store';
    import { browser } from '$app/environment';
    import { goto } from '$app/navigation';
    import { authStore } from '$lib/stores/auth';
    import { UsersAPI } from '$lib/api/users';
    import { adminAPI, type OrganizationBasic } from '$lib/api/admin';
    import { getUsage, getUsageBreakdown, getStorageUsage, type UsageRecord, type UsageBreakdown, type StorageUsageResponse } from '$lib/api/usage';
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription,
    } from '$lib/components/ui/card';
    import {
        Table,
        TableBody,
        TableCell,
        TableHead,
        TableHeader,
        TableRow,
    } from '$lib/components/ui/table';
    import { Button } from '$lib/components/ui/button';
    import Spinner from '$lib/components/Spinner.svelte';
    import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
    import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
    import Building2 from '@lucide/svelte/icons/building-2';

    // TODO(#214): per-org entitlements editor goes here once feature #214 backend is shipped

    const RANGES = [
        { label: 'Last 7 days', days: 7 },
        { label: 'Last 30 days', days: 30 },
        { label: 'Last 90 days', days: 90 },
    ] as const;

    type RangeDays = (typeof RANGES)[number]['days'];

    let orgs = $state<OrganizationBasic[]>([]);
    let orgsLoading = $state(true);
    let orgsError = $state('');
    let selectedOrgId = $state<string>('');

    let selectedDays = $state<RangeDays>(30);

    let loading = $state(false);
    let error = $state('');

    let byDayEvents = $state<UsageRecord[]>([]);
    let byDayBytes = $state<UsageRecord[]>([]);
    let breakdown = $state<UsageBreakdown | null>(null);
    let storage = $state<StorageUsageResponse | null>(null);

    const usersAPI = new UsersAPI(() => get(authStore).token);

    onMount(() => {
        if ($authStore.user?.is_admin) loadOrgs();
    });

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
                                if (user.is_admin) loadOrgs();
                            }
                        })
                        .catch(() => goto('/dashboard'));
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => goto('/dashboard'));
            }
        }
    });

    async function loadOrgs() {
        if ($authStore.user?.is_admin !== true) return;

        orgsLoading = true;
        orgsError = '';
        try {
            const res = await adminAPI.getOrganizations(1, 200);
            orgs = res.organizations;
            if (orgs.length > 0) {
                selectedOrgId = orgs[0].id;
            }
        } catch (e) {
            orgsError = e instanceof Error ? e.message : 'Failed to load organizations';
        } finally {
            orgsLoading = false;
        }
    }

    $effect(() => {
        if (selectedOrgId) {
            // Depend on selectedDays so re-runs when range changes too
            storage = null;
            void load(selectedOrgId, selectedDays);
        }
    });

    async function load(orgId: string, days: number) {
        if (!orgId) return;
        loading = true;
        error = '';
        storage = null;
        try {
            const to = new Date().toISOString();
            const from = new Date(Date.now() - days * 86_400_000).toISOString();

            const [dayEvt, dayByt, bd, stor] = await Promise.all([
                getUsage({ organizationId: orgId, from, to, groupBy: 'day', type: 'logs.ingested.events' }),
                getUsage({ organizationId: orgId, from, to, groupBy: 'day', type: 'logs.ingested.bytes' }),
                getUsageBreakdown({ organizationId: orgId, from, to }),
                getStorageUsage({ organizationId: orgId, from, to }).catch(() => null),
            ]);

            byDayEvents = dayEvt.usage;
            byDayBytes = dayByt.usage;
            breakdown = bd.breakdown;
            storage = stor;
        } catch (e) {
            error = e instanceof Error ? e.message : 'Failed to load usage data';
        } finally {
            loading = false;
        }
    }

    let totalEvents = $derived(byDayEvents.reduce((s, r) => s + r.quantity, 0));
    let totalBytes = $derived(byDayBytes.reduce((s, r) => s + r.quantity, 0));

    interface DayRow { date: string; events: number; bytes: number; }

    let dailyRows = $derived.by<DayRow[]>(() => {
        const map = new Map<string, DayRow>();
        for (const r of byDayEvents) {
            const d = r.bucket ?? '';
            if (!map.has(d)) map.set(d, { date: d, events: 0, bytes: 0 });
            map.get(d)!.events += r.quantity;
        }
        for (const r of byDayBytes) {
            const d = r.bucket ?? '';
            if (!map.has(d)) map.set(d, { date: d, events: 0, bytes: 0 });
            map.get(d)!.bytes += r.quantity;
        }
        return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
    });

    function formatBytes(n: number): string {
        if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
        if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(2)} MB`;
        if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
        return `${n} B`;
    }

    function formatCount(n: number): string {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
        return n.toLocaleString('en-US');
    }

    function formatDate(iso: string): string {
        if (!iso) return '';
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatTypeQty(type: string, qty: number): string {
        return type.endsWith('.bytes') ? formatBytes(qty) : formatCount(qty);
    }

    let selectedOrgName = $derived(orgs.find((o) => o.id === selectedOrgId)?.name ?? '');
</script>

<svelte:head>
    <title>Instance usage - LogTide</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        title="Instance usage"
        appliesTo="instance"
        description="Metering data per organization"
    />

    {#if orgsLoading}
        <div class="flex justify-center py-12">
            <Spinner />
        </div>
    {:else if orgsError}
        <p class="text-sm text-destructive">{orgsError}</p>
    {:else if orgs.length === 0}
        <Card>
            <CardContent class="py-12 text-center">
                <Building2 class="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p class="mt-3 text-sm text-muted-foreground">No organizations found.</p>
            </CardContent>
        </Card>
    {:else}
        <!-- Controls -->
        <div class="flex flex-wrap items-center gap-3">
            <!-- Org selector -->
            <div class="space-y-1">
                <label for="org-select" class="text-xs font-medium text-muted-foreground">Organization</label>
                <select
                    id="org-select"
                    bind:value={selectedOrgId}
                    class="flex h-9 w-64 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    {#each orgs as org (org.id)}
                        <option value={org.id}>{org.name}</option>
                    {/each}
                </select>
            </div>

            <!-- Range selector -->
            <div class="space-y-1">
                <span class="text-xs font-medium text-muted-foreground">Range</span>
                <div class="flex items-center gap-1 rounded-md border p-1 bg-muted/50">
                    {#each RANGES as range}
                        <button
                            type="button"
                            onclick={() => { selectedDays = range.days; }}
                            class="px-3 py-1 rounded text-sm font-medium transition-colors {selectedDays === range.days
                                ? 'bg-background shadow-sm text-foreground'
                                : 'text-muted-foreground hover:text-foreground'}"
                        >
                            {range.label}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="self-end">
                <Button variant="outline" size="sm" onclick={() => load(selectedOrgId, selectedDays)} disabled={loading}>
                    <RotateCcw class="h-4 w-4 mr-1.5 {loading ? 'animate-spin' : ''}" />
                    Refresh
                </Button>
            </div>
        </div>

        {#if error}
            <p class="text-sm text-destructive">{error}</p>
        {/if}

        <!-- Summary cards -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Events ingested</CardTitle>
                    <BarChart3 class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    {#if loading}
                        <Spinner size="sm" />
                    {:else}
                        <div class="text-2xl font-bold">{formatCount(totalEvents)}</div>
                        <p class="text-xs text-muted-foreground mt-1">
                            {selectedOrgName}
                            &middot; {RANGES.find((r) => r.days === selectedDays)?.label ?? ''}
                        </p>
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Bytes ingested</CardTitle>
                    <BarChart3 class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    {#if loading}
                        <Spinner size="sm" />
                    {:else}
                        <div class="text-2xl font-bold">{formatBytes(totalBytes)}</div>
                        <p class="text-xs text-muted-foreground mt-1">
                            {selectedOrgName}
                            &middot; {RANGES.find((r) => r.days === selectedDays)?.label ?? ''}
                        </p>
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle class="text-sm font-medium">Current storage (estimated)</CardTitle>
                    <BarChart3 class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    {#if loading}
                        <Spinner size="sm" />
                    {:else}
                        <div class="text-2xl font-bold">{storage ? formatBytes(storage.current) : '-'}</div>
                        <p class="text-xs text-muted-foreground mt-1">
                            Logical bytes within retention · daily snapshot
                        </p>
                    {/if}
                </CardContent>
            </Card>
        </div>

        <!-- Storage trend -->
        <Card>
            <CardHeader class="pb-3">
                <CardTitle class="text-base">Storage trend (estimated)</CardTitle>
                <CardDescription>Daily storage snapshot within retention window</CardDescription>
            </CardHeader>
            <CardContent class="p-0">
                {#if loading}
                    <div class="flex justify-center py-10"><Spinner /></div>
                {:else if !storage || storage.series.length === 0}
                    <div class="py-12 text-center">
                        <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p class="mt-3 text-sm text-muted-foreground">No storage data for this period.</p>
                    </div>
                {:else}
                    <div class="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead class="text-right">Storage</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {#each [...storage.series].sort((a, b) => b.bucket.localeCompare(a.bucket)) as row (row.bucket)}
                                    <TableRow>
                                        <TableCell class="text-sm">{formatDate(row.bucket)}</TableCell>
                                        <TableCell class="text-right font-mono text-sm">{formatBytes(row.quantity)}</TableCell>
                                    </TableRow>
                                {/each}
                            </TableBody>
                        </Table>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- By event type (metering signal) -->
        <Card>
            <CardHeader class="pb-3">
                <CardTitle class="text-base">By event type</CardTitle>
                <CardDescription>Volume per ingested signal type</CardDescription>
            </CardHeader>
            <CardContent class="p-0">
                {#if loading}
                    <div class="flex justify-center py-10"><Spinner /></div>
                {:else if !breakdown || breakdown.byType.length === 0}
                    <div class="py-12 text-center">
                        <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p class="mt-3 text-sm text-muted-foreground">No data for this period.</p>
                    </div>
                {:else}
                    <div class="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead class="text-right">Quantity</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {#each breakdown.byType as row (row.type)}
                                    <TableRow>
                                        <TableCell class="font-mono text-sm">{row.type}</TableCell>
                                        <TableCell class="text-right font-mono text-sm">{formatTypeQty(row.type, row.quantity)}</TableCell>
                                    </TableRow>
                                {/each}
                            </TableBody>
                        </Table>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- Daily breakdown -->
        <Card>
            <CardHeader class="pb-3">
                <CardTitle class="text-base">Daily breakdown</CardTitle>
                <CardDescription>Ingestion per day for {selectedOrgName}</CardDescription>
            </CardHeader>
            <CardContent class="p-0">
                {#if loading}
                    <div class="flex justify-center py-10">
                        <Spinner />
                    </div>
                {:else if dailyRows.length === 0}
                    <div class="py-12 text-center">
                        <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p class="mt-3 text-sm text-muted-foreground">No usage data for this period.</p>
                    </div>
                {:else}
                    <div class="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead class="text-right">Events</TableHead>
                                    <TableHead class="text-right">Bytes</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {#each dailyRows as row (row.date)}
                                    <TableRow>
                                        <TableCell class="text-sm">{formatDate(row.date)}</TableCell>
                                        <TableCell class="text-right font-mono text-sm">{formatCount(row.events)}</TableCell>
                                        <TableCell class="text-right font-mono text-sm">{formatBytes(row.bytes)}</TableCell>
                                    </TableRow>
                                {/each}
                            </TableBody>
                        </Table>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- By project (with name) -->
        <Card>
            <CardHeader class="pb-3">
                <CardTitle class="text-base">Breakdown by project</CardTitle>
                <CardDescription>Ingestion totals per project for {selectedOrgName}</CardDescription>
            </CardHeader>
            <CardContent class="p-0">
                {#if loading}
                    <div class="flex justify-center py-10">
                        <Spinner />
                    </div>
                {:else if !breakdown || breakdown.byProject.length === 0}
                    <div class="py-12 text-center">
                        <BarChart3 class="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p class="mt-3 text-sm text-muted-foreground">No project data for this period.</p>
                    </div>
                {:else}
                    <div class="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Project</TableHead>
                                    <TableHead class="text-right">Events</TableHead>
                                    <TableHead class="text-right">Bytes</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {#each breakdown.byProject as row (row.projectId)}
                                    <TableRow>
                                        <TableCell class="text-sm">{row.projectName}</TableCell>
                                        <TableCell class="text-right font-mono text-sm">{formatCount(row.events)}</TableCell>
                                        <TableCell class="text-right font-mono text-sm">{formatBytes(row.bytes)}</TableCell>
                                    </TableRow>
                                {/each}
                            </TableBody>
                        </Table>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- By service / by level -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
                <CardHeader class="pb-3">
                    <CardTitle class="text-base">By service</CardTitle>
                    <CardDescription>Which services produced the logs</CardDescription>
                </CardHeader>
                <CardContent class="p-0">
                    {#if loading}
                        <div class="flex justify-center py-10"><Spinner /></div>
                    {:else if !breakdown || breakdown.byService.length === 0}
                        <div class="py-12 text-center">
                            <p class="text-sm text-muted-foreground">No data for this period.</p>
                        </div>
                    {:else}
                        <div class="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Service</TableHead>
                                        <TableHead class="text-right">Events</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {#each breakdown.byService as row (row.value)}
                                        <TableRow>
                                            <TableCell class="text-sm">{row.value}</TableCell>
                                            <TableCell class="text-right font-mono text-sm">{formatCount(row.count)}</TableCell>
                                        </TableRow>
                                    {/each}
                                </TableBody>
                            </Table>
                        </div>
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader class="pb-3">
                    <CardTitle class="text-base">By level</CardTitle>
                    <CardDescription>Log level distribution</CardDescription>
                </CardHeader>
                <CardContent class="p-0">
                    {#if loading}
                        <div class="flex justify-center py-10"><Spinner /></div>
                    {:else if !breakdown || breakdown.byLevel.length === 0}
                        <div class="py-12 text-center">
                            <p class="text-sm text-muted-foreground">No data for this period.</p>
                        </div>
                    {:else}
                        <div class="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Level</TableHead>
                                        <TableHead class="text-right">Events</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {#each breakdown.byLevel as row (row.value)}
                                        <TableRow>
                                            <TableCell class="text-sm capitalize">{row.value}</TableCell>
                                            <TableCell class="text-right font-mono text-sm">{formatCount(row.count)}</TableCell>
                                        </TableRow>
                                    {/each}
                                </TableBody>
                            </Table>
                        </div>
                    {/if}
                </CardContent>
            </Card>
        </div>
    {/if}
</div>
