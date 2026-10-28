<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { goto } from "$app/navigation";
    import { page as appPage } from "$app/state";
    import { adminAPI, type OrganizationBasic } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import { toastStore } from "$lib/stores/toast";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import DataTable from "$lib/components/app/DataTable.svelte";
    import type { DataTableColumn, DataTableSort } from "$lib/components/app/data-table";
    import Pagination from "$lib/components/app/Pagination.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import Timestamp from "$lib/components/app/Timestamp.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { formatCount } from "$lib/utils/format-number";
    import { createLatestGuard } from "$lib/components/admin/latest-request";
    import {
        buildOrgListSearch,
        parseOrgListParams,
        sortToApi,
        type OrgListParams,
    } from "$lib/components/admin/org-list-params";

    // The list API also returns the owner; the shared client type predates it.
    type OrgRow = OrganizationBasic;

    const PAGE_SIZE = 50;
    const SEARCH_DEBOUNCE_MS = 300;

    const initial = parseOrgListParams(new URLSearchParams(appPage.url?.search ?? ""));

    let organizations = $state<OrgRow[]>([]);
    let total = $state(0);
    let loading = $state(true);
    let error = $state("");
    let hasLoaded = $state(false);

    // The input text; `applied` is what the list is actually loaded with.
    let searchText = $state(initial.q);
    let sort = $state<DataTableSort | undefined>(initial.sort);
    let applied = $state<OrgListParams>(initial);

    const guard = createLatestGuard();

    // Debounced search: a new query goes back to the first page.
    $effect(() => {
        const next = searchText.trim();
        const timer = setTimeout(() => {
            if (next !== untrack(() => applied.q)) {
                applied = { ...untrack(() => applied), q: next, page: 1 };
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    });

    // Sortable headers drive the server-side sort.
    $effect(() => {
        const s = sort;
        const cur = untrack(() => applied);
        if (s && (s.key !== cur.sort.key || s.dir !== cur.sort.dir)) {
            applied = { ...cur, sort: s, page: 1 };
        }
    });

    // Keep q, page, sort and order in the URL without piling up history.
    $effect(() => {
        const search = buildOrgListSearch(applied);
        untrack(() => {
            const current = appPage.url?.search ?? "";
            if (search !== current) {
                goto(`${appPage.url?.pathname ?? "/dashboard/admin/organizations"}${search}`, {
                    replaceState: true,
                    keepFocus: true,
                    noScroll: true,
                });
            }
        });
    });

    // Load whenever the applied query changes (and once the admin check passes).
    $effect(() => {
        if ($authStore.user?.is_admin !== true) return;
        const params = applied;
        untrack(() => void load(params));
    });

    async function load(params: OrgListParams) {
        const ticket = guard.begin();
        loading = true;
        error = "";
        try {
            const res = await adminAPI.getOrganizations({
                page: params.page,
                limit: PAGE_SIZE,
                search: params.q || undefined,
                ...sortToApi(params.sort),
            });
            if (!guard.isCurrent(ticket)) return;
            organizations = res.organizations;
            total = res.total;
            hasLoaded = true;
        } catch (err) {
            if (!guard.isCurrent(ticket)) return;
            error = err instanceof Error ? err.message : "Failed to load organizations";
            toastStore.error(error);
        } finally {
            if (guard.isCurrent(ticket)) loading = false;
        }
    }

    function retry() {
        void load(applied);
    }

    function clearSearch() {
        searchText = "";
    }

    function changePage(next: number) {
        applied = { ...applied, page: next };
    }

    const showInitialSkeleton = $derived(loading && !hasLoaded);
    const showError = $derived(!!error && organizations.length === 0);
    const isSearching = $derived(applied.q.length > 0);

    const asCell = (s: unknown) => s as Snippet<[OrgRow]>;

    const columns: DataTableColumn<OrgRow>[] = [
        { key: "name", header: "Organization", sortable: true, class: "min-w-[12rem] max-w-[22rem]", cell: asCell(nameCell) },
        { key: "owner", header: "Owner", class: "hidden md:table-cell", cell: asCell(ownerCell) },
        { key: "members", header: "Members", sortable: true, class: "text-right tabular-nums", cell: asCell(membersCell) },
        { key: "projects", header: "Projects", sortable: true, class: "text-right tabular-nums", cell: asCell(projectsCell) },
        { key: "created_at", header: "Created", sortable: true, class: "whitespace-nowrap", cell: asCell(createdCell) },
    ];
</script>

<svelte:head>
    <title>All organizations - LogTide</title>
</svelte:head>

{#snippet nameCell(o: OrgRow)}
    <div class="min-w-0">
        <a
            href="/dashboard/admin/organizations/{o.id}"
            class="block truncate font-medium hover:text-primary hover:underline underline-offset-4"
        >
            {o.name}
        </a>
        <p class="truncate font-mono text-xs text-muted-foreground">{o.slug}</p>
    </div>
{/snippet}

{#snippet ownerCell(o: OrgRow)}
    {#if o.ownerId && o.ownerEmail}
        <a
            href="/dashboard/admin/users/{o.ownerId}"
            class="block max-w-[16rem] truncate text-sm hover:text-primary hover:underline underline-offset-4"
        >
            {o.ownerEmail}
        </a>
    {:else}
        <span class="text-muted-foreground">-</span>
    {/if}
{/snippet}

{#snippet membersCell(o: OrgRow)}{formatCount(o.memberCount)}{/snippet}
{#snippet projectsCell(o: OrgRow)}{formatCount(o.projectCount)}{/snippet}
{#snippet createdCell(o: OrgRow)}<Timestamp value={o.created_at} relative />{/snippet}

{#snippet mobileRow(o: OrgRow)}
    <div class="space-y-1">
        <a href="/dashboard/admin/organizations/{o.id}" class="block truncate font-medium hover:text-primary">{o.name}</a>
        <p class="truncate font-mono text-xs text-muted-foreground">{o.slug}</p>
        <p class="text-xs text-muted-foreground">
            {formatCount(o.memberCount)} {o.memberCount === 1 ? "member" : "members"},
            {formatCount(o.projectCount)} {o.projectCount === 1 ? "project" : "projects"}
        </p>
        {#if o.ownerId && o.ownerEmail}
            <a href="/dashboard/admin/users/{o.ownerId}" class="block truncate text-xs text-muted-foreground hover:text-primary">
                Owner: {o.ownerEmail}
            </a>
        {/if}
    </div>
{/snippet}

<div class="space-y-6">
    <PageHeader
        title="All organizations"
        appliesTo="instance"
        description={hasLoaded ? `${formatCount(total)} ${total === 1 ? "organization" : "organizations"} on this instance` : "Every organization on this instance"}
    />

    <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
            type="search"
            placeholder="Search by name or slug"
            aria-label="Search organizations"
            bind:value={searchText}
            class="sm:max-w-md"
        />
    </div>

    {#if showError}
        <EmptyState variant="error" title="Could not load organizations" description={error}>
            {#snippet actions()}
                <Button onclick={retry}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else}
        <div class={loading && hasLoaded ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
            <DataTable
                {columns}
                rows={organizations}
                loading={showInitialSkeleton}
                rowKey={(o) => o.id}
                bind:sort
                mobileRow={asCell(mobileRow)}
            >
                {#snippet empty()}
                    {#if isSearching}
                        <EmptyState
                            variant="no-results"
                            title="No organizations found"
                            description="No organization matches your search."
                        >
                            {#snippet actions()}
                                <Button variant="outline" onclick={clearSearch}>Clear search</Button>
                            {/snippet}
                        </EmptyState>
                    {:else}
                        <EmptyState
                            variant="no-data"
                            title="No organizations found"
                            description="No organizations have been created on this instance yet."
                        />
                    {/if}
                {/snippet}
            </DataTable>
        </div>

        {#if !showInitialSkeleton}
            <Pagination page={applied.page} pageSize={PAGE_SIZE} {total} onPageChange={changePage} />
        {/if}
    {/if}
</div>
