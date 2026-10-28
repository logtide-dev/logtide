<script lang="ts">
    import { formatTimestamp } from "$lib/utils/datetime";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { onMount } from "svelte";
    import { adminAPI, type ProjectDetails } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import { page } from "$app/state";
    import * as Table from "$lib/components/ui/table";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import {
        RefreshCw,
        ArrowLeft,
        Database,
        Key,
        Bell,
        Shield,
        Trash2,
        Building2,
    } from "@lucide/svelte";
    import { Badge } from "$lib/components/ui/badge";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import { PROJECT_TRASH_DIALOG_TEXT, PROJECT_TRASH_RETENTION_DAYS } from "$lib/utils/project-trash";
    import { goto } from "$app/navigation";

    const projectId = $derived(page.params.id);

    let project = $state<ProjectDetails | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let showDeleteDialog = $state(false);
    let deleting = $state(false);

    async function loadProject() {
        if (!$authStore.user?.is_admin || !projectId) return;

        loading = true;
        error = null;
        try {
            project = await adminAPI.getProjectDetails(projectId);
        } catch (e: any) {
            console.error("Error loading project:", e);
            error = e.message || "Failed to load project details";
        } finally {
            loading = false;
        }
    }

    async function handleDelete() {
        deleting = true;
        try {
            await adminAPI.deleteProject(projectId);
            goto("/dashboard/admin/projects");
        } catch (e: any) {
            error = `Failed to delete project: ${e.message}`;
        } finally {
            deleting = false;
            showDeleteDialog = false;
        }
    }

    function formatDate(date: string) {
        return formatTimestamp(date, { precision: 'minute' });
    }

    function formatNumber(num: number) {
        return new Intl.NumberFormat('en-US').format(num);
    }

    onMount(() => {
        if ($authStore.user?.is_admin) {
            loadProject();
        }
    });
</script>

