<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { adminAPI, type OrganizationDetails } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import { toastStore } from "$lib/stores/toast";
    import { formatCount } from "$lib/utils/format-number";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import DataTable from "$lib/components/app/DataTable.svelte";
    import type { DataTableColumn } from "$lib/components/app/data-table";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import SettingsSection from "$lib/components/app/SettingsSection.svelte";
    import DangerZone from "$lib/components/app/DangerZone.svelte";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import CopyButton from "$lib/components/app/CopyButton.svelte";
    import Timestamp from "$lib/components/app/Timestamp.svelte";
    import PageSkeleton from "$lib/components/shell/PageSkeleton.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import Input from "$lib/components/ui/input/input.svelte";
    import Label from "$lib/components/ui/label/label.svelte";
    import Save from "@lucide/svelte/icons/save";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import OrgSummaryTiles from "$lib/components/admin/OrgSummaryTiles.svelte";
    import OrgSideNav, { ORG_NAV_ITEMS } from "$lib/components/admin/OrgSideNav.svelte";
    import OrgEntitlementsSection from "$lib/components/admin/OrgEntitlementsSection.svelte";
    import { createLatestGuard } from "$lib/components/admin/latest-request";

    type Member = OrganizationDetails["members"][number];
    type Project = OrganizationDetails["projects"][number];

    const orgId = $derived(page.params.id ?? "");
    const guard = createLatestGuard();

    let org = $state<OrganizationDetails | null>(null);
    let loading = $state(true);
    let error = $state("");

    let showDeleteDialog = $state(false);

    let retentionDays = $state(90);
    let auditRetentionDays = $state<number | "">("");
    let savingRetention = $state(false);
    let retentionError = $state("");

    // Per-project logs (30 days) feed the projects table and the summary tile.
    let projectLogs = $state<Record<string, number> | null>(null);
    let projectLogsLoading = $state(true);

    let activeSection = $state("projects");

    const logs30d = $derived(
        projectLogs ? Object.values(projectLogs).reduce((sum, n) => sum + n, 0) : null,
    );

    const retentionDirty = $derived(
        !!org &&
            (retentionDays !== org.retentionDays ||
                (auditRetentionDays === "" ? null : Number(auditRetentionDays)) !== org.auditRetentionDays),
    );

    async function loadOrganization() {
        const ticket = guard.begin();
        loading = true;
        error = "";
        try {
            const res = await adminAPI.getOrganizationDetails(orgId);
            if (!guard.isCurrent(ticket)) return;
            org = res;
            retentionDays = res.retentionDays || 90;
            auditRetentionDays = res.auditRetentionDays ?? "";
        } catch (err) {
            if (!guard.isCurrent(ticket)) return;
            error = err instanceof Error ? err.message : "Failed to load organization";
            toastStore.error(error);
        } finally {
            if (guard.isCurrent(ticket)) loading = false;
        }
    }

    // Best effort: a failure only leaves the log numbers as a dash.
    async function loadProjectLogs() {
        projectLogsLoading = true;
        const id = orgId;
        try {
            const acc: Record<string, number> = {};
            const MAX_PAGES = 5;
            for (let p = 1; p <= MAX_PAGES; p++) {
                const res = await adminAPI.getProjects({ organizationId: id, page: p, limit: 100 });
                for (const proj of res.projects) acc[proj.id] = proj.logs30d ?? proj.logsCount ?? 0;
                if (p >= (res.totalPages ?? 1)) break;
            }
            if (id === orgId) projectLogs = acc;
        } catch {
            if (id === orgId) projectLogs = null;
        } finally {
            if (id === orgId) projectLogsLoading = false;
        }
    }

    function loadAll() {
        void loadOrganization();
        void loadProjectLogs();
    }

    async function saveRetention() {
        if (!org) return;
        if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
            retentionError = "Log retention must be between 1 and 365 days";
            return;
        }
        const auditVal = auditRetentionDays === "" ? null : Number(auditRetentionDays);
        if (auditVal !== null && (!Number.isInteger(auditVal) || auditVal < 1 || auditVal > 3650)) {
            retentionError = "Audit retention must be between 1 and 3650 days, or empty to keep forever";
            return;
        }

        savingRetention = true;
        retentionError = "";
        try {
            await adminAPI.updateOrganizationRetention(org.id, {
                retentionDays,
                auditRetentionDays: auditVal,
            });
            org = { ...org, retentionDays, auditRetentionDays: auditVal };
            toastStore.success("Retention updated");
        } catch (err) {
            retentionError = err instanceof Error ? err.message : "Failed to update retention";
            toastStore.error(retentionError);
        } finally {
            savingRetention = false;
        }
    }

    async function handleDelete() {
        if (!org) return;
        try {
            await adminAPI.deleteOrganization(org.id);
        } catch (err) {
            toastStore.error(err instanceof Error ? err.message : "Failed to delete organization");
            // Keeps the dialog open and the page as it is.
            throw err;
        }
        toastStore.success(`Organization "${org.name}" deleted`);
        goto("/dashboard/admin/organizations");
    }

    // Section highlight follows the scroll position.
    function updateActive() {
        let current = ORG_NAV_ITEMS[0].id;
        for (const item of ORG_NAV_ITEMS) {
            const el = document.getElementById(item.id);
            if (el && el.getBoundingClientRect().top <= 120) current = item.id;
        }
        const { scrollHeight } = document.documentElement;
        if (scrollHeight > window.innerHeight && window.innerHeight + window.scrollY >= scrollHeight - 2) {
            current = ORG_NAV_ITEMS[ORG_NAV_ITEMS.length - 1].id;
        }
        activeSection = current;
    }

    $effect(() => {
        if (!org) return;
        updateActive();
        window.addEventListener("scroll", updateActive, { passive: true });
        window.addEventListener("resize", updateActive);
        return () => {
            window.removeEventListener("scroll", updateActive);
            window.removeEventListener("resize", updateActive);
        };
    });

    // Loads once the admin check passes, and again when navigating between organizations.
    let loadedFor = "";
    $effect(() => {
        const id = orgId;
        if ($authStore.user?.is_admin !== true || !id || id === loadedFor) return;
        loadedFor = id;
        untrack(loadAll);
    });

    const asCell = (s: unknown) => s as Snippet<[never]>;

    const projectColumns: DataTableColumn<Project>[] = [
        { key: "name", header: "Project", class: "min-w-[10rem]", cell: asCell(projectNameCell) },
        { key: "logs", header: "Logs, 30 days", class: "text-right tabular-nums", cell: asCell(projectLogsCell) },
        { key: "created", header: "Created", class: "whitespace-nowrap", cell: asCell(projectCreatedCell) },
    ];

    const memberColumns: DataTableColumn<Member>[] = [
        { key: "name", header: "Member", class: "min-w-[10rem]", cell: asCell(memberNameCell) },
        { key: "email", header: "Email", class: "hidden md:table-cell", cell: asCell(memberEmailCell) },
        { key: "role", header: "Role", cell: asCell(memberRoleCell) },
        { key: "joined", header: "Joined", class: "whitespace-nowrap", cell: asCell(memberJoinedCell) },
    ];
