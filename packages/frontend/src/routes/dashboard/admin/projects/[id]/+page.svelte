<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { adminAPI, type ProjectDetails } from "$lib/api/admin";
    import { toastStore } from "$lib/stores/toast";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import DangerZone from "$lib/components/app/DangerZone.svelte";
    import SettingsSection from "$lib/components/app/SettingsSection.svelte";
    import CopyButton from "$lib/components/app/CopyButton.svelte";
    import Timestamp from "$lib/components/app/Timestamp.svelte";
    import SeverityBadge from "$lib/components/app/SeverityBadge.svelte";
    import DataTable from "$lib/components/app/DataTable.svelte";
    import type { DataTableColumn } from "$lib/components/app/data-table";
    import StatsCard from "$lib/components/dashboard/StatsCard.svelte";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import { RefreshCw, Database, Clock, Key, Bell } from "@lucide/svelte";
    import { formatCount } from "$lib/utils/format-number";
    import { formatRelative } from "$lib/utils/datetime";
    import { PROJECT_TRASH_DIALOG_TEXT, PROJECT_TRASH_RETENTION_DAYS, PROJECT_TRASH_TOAST } from "$lib/utils/project-trash";

    type ApiKey = ProjectDetails["apiKeys"][number];
    type AlertRule = ProjectDetails["alertRules"][number];
    type SigmaRule = ProjectDetails["sigmaRules"][number];

    const projectId = $derived(page.params.id);

    let project = $state<ProjectDetails | null>(null);
    let loading = $state(true);
    let refreshing = $state(false);
    let error = $state<string | null>(null);
    let notFound = $state(false);
    let showDeleteDialog = $state(false);
    let deleting = $state(false);
    let requestId = 0;

    /** First load shows skeletons; a refresh keeps the page and swaps data in place. */
    async function loadProject() {
        if (!projectId) return;
        const id = ++requestId;
        if (project) refreshing = true;
        else loading = true;
        error = null;
        notFound = false;
        try {
            const result = await adminAPI.getProjectDetails(projectId);
            if (id !== requestId) return;
            project = result;
        } catch (e: any) {
            if (id !== requestId) return;
            const message: string = e?.message || "Failed to load project details";
            if (!project && /not found|404/i.test(message)) {
                notFound = true;
            } else {
                error = message;
                if (project) toastStore.error(message);
            }
        } finally {
            if (id === requestId) {
                loading = false;
                refreshing = false;
            }
        }
    }

    $effect(() => {
        void projectId;
        untrack(() => {
            project = null;
            loadProject();
        });
    });

    async function handleDelete() {
        if (!projectId) return;
        deleting = true;
        try {
            await adminAPI.deleteProject(projectId);
            toastStore.success(PROJECT_TRASH_TOAST);
            await goto("/dashboard/admin/projects");
        } catch (e: any) {
            toastStore.error(e?.message || "Failed to delete project");
            throw e;
        } finally {
            deleting = false;
        }
    }

    const windowDays = $derived(project?.logsWindowDays ?? 30);
    const activeKeys = $derived(project ? project.apiKeys.filter((k) => !k.revoked).length : 0);
    const enabledRules = $derived(project ? project.alertRules.filter((r) => r.enabled).length : 0);
    const orgHref = $derived(project ? `/dashboard/admin/organizations/${project.organization_id}` : "");

    const asCell = <T,>(s: unknown) => s as Snippet<[T]>;

    const keyColumns: DataTableColumn<ApiKey>[] = [
        { key: "name", header: "Key name", class: "font-medium", cell: asCell<ApiKey>(keyNameCell) },
        { key: "type", header: "Type", cell: asCell<ApiKey>(keyTypeCell) },
        { key: "origins", header: "Allowed origins", class: "min-w-[12rem]", cell: asCell<ApiKey>(keyOriginsCell) },
        { key: "created", header: "Created", class: "whitespace-nowrap", cell: asCell<ApiKey>(keyCreatedCell) },
        { key: "last_used", header: "Last used", class: "whitespace-nowrap", cell: asCell<ApiKey>(keyUsedCell) },
        { key: "status", header: "Status", cell: asCell<ApiKey>(keyStatusCell) },
    ];

    const ruleColumns: DataTableColumn<AlertRule>[] = [
        { key: "name", header: "Rule", class: "font-medium", cell: asCell<AlertRule>(ruleNameCell) },
        { key: "status", header: "Status", cell: asCell<AlertRule>(ruleStatusCell) },
        { key: "created", header: "Created", class: "whitespace-nowrap", cell: asCell<AlertRule>(ruleCreatedCell) },
    ];

    const sigmaColumns: DataTableColumn<SigmaRule>[] = [
        { key: "title", header: "Rule", class: "font-medium", cell: asCell<SigmaRule>(sigmaTitleCell) },
        { key: "level", header: "Severity", cell: asCell<SigmaRule>(sigmaLevelCell) },
        { key: "status", header: "Status", cell: asCell<SigmaRule>(sigmaStatusCell) },
        { key: "created", header: "Created", class: "whitespace-nowrap", cell: asCell<SigmaRule>(sigmaCreatedCell) },
    ];
