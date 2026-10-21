<script lang="ts">
    import { formatDateShort } from "$lib/utils/datetime";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { onMount } from "svelte";
    import { adminAPI, type ProjectBasic } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import * as Table from "$lib/components/ui/table";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
    import {
        RefreshCw,
        Search,
        FolderKanban,
        Database,
        Key,
        Bell,
        Trash2,
    } from "@lucide/svelte";
    import { browser } from "$app/environment";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";

    let projects = $state<ProjectBasic[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let searchQuery = $state("");
    let currentPage = $state(1);
    let totalPages = $state(1);
    let total = $state(0);
    let showDeleteDialog = $state(false);
    let deleteTargetId = $state<string | null>(null);
    let deleteTargetName = $state("");
    let deleting = $state(false);

    async function loadProjects() {
        if (!$authStore.user?.is_admin) return;

        loading = true;
        error = null;
        try {
            const response = await adminAPI.getProjects(
                currentPage,
                50,
                searchQuery || undefined,
            );
            projects = response.projects;
            total = response.total;
            totalPages = response.totalPages;
        } catch (e: any) {
            console.error("Error loading projects:", e);
            error = e.message || "Failed to load projects";
        } finally {
            loading = false;
        }
    }

    function confirmDelete(projectId: string, projectName: string) {
        deleteTargetId = projectId;
        deleteTargetName = projectName;
        showDeleteDialog = true;
    }

    async function handleDelete() {
        if (!deleteTargetId) return;
        deleting = true;
        try {
            await adminAPI.deleteProject(deleteTargetId);
            showDeleteDialog = false;
            deleteTargetId = null;
            await loadProjects();
        } catch (e: any) {
            error = `Failed to delete project: ${e.message}`;
        } finally {
            deleting = false;
        }
    }

    function handleSearch() {
        currentPage = 1;
        loadProjects();
    }

    function changePage(page: number) {
        currentPage = page;
        loadProjects();
    }

    function formatDate(dateStr: string | Date) {
        return formatDateShort(dateStr);
    }

    function formatNumber(num: number) {
        return new Intl.NumberFormat(undefined).format(num);
    }

    onMount(() => {
        if (browser && $authStore.user?.is_admin) {
            loadProjects();
        }
    });
</script>

<svelte:head>
    <title>All projects - LogTide</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        title="All projects"
        appliesTo="instance"
        description="Manage all projects across organizations"
    >
        {#snippet actions()}
            <Button variant="outline" size="sm" onclick={loadProjects} disabled={loading}>
                <RefreshCw class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}" />
                Refresh
            </Button>
        {/snippet}
    </PageHeader>

    {#if error}
        <div class="bg-destructive/15 text-destructive p-4 rounded-md">
            {error}
        </div>
    {/if}

    <!-- Stats Cards -->
    <div class="grid gap-4 md:grid-cols-3">
        <Card>
            <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
                <CardTitle class="text-sm font-medium">Total projects</CardTitle
                >
                <FolderKanban class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div class="text-2xl font-bold">{formatNumber(total)}</div>
                <p class="text-xs text-muted-foreground mt-1">
                    Across all organizations
                </p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
                <CardTitle class="text-sm font-medium">Total logs</CardTitle>
                <Database class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div class="text-2xl font-bold">
                    {formatNumber(
                        projects.reduce((sum, p) => sum + p.logsCount, 0),
                    )}
                </div>
                <p class="text-xs text-muted-foreground mt-1">
                    Combined from all projects
                </p>
            </CardContent>
        </Card>

        <Card>
            <CardHeader
                class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
                <CardTitle class="text-sm font-medium"
                    >Active API keys</CardTitle
                >
                <Key class="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div class="text-2xl font-bold">
                    {formatNumber(
                        projects.reduce((sum, p) => sum + p.apiKeysCount, 0),
                    )}
                </div>
                <p class="text-xs text-muted-foreground mt-1">
                    Non-revoked keys
                </p>
            </CardContent>
        </Card>
    </div>

    <!-- Search and Table -->
    <Card>
        <CardHeader>
            <div class="flex items-center gap-4">
                <div class="relative flex-1">
                    <Search
                        class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                    />
                    <Input
                        type="search"
                        placeholder="Search by project or organization name..."
                        class="pl-8"
                        bind:value={searchQuery}
                        onkeydown={(e) => e.key === "Enter" && handleSearch()}
                    />
                </div>
                <Button onclick={handleSearch} size="sm" disabled={loading}>
                    Search
                </Button>
            </div>
        </CardHeader>
        <CardContent>
            {#if loading && projects.length === 0}
                <SkeletonTable rows={8} columns={7} />
            {:else if projects.length === 0}
                <div
                    class="flex flex-col items-center justify-center p-12 text-center"
                >
                    <FolderKanban
                        class="h-12 w-12 text-muted-foreground mb-4"
                    />
                    <h3 class="text-lg font-semibold">No projects found</h3>
                    <p class="text-muted-foreground mt-2">
                        {searchQuery
                            ? "Try adjusting your search"
                            : "No projects have been created yet"}
                    </p>
                </div>
            {:else}
                <TableLoadingOverlay loading={loading}>
                <Table.Root>
                    <Table.Header>
                        <Table.Row>
                            <Table.Head>Project name</Table.Head>
                            <Table.Head>Organization</Table.Head>
                            <Table.Head class="text-right">Logs</Table.Head>
                            <Table.Head class="text-right">API Keys</Table.Head>
                            <Table.Head class="text-right">Alerts</Table.Head>
                            <Table.Head>Created</Table.Head>
                            <Table.Head class="text-right">Actions</Table.Head>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {#each projects as project}
                            <Table.Row>
                                <Table.Cell class="font-medium">
                                    {project.name}
                                    {#if project.description}
                                        <p
                                            class="text-xs text-muted-foreground mt-1"
                                        >
                                            {project.description}
                                        </p>
                                    {/if}
                                </Table.Cell>
                                <Table.Cell class="text-muted-foreground">
                                    {project.organization_name}
                                </Table.Cell>
                                <Table.Cell class="text-right">
                                    {formatNumber(project.logsCount)}
                                </Table.Cell>
                                <Table.Cell class="text-right">
                                    {project.apiKeysCount}
                                </Table.Cell>
                                <Table.Cell class="text-right">
                                    {project.alertRulesCount}
                                </Table.Cell>
                                <Table.Cell
                                    class="text-sm text-muted-foreground"
                                >
                                    {formatDate(project.created_at)}
                                </Table.Cell>
                                <Table.Cell class="text-right">
                                    <div class="flex justify-end gap-2">
                                        <a
                                            href="/dashboard/admin/projects/{project.id}"
                                            class={buttonVariants({
                                                variant: "outline",
                                                size: "sm",
                                            })}
                                        >
                                            View Details
                                        </a>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onclick={() =>
                                                confirmDelete(
                                                    project.id,
                                                    project.name,
                                                )}
                                        >
                                            <Trash2 class="h-4 w-4" />
                                        </Button>
                                    </div>
                                </Table.Cell>
                            </Table.Row>
                        {/each}
                    </Table.Body>
                </Table.Root>

                <!-- Pagination -->
                {#if totalPages > 1}
                    <div class="flex items-center justify-between mt-4">
                        <div class="text-sm text-muted-foreground">
                            Page {currentPage} of {totalPages} • Total: {formatNumber(
                                total,
                            )} projects
                        </div>
                        <div class="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={currentPage <= 1}
                                onclick={() => changePage(currentPage - 1)}
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={currentPage >= totalPages}
                                onclick={() => changePage(currentPage + 1)}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                {/if}
                </TableLoadingOverlay>
            {/if}
        </CardContent>
    </Card>
</div>

<ConfirmDialog
    bind:open={showDeleteDialog}
    title="Delete project"
    description="This permanently deletes all logs, API keys, alert rules and sigma rules of this project. This cannot be undone."
    confirmLabel="Delete project"
    requireText={deleteTargetName}
    busy={deleting}
    onConfirm={handleDelete}
/>