<svelte:head>
    <title>{project?.name ?? 'Project'} - LogTide</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        title={project?.name ?? 'Project'}
        appliesTo="instance"
        description={project ? [project.organization_name, project.description].filter(Boolean).join(' - ') : undefined}
        breadcrumbs={[
            { label: 'All projects', href: '/dashboard/admin/projects' },
            { label: project?.name ?? 'Project' },
        ]}
    >
        {#snippet actions()}
            {#if project}
                <Button variant="outline" size="sm" onclick={loadProject} disabled={loading}>
                    <RefreshCw class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}" />
                    Refresh
                </Button>
            {/if}
        {/snippet}
    </PageHeader>

    {#if loading}
        <div class="flex justify-center p-12">
            <RefreshCw class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    {:else if error}
        <div class="bg-destructive/15 text-destructive p-4 rounded-md">
            {error}
        </div>
    {:else if project}


        <!-- Stats Cards -->
        <div class="grid gap-4 md:grid-cols-4">
            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium">Logs ({project.logsWindowDays ?? 30}d)</CardTitle
                    >
                    <Database class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {formatNumber(project.logs30d ?? project.logsCount)}
                    </div>
                    {#if project.lastLogTime}
                        <p class="text-xs text-muted-foreground mt-1">
                            Last log: {formatDate(project.lastLogTime)}
                        </p>
                    {:else}
                        <p class="text-xs text-muted-foreground mt-1">
                            No logs yet
                        </p>
                    {/if}
                </CardContent>
            </Card>

            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium">API keys</CardTitle>
                    <Key class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {project.apiKeys.length}
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        {project.apiKeys.filter((k) => !k.revoked).length} active
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium"
                        >Alert rules</CardTitle
                    >
                    <Bell class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {project.alertRules.length}
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        {project.alertRules.filter((r) => r.enabled).length} enabled
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader
                    class="flex flex-row items-center justify-between space-y-0 pb-2"
                >
                    <CardTitle class="text-sm font-medium"
                        >Sigma rules</CardTitle
                    >
                    <Shield class="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold">
                        {project.sigmaRules.length}
                    </div>
                    <p class="text-xs text-muted-foreground mt-1">
                        Security detection rules
                    </p>
                </CardContent>
            </Card>
        </div>

        <!-- API keys section -->
        <Card>
            <CardHeader>
                <CardTitle>API keys</CardTitle>
            </CardHeader>
            <CardContent>
                {#if project.apiKeys.length === 0}
                    <div class="text-center p-8 text-muted-foreground">
                        No API keys created for this project
                    </div>
                {:else}
                    <Table.Root>
                        <Table.Header>
                            <Table.Row>
                                <Table.Head>Key name</Table.Head>
                                <Table.Head>Type</Table.Head>
                                <Table.Head>Origins</Table.Head>
                                <Table.Head>Created</Table.Head>
                                <Table.Head>Last used</Table.Head>
                                <Table.Head>Status</Table.Head>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {#each project.apiKeys as apiKey}
                                <Table.Row>
                                    <Table.Cell class="font-medium">
                                        {apiKey.name}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {#if apiKey.type === 'full'}
                                            <Badge variant="default">Full access</Badge>
                                        {:else}
                                            <Badge variant="secondary">Write-Only</Badge>
                                        {/if}
                                    </Table.Cell>
                                    <Table.Cell class="text-sm text-muted-foreground">
                                        {#if apiKey.allowed_origins?.length}
                                            <span title={apiKey.allowed_origins.join(', ')}>
                                                {apiKey.allowed_origins.length} restricted
                                            </span>
                                        {:else}
                                            Any
                                        {/if}
                                    </Table.Cell>
                                    <Table.Cell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {formatDate(apiKey.created_at)}
                                    </Table.Cell>
                                    <Table.Cell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {apiKey.last_used
                                            ? formatDate(apiKey.last_used)
                                            : "Never"}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {#if apiKey.revoked}
                                            <Badge variant="destructive"
                                                >Revoked</Badge
                                            >
                                        {:else}
                                            <Badge variant="default"
                                                >Active</Badge
                                            >
                                        {/if}
                                    </Table.Cell>
                                </Table.Row>
                            {/each}
                        </Table.Body>
                    </Table.Root>
                {/if}
            </CardContent>
        </Card>

        <!-- Alert Rules Section -->
        <Card>
            <CardHeader>
                <CardTitle>Alert rules</CardTitle>
            </CardHeader>
            <CardContent>
                {#if project.alertRules.length === 0}
                    <div class="text-center p-8 text-muted-foreground">
                        No alert rules configured for this project
                    </div>
                {:else}
                    <Table.Root>
                        <Table.Header>
                            <Table.Row>
                                <Table.Head>Rule name</Table.Head>
                                <Table.Head>Status</Table.Head>
                                <Table.Head>Created</Table.Head>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {#each project.alertRules as rule}
                                <Table.Row>
                                    <Table.Cell class="font-medium">
                                        {rule.name}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {#if rule.enabled}
                                            <Badge variant="default"
                                                >Enabled</Badge
                                            >
                                        {:else}
                                            <Badge variant="secondary"
                                                >Disabled</Badge
                                            >
                                        {/if}
                                    </Table.Cell>
                                    <Table.Cell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {formatDate(rule.created_at)}
                                    </Table.Cell>
                                </Table.Row>
                            {/each}
                        </Table.Body>
                    </Table.Root>
                {/if}
            </CardContent>
        </Card>

        <!-- Sigma Rules Section -->
        <Card>
            <CardHeader>
                <CardTitle>Sigma rules</CardTitle>
            </CardHeader>
            <CardContent>
                {#if project.sigmaRules.length === 0}
                    <div class="text-center p-8 text-muted-foreground">
                        No Sigma rules imported for this project
                    </div>
                {:else}
                    <Table.Root>
                        <Table.Header>
                            <Table.Row>
                                <Table.Head>Rule title</Table.Head>
                                <Table.Head>Level</Table.Head>
                                <Table.Head>Status</Table.Head>
                                <Table.Head>Created</Table.Head>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {#each project.sigmaRules as rule}
                                <Table.Row>
                                    <Table.Cell class="font-medium">
                                        {rule.title}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {#if rule.level}
                                            <Badge
                                                variant={rule.level ===
                                                    "critical" ||
                                                rule.level === "high"
                                                    ? "destructive"
                                                    : "secondary"}
                                            >
                                                {rule.level}
                                            </Badge>
                                        {:else}
                                            <span class="text-muted-foreground"
                                                >-</span
                                            >
                                        {/if}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {#if rule.status}
                                            <Badge variant="outline"
                                                >{rule.status}</Badge
                                            >
                                        {:else}
                                            <span class="text-muted-foreground"
                                                >-</span
                                            >
                                        {/if}
                                    </Table.Cell>
                                    <Table.Cell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {formatDate(rule.created_at)}
                                    </Table.Cell>
                                </Table.Row>
                            {/each}
                        </Table.Body>
                    </Table.Root>
                {/if}
            </CardContent>
        </Card>

        <!-- Danger Zone -->
        <Card class="border-destructive">
            <CardHeader>
                <CardTitle class="text-destructive">Danger zone</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="font-semibold">Delete project</h4>
                        <p class="text-sm text-muted-foreground mt-1">
                            {#if project.deletedAt}
                                This project is already in the trash since {formatDate(project.deletedAt)}.
                            {:else}
                                Moves the project to the trash: it stops accepting data and is
                                permanently deleted after {PROJECT_TRASH_RETENTION_DAYS} days.
                            {/if}
                        </p>
                    </div>
                    <Button
                        variant="destructive"
                        onclick={() => (showDeleteDialog = true)}
                        class="ml-4"
                        disabled={!!project.deletedAt}
                    >
                        <Trash2 class="mr-2 h-4 w-4" />
                        Delete project
                    </Button>
                </div>
            </CardContent>
        </Card>
    {/if}
</div>

<ConfirmDialog
    bind:open={showDeleteDialog}
    title="Delete project"
    description={PROJECT_TRASH_DIALOG_TEXT(project?.name ?? "This project")}
    confirmLabel="Delete project"
    requireText={project?.name ?? ""}
    busy={deleting}
    onConfirm={handleDelete}
/>
