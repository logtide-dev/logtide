<script lang="ts">
    import { untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import {
        adminAPI,
        type ProjectBasic,
        type ProjectSort,
        type ProjectsSummary,
    } from "$lib/api/admin";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import Pagination from "$lib/components/app/Pagination.svelte";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import type { DataTableSort } from "$lib/components/app/data-table";
    import StatsCard from "$lib/components/dashboard/StatsCard.svelte";
    import AdminProjectsTable from "$lib/components/admin/AdminProjectsTable.svelte";
    import AdminOrgPicker, { type PickedOrg } from "$lib/components/admin/AdminOrgPicker.svelte";
    import {
        buildListSearch,
        parseEnum,
        parsePage,
        parseSort,
    } from "$lib/components/admin/admin-list-url";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { FolderKanban, Database, Key, Bell, Search, RefreshCw } from "@lucide/svelte";
    import { toastStore } from "$lib/stores/toast";
    import { formatCount } from "$lib/utils/format-number";
    import { PROJECT_TRASH_DIALOG_TEXT, PROJECT_TRASH_TOAST } from "$lib/utils/project-trash";

    const LIMIT = 50;
    const DEFAULT_SORT: DataTableSort = { key: "created_at", dir: "desc" };
    const SORT_KEYS = ["name", "organization", "created_at"] as const;
    const DELETED = ["exclude", "include", "only"] as const;
    const SELECT_CLASS =
        "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11";

    // The URL is the source of truth for search, filters, sort and page.
    const params = $derived(page.url.searchParams);
    const q = $derived(params.get("q") ?? "");
    const pageNum = $derived(parsePage(params.get("page")));
    const organizationId = $derived(params.get("organizationId") ?? "");
    const deleted = $derived(parseEnum(params.get("deleted"), DELETED, "exclude"));
    const sort = $derived(parseSort(params, SORT_KEYS, DEFAULT_SORT));

    let projects: ProjectBasic[] = $state([]);
    let total = $state(0);
    let loaded = $state(false);
    let loading = $state(false);
    let error = $state("");
    let searchInput = $state(untrack(() => q));
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let requestId = 0;

    let summary = $state<ProjectsSummary | null>(null);
    let summaryLoading = $state(true);
    let summaryFailed = $state(false);
    let pickedOrg = $state<PickedOrg | null>(null);

    let deleteTarget = $state<ProjectBasic | null>(null);
    let showDeleteDialog = $state(false);
    let deleting = $state(false);

    function navigate(next: {
        q?: string;
        page?: number;
        organizationId?: string;
        deleted?: string;
        sort?: DataTableSort;
    }) {
        const search = buildListSearch({
            q: next.q ?? q,
            page: next.page ?? pageNum,
            sort: next.sort ?? sort,
            defaultSort: DEFAULT_SORT,
            filters: {
                organizationId: next.organizationId ?? organizationId,
                deleted: next.deleted ?? deleted,
            },
            filterDefaults: { deleted: "exclude" },
        });
        goto(page.url.pathname + search, {
            replaceState: true,
            keepFocus: true,
            noScroll: true,
        });
    }

    function onSearchInput() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const next = searchInput.trim();
            if (next !== q) navigate({ q: next, page: 1 });
        }, 300);
    }

    $effect(() => () => clearTimeout(searchTimer));

    // Back/forward changes the URL query without touching the input.
    $effect(() => {
        const current = q;
        untrack(() => {
            if (current !== searchInput.trim()) searchInput = current;
        });
    });

    async function loadProjects() {
        const id = ++requestId;
        loading = true;
        error = "";
        try {
            const response = await adminAPI.getProjects({
                page: pageNum,
                limit: LIMIT,
                search: q || undefined,
                sort: sort.key as ProjectSort,
                order: sort.dir,
                organizationId: organizationId || undefined,
                deleted,
            });
            if (id !== requestId) return;
            // Deleting the last row of a page leaves it empty: step back.
            if (response.projects.length === 0 && pageNum > 1 && response.total > 0) {
                navigate({ page: Math.min(pageNum - 1, response.totalPages || 1) });
                return;
            }
            projects = response.projects;
            total = response.total;
            loaded = true;
        } catch (err: any) {
            if (id !== requestId) return;
            error = err?.message || "Failed to load projects";
            toastStore.error(error);
        } finally {
            if (id === requestId) loading = false;
        }
    }

    async function loadSummary() {
        try {
            summary = await adminAPI.getProjectsSummary();
            summaryFailed = false;
        } catch {
            summaryFailed = true;
        } finally {
            summaryLoading = false;
        }
    }

    // Resolve the name of a deep-linked organization filter (?organizationId=).
    async function resolvePickedOrg(id: string) {
        try {
            const org = await adminAPI.getOrganizationDetails(id);
            if (organizationId === id) pickedOrg = { id: org.id, name: org.name, slug: org.slug };
        } catch {
            if (organizationId === id) pickedOrg = { id, name: "Selected organization", slug: "" };
        }
    }

    $effect(() => {
        const id = organizationId;
        untrack(() => {
            if (!id) pickedOrg = null;
            else if (pickedOrg?.id !== id) void resolvePickedOrg(id);
        });
    });

    $effect(() => {
        untrack(() => {
            void loadSummary();
        });
    });

    // Reload whenever the URL-derived query changes.
    $effect(() => {
        void [q, pageNum, organizationId, deleted, sort.key, sort.dir];
        untrack(() => loadProjects());
    });

    const hasFilters = $derived(!!q || !!organizationId || deleted !== "exclude");

    function clearFilters() {
        searchInput = "";
        navigate({ q: "", organizationId: "", deleted: "exclude", page: 1 });
    }

    function askDelete(project: ProjectBasic) {
        deleteTarget = project;
        showDeleteDialog = true;
    }

    async function handleDelete() {
        const target = deleteTarget;
        if (!target) return;
        deleting = true;
        try {
            await adminAPI.deleteProject(target.id);
            toastStore.success(PROJECT_TRASH_TOAST);
            await Promise.allSettled([loadProjects(), loadSummary()]);
        } catch (e: any) {
            toastStore.error(e?.message || "Failed to delete project");
            throw e;
        } finally {
            deleting = false;
        }
    }

    function refresh() {
        void Promise.allSettled([loadProjects(), loadSummary()]);
    }

    function tile(value: number | undefined): string {
        return summary && value !== undefined ? formatCount(value) : "-";
    }

    const windowDays = $derived(summary?.logsWindowDays ?? 30);