</script>

<svelte:head>
    <title>{org?.name ?? "Organization"} - LogTide</title>
</svelte:head>

{#snippet projectNameCell(p: Project)}
    <a
        href="/dashboard/admin/projects/{p.id}"
        class="block truncate font-medium hover:text-primary hover:underline underline-offset-4"
    >
        {p.name}
    </a>
{/snippet}

{#snippet projectLogsCell(p: Project)}
    {#if projectLogs && p.id in projectLogs}{formatCount(projectLogs[p.id])}{:else}<span class="text-muted-foreground">-</span>{/if}
{/snippet}

{#snippet projectCreatedCell(p: Project)}<Timestamp value={p.created_at} relative />{/snippet}

{#snippet memberNameCell(m: Member)}
    <a
        href="/dashboard/admin/users/{m.id}"
        class="block truncate font-medium hover:text-primary hover:underline underline-offset-4"
    >
        {m.name || m.email}
    </a>
{/snippet}

{#snippet memberEmailCell(m: Member)}<span class="text-muted-foreground">{m.email}</span>{/snippet}

{#snippet memberRoleCell(m: Member)}
    <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
{/snippet}

{#snippet memberJoinedCell(m: Member)}<Timestamp value={m.created_at} relative />{/snippet}

{#snippet projectMobileRow(p: Project)}
    <div class="space-y-1">
        <a href="/dashboard/admin/projects/{p.id}" class="block truncate font-medium hover:text-primary">{p.name}</a>
        <p class="text-xs text-muted-foreground">
            {#if projectLogs && p.id in projectLogs}{formatCount(projectLogs[p.id])} logs in 30 days{:else}Created <Timestamp value={p.created_at} relative />{/if}
        </p>
    </div>
{/snippet}

{#snippet memberMobileRow(m: Member)}
    <div class="space-y-1">
        <div class="flex items-center justify-between gap-2">
            <a href="/dashboard/admin/users/{m.id}" class="block truncate font-medium hover:text-primary">{m.name || m.email}</a>
            <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
        </div>
        <p class="truncate text-xs text-muted-foreground">{m.email}</p>
    </div>
{/snippet}

<div class="space-y-6">
    <PageHeader
        title={org?.name ?? "Organization"}
        appliesTo="instance"
        breadcrumbs={[
            { label: "Admin", href: "/dashboard/admin" },
            { label: "Organizations", href: "/dashboard/admin/organizations" },
            { label: org?.name ?? "Organization" },
        ]}
    >
        {#snippet meta()}
            {#if org}
                <span class="font-mono text-sm text-muted-foreground">{org.slug}</span>
            {/if}
        {/snippet}
        {#snippet actions()}
            {#if org}
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span class="inline-flex items-center gap-1">
                        ID <span class="font-mono text-xs">{org.id}</span>
                        <CopyButton value={org.id} ariaLabel="Copy organization id" />
                    </span>
                    <span>Created <Timestamp value={org.created_at} precision="minute" /></span>
                </div>
            {/if}
        {/snippet}
    </PageHeader>

    {#if loading && !org}
        <PageSkeleton />
    {:else if error && !org}
        <EmptyState variant="error" title="Could not load organization" description={error}>
            {#snippet actions()}
                <Button onclick={loadAll}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else if org}
        <OrgSummaryTiles
            memberCount={org.members.length}
            projectCount={org.projects.length}
            {logs30d}
            logs30dLoading={projectLogsLoading}
            retentionDays={org.retentionDays}
        />

        <div class="flex flex-col gap-6 md:flex-row md:gap-8">
            <OrgSideNav active={activeSection} />

            <div class="min-w-0 flex-1 space-y-10">
                <div id="projects" class="scroll-mt-24">
                    <SettingsSection title="Projects" description="Projects owned by this organization.">
                        <DataTable
                            columns={projectColumns}
                            rows={org.projects}
                            rowKey={(p) => p.id}
                            mobileRow={asCell(projectMobileRow)}
                        >
                            {#snippet empty()}No projects in this organization.{/snippet}
                        </DataTable>
                    </SettingsSection>
                </div>

                <div id="members" class="scroll-mt-24">
                    <SettingsSection title="Members" description="People with access to this organization.">
                        <DataTable
                            columns={memberColumns}
                            rows={org.members}
                            rowKey={(m) => m.id}
                            mobileRow={asCell(memberMobileRow)}
                        >
                            {#snippet empty()}No members in this organization.{/snippet}
                        </DataTable>
                    </SettingsSection>
                </div>

                <div id="retention" class="scroll-mt-24">
                    <SettingsSection
                        title="Retention"
                        description="How long this organization keeps its data. Log retention and audit retention are separate policies."
                    >
                        <div class="space-y-6">
                            <div class="space-y-2">
                                <Label for="retention-days">Log retention (days)</Label>
                                <Input
                                    id="retention-days"
                                    type="number"
                                    min="1"
                                    max="365"
                                    bind:value={retentionDays}
                                    disabled={savingRetention}
                                    class="w-32"
                                />
                                <p class="text-sm text-muted-foreground">
                                    Logs, traces and metrics older than this are deleted by the daily cleanup. Between 1 and 365 days.
                                </p>
                            </div>
                            <div class="space-y-2">
                                <Label for="audit-retention-days">Audit log retention (days)</Label>
                                <Input
                                    id="audit-retention-days"
                                    type="number"
                                    min="1"
                                    max="3650"
                                    placeholder="Forever"
                                    bind:value={auditRetentionDays}
                                    disabled={savingRetention}
                                    class="w-32"
                                />
                                <p class="text-sm text-muted-foreground">
                                    Applies to the audit trail only. Between 1 and 3,650 days; leave empty to keep it forever.
                                </p>
                            </div>
                            {#if retentionError}
                                <p class="text-sm text-destructive" role="alert">{retentionError}</p>
                            {/if}
                            <Button onclick={saveRetention} disabled={savingRetention || !retentionDirty}>
                                <Save class="mr-2 h-4 w-4" />
                                {savingRetention ? "Saving..." : "Save retention"}
                            </Button>
                        </div>
                    </SettingsSection>
                </div>

                <div id="entitlements" class="scroll-mt-24">
                    <OrgEntitlementsSection {orgId} />
                </div>

                <div id="danger-zone" class="scroll-mt-24">
                    <DangerZone>
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="min-w-0 space-y-1">
                                <p class="text-sm font-medium">Delete this organization</p>
                                <p class="text-sm text-muted-foreground">
                                    Permanently removes its {formatCount(org.members.length)}
                                    {org.members.length === 1 ? "member" : "members"}, {formatCount(org.projects.length)}
                                    {org.projects.length === 1 ? "project" : "projects"} and all their logs and related data.
                                </p>
                            </div>
                            <Button variant="destructive" onclick={() => (showDeleteDialog = true)}>
                                <Trash2 class="mr-2 h-4 w-4" />
                                Delete organization
                            </Button>
                        </div>
                    </DangerZone>
                </div>
            </div>
        </div>
    {/if}
</div>

<ConfirmDialog
    bind:open={showDeleteDialog}
    title="Delete organization"
    description={`This permanently deletes ${org?.members.length ?? 0} member associations, ${org?.projects.length ?? 0} projects with all their data, and all logs and related data. This cannot be undone.`}
    confirmLabel="Delete organization"
    requireText={org?.name ?? ""}
    onConfirm={handleDelete}
/>