</script>

<svelte:head>
    <title>{project?.name ?? "Project"} - LogTide</title>
</svelte:head>

{#snippet keyNameCell(k: ApiKey)}{k.name}{/snippet}
{#snippet keyTypeCell(k: ApiKey)}
    {#if k.type === "full"}
        <Badge variant="default">Full access</Badge>
    {:else}
        <Badge variant="secondary">Write only</Badge>
    {/if}
{/snippet}
{#snippet keyOriginsCell(k: ApiKey)}
    {#if k.allowed_origins?.length}
        <ul class="space-y-0.5 text-xs">
            {#each k.allowed_origins as origin (origin)}
                <li class="break-all font-mono">{origin}</li>
            {/each}
        </ul>
    {:else}
        <span class="text-muted-foreground">Any origin</span>
    {/if}
{/snippet}
{#snippet keyCreatedCell(k: ApiKey)}
    <span class="text-muted-foreground"><Timestamp value={k.created_at} precision="minute" /></span>
{/snippet}
{#snippet keyUsedCell(k: ApiKey)}
    {#if k.last_used}
        <Timestamp value={k.last_used} relative />
    {:else}
        <span class="text-muted-foreground">Never</span>
    {/if}
{/snippet}
{#snippet keyStatusCell(k: ApiKey)}
    <SeverityBadge kind="state" value={k.revoked ? "failed" : "active"} />
{/snippet}

{#snippet ruleNameCell(r: AlertRule)}{r.name}{/snippet}
{#snippet ruleStatusCell(r: AlertRule)}
    <SeverityBadge kind="state" value={r.enabled ? "active" : "disabled"} />
{/snippet}
{#snippet ruleCreatedCell(r: AlertRule)}
    <span class="text-muted-foreground"><Timestamp value={r.created_at} precision="minute" /></span>
{/snippet}

{#snippet sigmaTitleCell(r: SigmaRule)}{r.title}{/snippet}
{#snippet sigmaLevelCell(r: SigmaRule)}
    {#if r.level}
        <SeverityBadge kind="severity" value={r.level} />
    {:else}
        <span class="text-muted-foreground">-</span>
    {/if}
{/snippet}
{#snippet sigmaStatusCell(r: SigmaRule)}
    {r.status ?? "-"}
{/snippet}
{#snippet sigmaCreatedCell(r: SigmaRule)}
    <span class="text-muted-foreground"><Timestamp value={r.created_at} precision="minute" /></span>
{/snippet}

<div class="space-y-6">
    <PageHeader
        title={project?.name ?? "Project"}
        appliesTo="instance"
        description={project?.description ?? undefined}
        breadcrumbs={[
            { label: "Admin", href: "/dashboard/admin" },
            { label: "Projects", href: "/dashboard/admin/projects" },
            { label: project?.name ?? "Project" },
        ]}
    >
        {#snippet meta()}
            {#if project}
                <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <a href={orgHref} class="underline-offset-4 hover:text-foreground hover:underline">
                        {project.organization_name}
                    </a>
                    <span class="inline-flex items-center gap-1">
                        <span class="font-mono text-xs">{project.id}</span>
                        <CopyButton value={project.id} label="Copy project ID" />
                    </span>
                </div>
            {/if}
        {/snippet}
        {#snippet actions()}
            {#if project}
                <Button variant="outline" size="sm" onclick={loadProject} disabled={refreshing}>
                    <RefreshCw class="mr-2 h-4 w-4 {refreshing ? 'animate-spin' : ''}" />
                    Refresh
                </Button>
            {/if}
        {/snippet}
    </PageHeader>

    {#if loading && !project}
        <div class="space-y-4" aria-busy="true">
            <Skeleton height="6rem" width="100%" />
            <Skeleton height="12rem" width="100%" />
        </div>
    {:else if notFound}
        <EmptyState variant="no-results" title="Project not found" description="It may never have existed, or it was purged after its trash period.">
            {#snippet actions()}
                <a href="/dashboard/admin/projects" class={buttonVariants({ variant: "outline", size: "sm" })}>
                    Back to projects
                </a>
            {/snippet}
        </EmptyState>
    {:else if error && !project}
        <EmptyState variant="error" title="Could not load this project" description={error}>
            {#snippet actions()}
                <Button variant="outline" size="sm" onclick={loadProject}>Retry</Button>
                <a href="/dashboard/admin/projects" class={buttonVariants({ variant: "outline", size: "sm" })}>
                    Back to projects
                </a>
            {/snippet}
        </EmptyState>
    {:else if project}
        {#if project.deletedAt}
            <div role="status" class="rounded-lg border border-warning/30 bg-warning/15 p-4 text-sm text-warning-text">
                This project was deleted <Timestamp value={project.deletedAt} relative />. It no longer accepts data and
                is purged for good after {PROJECT_TRASH_RETENTION_DAYS} days. It can be restored from the organization's projects page.
            </div>
        {/if}

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
                title="Logs ({windowDays}d)"
                value={formatCount(project.logs30d ?? project.logsCount)}
                icon={Database}
                description="Received in the last {windowDays} days"
            />
            <StatsCard
                title="Last log"
                value={project.lastLogTime ? formatRelative(project.lastLogTime) : "None yet"}
                icon={Clock}
                description={project.lastLogTime ? "Newest log in this project" : "No logs received"}
            />
            <StatsCard
                title="Active API keys"
                value={formatCount(activeKeys)}
                icon={Key}
                description="{formatCount(project.apiKeys.length - activeKeys)} revoked"
            />
            <StatsCard
                title="Alert rules"
                value="{formatCount(enabledRules)} / {formatCount(project.alertRules.length)}"
                icon={Bell}
                description="Enabled / total"
            />
        </div>

        <SettingsSection title="API keys" description="Keys that can send data to this project">
            <DataTable columns={keyColumns} rows={project.apiKeys} rowKey={(k) => k.id}>
                {#snippet empty()}
                    <EmptyState variant="no-data" title="No API keys" description="No key has been created for this project." />
                {/snippet}
            </DataTable>
        </SettingsSection>

        <SettingsSection title="Alert rules" description="Threshold and rate rules defined on this project">
            <DataTable columns={ruleColumns} rows={project.alertRules} rowKey={(r) => r.id}>
                {#snippet empty()}
                    <EmptyState variant="no-data" title="No alert rules" />
                {/snippet}
            </DataTable>
        </SettingsSection>

        <SettingsSection
            title="Sigma rules"
            description="Only rules attached to this project. Organization-wide rules are not listed here."
        >
            <DataTable columns={sigmaColumns} rows={project.sigmaRules} rowKey={(r) => r.id}>
                {#snippet empty()}
                    <EmptyState variant="no-data" title="No project-level Sigma rules" />
                {/snippet}
            </DataTable>
        </SettingsSection>

        {#if !project.deletedAt}
            <DangerZone>
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="space-y-1">
                        <h3 class="font-semibold">Delete project</h3>
                        <p class="text-sm text-muted-foreground">
                            Moves the project to the trash. Ingestion stops now and the data is purged after the
                            trash period.
                        </p>
                    </div>
                    <Button variant="destructive" onclick={() => (showDeleteDialog = true)}>Delete project</Button>
                </div>
            </DangerZone>
        {/if}
    {/if}
</div>

<ConfirmDialog
    bind:open={showDeleteDialog}
    title="Delete project"
    description={PROJECT_TRASH_DIALOG_TEXT(project?.name ?? "This project")}
    confirmLabel="Delete project"
    busy={deleting}
    onConfirm={handleDelete}
/>