</script>

<svelte:head>
    <title>All projects - LogTide</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        title="All projects"
        appliesTo="instance"
        description="Every project across all organizations"
    >
        {#snippet actions()}
            <Button variant="outline" size="sm" onclick={refresh} disabled={loading}>
                <RefreshCw class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}" />
                Refresh
            </Button>
        {/snippet}
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={summaryLoading}>
        <StatsCard
            title="Projects"
            value={tile(summary?.totalProjects)}
            icon={FolderKanban}
            description={summaryFailed ? "Could not load totals" : "Instance total, excluding deleted"}
        />
        <StatsCard
            title="Logs ({windowDays}d)"
            value={tile(summary?.logs30d)}
            icon={Database}
            description="Instance total, last {windowDays} days"
        />
        <StatsCard
            title="Active API keys"
            value={tile(summary?.activeApiKeys)}
            icon={Key}
            description="Instance total, not revoked"
        />
        <StatsCard
            title="Alert rules"
            value={summary ? `${formatCount(summary.alertRulesEnabled)} / ${formatCount(summary.alertRulesTotal)}` : "-"}
            icon={Bell}
            description="Enabled / total, instance wide"
        />
    </div>

    <div class="flex flex-wrap items-end gap-3">
        <div class="relative min-w-[14rem] flex-1">
            <Search
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
            />
            <Input
                type="search"
                aria-label="Search projects by name or description"
                placeholder="Search by name or description"
                bind:value={searchInput}
                oninput={onSearchInput}
                class="pl-10 max-md:h-11"
            />
        </div>
        <div class="grid gap-1">
            <label for="projects-org-filter" class="text-xs font-medium text-muted-foreground">Organization</label>
            <AdminOrgPicker
                id="projects-org-filter"
                class="w-56 max-md:h-11"
                placeholder="All organizations"
                selected={pickedOrg}
                onSelect={(org) => {
                    pickedOrg = org;
                    navigate({ organizationId: org.id, page: 1 });
                }}
                onClear={() => navigate({ organizationId: "", page: 1 })}
            />
        </div>
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
            Deleted projects
            <select
                class={SELECT_CLASS}
                value={deleted}
                onchange={(e) => navigate({ deleted: e.currentTarget.value, page: 1 })}
            >
                <option value="exclude">Hide deleted</option>
                <option value="include">Include deleted</option>
                <option value="only">Only deleted</option>
            </select>
        </label>
    </div>

    {#if error && !loaded}
        <EmptyState variant="error" title="Could not load projects" description={error}>
            {#snippet actions()}
                <Button variant="outline" size="sm" onclick={loadProjects}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else}
        <div class="space-y-4" aria-busy={loading}>
            <div class={loading && loaded ? "opacity-70 transition-opacity" : "transition-opacity"}>
                <AdminProjectsTable
                    {projects}
                    loading={!loaded}
                    onDelete={askDelete}
                    bind:sort={() => sort, (s) => navigate({ sort: s, page: 1 })}
                >
                    {#snippet empty()}
                        {#if hasFilters}
                            <EmptyState variant="no-results" title="No projects match" description="Try a different search or clear the filters.">
                                {#snippet actions()}
                                    <Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
                                {/snippet}
                            </EmptyState>
                        {:else}
                            <EmptyState variant="no-data" title="No projects yet" description="Projects appear here once an organization creates one." />
                        {/if}
                    {/snippet}
                </AdminProjectsTable>
            </div>
            {#if error}
                <p class="text-sm text-destructive-text" role="alert">
                    {error}
                    <button type="button" class="underline underline-offset-4" onclick={loadProjects}>Retry</button>
                </p>
            {/if}
            <Pagination
                page={pageNum}
                pageSize={LIMIT}
                {total}
                onPageChange={(p) => navigate({ page: p })}
            />
        </div>
    {/if}
</div>

<ConfirmDialog
    bind:open={showDeleteDialog}
    title="Delete project"
    description={PROJECT_TRASH_DIALOG_TEXT(deleteTarget?.name ?? "This project")}
    confirmLabel="Delete project"
    busy={deleting}
    onConfirm={handleDelete}
/>
