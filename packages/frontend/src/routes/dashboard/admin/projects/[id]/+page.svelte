<script lang="ts">
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
    } from "lucide-svelte";
    import { Badge } from "$lib/components/ui/badge";

    const projectId = $derived(page.params.id);

    let project = $state<ProjectDetails | null>(null);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let deleteConfirm = $state(false);

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
        if (!deleteConfirm) {
            deleteConfirm = true;
            setTimeout(() => {
                deleteConfirm = false;
            }, 5000);
            return;
        }

        try {
            await adminAPI.deleteProject(projectId);
            // Redirect to projects list after delete
            window.location.href = "/dashboard/admin/projects";
        } catch (e: any) {
            error = `Failed to delete project: ${e.message}`;
            deleteConfirm = false;
        }
    }

    function formatDate(date: string) {
        return new Date(date).toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    function formatNumber(num: number) {
        return new Intl.NumberFormat("en-US").format(num);
    }

    onMount(() => {
        if ($authStore.user?.is_admin) {
            loadProject();
        }
    });
</script>

<div class="container mx-auto p-6 space-y-6">
    {#if loading}
        <div class="flex justify-center p-12">
            <RefreshCw class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    {:else if error}
        <div class="bg-destructive/15 text-destructive p-4 rounded-md">
            {error}
        </div>
    {:else if project}
        <!-- Header -->
        <div class="flex items-start justify-between">
            <div class="space-y-1">
                <a
                    href="/dashboard/admin/projects"
                    class={buttonVariants({
                        variant: "ghost",
                        size: "sm",
                    }) + " mb-2"}
                >
                    <ArrowLeft class="mr-2 h-4 w-4" />
                    Back to Projects
                </a>
                <h1 class="text-3xl font-bold tracking-tight">
                    {project.name}
                </h1>
                <div class="flex items-center gap-2">
                    <Building2 class="h-4 w-4 text-muted-foreground" />
                    <span class="text-muted-foreground">
                        {project.organization_name}
                    </span>
                </div>
                {#if project.description}
                    <p class="text-muted-foreground mt-2">
                        {project.description}
                    </p>
                {/if}
            </div>
            <Button
                variant="outline"
                size="sm"
                onclick={loadProject}
                disabled={loading}
            >
                <RefreshCw
                    class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}"
                />
                Refresh
            </Button>
        </div>

        <!-- Stats Cards -->
        <div class="grid gap-4 md:grid-cols-4">
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
                        {formatNumber(project.logsCount)}
                    </div>
                    {#if project.lastLogTime}
                        <p class="text-xs text-muted-foreground mt-1">
                            Last: {formatDate(project.lastLogTime)}
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
                    <CardTitle class="text-sm font-medium">API Keys</CardTitle>
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
                        >Alert Rules</CardTitle
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
                        >Sigma Rules</CardTitle
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

        <!-- API Keys Section -->
        <Card>
            <CardHeader>
                <CardTitle>API Keys</CardTitle>
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
                                <Table.Head>Key Name</Table.Head>
                                <Table.Head>Created</Table.Head>
                                <Table.Head>Last Used</Table.Head>
                                <Table.Head>Status</Table.Head>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {#each project.apiKeys as apiKey}
                                <Table.Row>
                                    <Table.Cell class="font-medium">
                                        {apiKey.name}
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
                <CardTitle>Alert Rules</CardTitle>
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
                                <Table.Head>Rule Name</Table.Head>
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
                <CardTitle>Sigma Rules</CardTitle>
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
                                <Table.Head>Rule Title</Table.Head>
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
                <CardTitle class="text-destructive">Danger Zone</CardTitle>
            </CardHeader>
            <CardContent>
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="font-semibold">Delete Project</h4>
                        <p class="text-sm text-muted-foreground mt-1">
                            This will permanently delete the project, all logs,
                            API keys, alert rules, and sigma rules. This action
                            cannot be undone.
                        </p>
                    </div>
                    <Button
                        variant="destructive"
                        onclick={handleDelete}
                        class="ml-4"
                    >
                        {#if deleteConfirm}
                            <Trash2 class="mr-2 h-4 w-4" />
                            Confirm Delete
                        {:else}
                            Delete Project
                        {/if}
                    </Button>
                </div>
            </CardContent>
        </Card>
    {/if}
</div>
