<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { page } from "$app/state";
    import { adminAPI, type OrganizationDetails, type EntitlementMap, type EntitlementUpdate } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import { browser } from "$app/environment";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";
    import { Switch } from "$lib/components/ui/switch";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import {
        Table,
        TableBody,
        TableCell,
        TableHead,
        TableHeader,
        TableRow,
    } from "$lib/components/ui/table";
    import Input from "$lib/components/ui/input/input.svelte";
    import Label from "$lib/components/ui/label/label.svelte";
    import {
        Building2,
        Users,
        FolderKanban,
        Trash2,
        ArrowLeft,
        AlertTriangle,
        Clock,
        Save,
        ShieldCheck,
    } from "@lucide/svelte";
    import {
        AlertDialog,
        AlertDialogAction,
        AlertDialogCancel,
        AlertDialogContent,
        AlertDialogDescription,
        AlertDialogFooter,
        AlertDialogHeader,
        AlertDialogTitle,
    } from "$lib/components/ui/alert-dialog";
    import { goto } from "$app/navigation";

    const orgId = $derived(page.params.id);
    const usersAPI = new UsersAPI(() => get(authStore).token);
    let org: OrganizationDetails | null = $state(null);
    let loading = $state(true);
    let error = $state("");
    let showDeleteDialog = $state(false);
    let deleting = $state(false);
    let retentionDays = $state(90);
    let auditRetentionDays = $state<number | ''>('');
    let savingRetention = $state(false);
    let retentionError = $state("");

    // Entitlements (#214)
    let entitlements = $state<EntitlementMap>({});
    let entitlementsLoading = $state(true);
    let entitlementsError = $state("");
    let savingEntitlements = $state(false);
    // Working copy of numeric caps as strings for the inputs ("" = unlimited / null).
    let limitInputs = $state<Record<string, string>>({});

    async function loadEntitlements() {
        if ($authStore.user?.is_admin !== true) return;

        entitlementsLoading = true;
        entitlementsError = "";
        try {
            const res = await adminAPI.getOrganizationEntitlements(orgId);
            entitlements = res.entitlements;
            const inputs: Record<string, string> = {};
            for (const [cap, val] of Object.entries(entitlements)) {
                if (val.kind === "limit" || val.kind === "quota") {
                    inputs[cap] = val.limit === null ? "" : String(val.limit);
                }
            }
            limitInputs = inputs;
        } catch (err: any) {
            entitlementsError = err.message || "Failed to load entitlements";
        } finally {
            entitlementsLoading = false;
        }
    }

    function booleanCaps(): string[] {
        return Object.keys(entitlements)
            .filter((c) => entitlements[c].kind === "boolean")
            .sort();
    }

    function numericCaps(): string[] {
        return Object.keys(entitlements)
            .filter((c) => {
                const k = entitlements[c].kind;
                return k === "limit" || k === "quota";
            })
            .sort();
    }

    async function saveEntitlements() {
        savingEntitlements = true;
        entitlementsError = "";
        try {
            const updates: EntitlementUpdate[] = [];

            for (const cap of booleanCaps()) {
                const val = entitlements[cap];
                if (val.kind === "boolean") {
                    updates.push({ capability: cap, enabled: val.enabled });
                }
            }

            for (const cap of numericCaps()) {
                const raw = (limitInputs[cap] ?? "").trim();
                let limitValue: number | null;
                if (raw === "") {
                    limitValue = null; // unlimited
                } else {
                    const n = Number(raw);
                    if (!Number.isInteger(n) || n < 0) {
                        entitlementsError = `Invalid value for ${cap}: must be a non-negative integer or empty for unlimited`;
                        savingEntitlements = false;
                        return;
                    }
                    limitValue = n;
                }
                updates.push({ capability: cap, limitValue });
            }

            await adminAPI.updateOrganizationEntitlements(orgId, updates);
            await loadEntitlements(); // refresh from server
        } catch (err: any) {
            entitlementsError = err.message || "Failed to save entitlements";
        } finally {
            savingEntitlements = false;
        }
    }

    async function loadOrganization() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = "";
        try {
            org = await adminAPI.getOrganizationDetails(orgId);
            retentionDays = org.retentionDays || 90;
            auditRetentionDays = org.auditRetentionDays ?? '';
        } catch (err: any) {
            error = err.message || "Failed to load organization";
        } finally {
            loading = false;
        }
    }

    async function saveRetention() {
        if (!org) return;
        if (retentionDays < 1 || retentionDays > 365) {
            retentionError = "Retention must be between 1 and 365 days";
            return;
        }
        const auditVal = auditRetentionDays === '' ? null : Number(auditRetentionDays);
        if (auditVal !== null && (!Number.isInteger(auditVal) || auditVal < 1 || auditVal > 3650)) {
            retentionError = "Audit retention must be between 1 and 3650 days, or empty for keep forever";
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
        } catch (err: any) {
            retentionError = err.message || "Failed to update retention";
        } finally {
            savingRetention = false;
        }
    }

    async function handleDelete() {
        if (!org) return;
        deleting = true;
        try {
            await adminAPI.deleteOrganization(org.id);
            goto("/dashboard/admin/organizations");
        } catch (err: any) {
            error = err.message || "Failed to delete organization";
        } finally {
            deleting = false;
            showDeleteDialog = false;
        }
    }

    function formatDate(dateString: string) {
        return new Date(dateString).toLocaleString('en-US');
    }

    function loadAll() {
        loadOrganization();
        loadEntitlements();
    }

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
                                if (user.is_admin) loadAll();
                            }
                        })
                        .catch(() => goto("/dashboard"));
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => goto("/dashboard"));
            }
        }
    });

    onMount(() => {
        if ($authStore.user?.is_admin) loadAll();
    });
</script>

<svelte:head>
    <title>{org?.name ?? 'Organization'} - Admin - LogTide</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
    <div class="flex items-center gap-4">
        <a
            href="/dashboard/admin/organizations"
            class={buttonVariants({
                variant: "ghost",
                size: "sm",
            })}
        >
            <ArrowLeft class="h-4 w-4 mr-2" />
            Back to Organizations
        </a>
    </div>

    {#if loading}
        <div class="text-center py-12">
            <p class="text-muted-foreground">Loading organization...</p>
        </div>
    {:else if error}
        <div class="text-center py-12">
            <p class="text-destructive">{error}</p>
        </div>
    {:else if org}
        <Card>
            <CardHeader>
                <div class="flex items-start justify-between">
                    <div class="space-y-2">
                        <div class="flex items-center gap-3">
                            <Building2 class="h-8 w-8 text-muted-foreground" />
                            <div>
                                <CardTitle class="text-2xl"
                                    >{org.name}</CardTitle
                                >
                                <CardDescription>@{org.slug}</CardDescription>
                            </div>
                        </div>
                        <div class="flex gap-4 text-sm text-muted-foreground">
                            <span>Created: {formatDate(org.created_at)}</span>
                            <span>Updated: {formatDate(org.updated_at)}</span>
                        </div>
                    </div>
                    <Button
                        variant="destructive"
                        size="sm"
                        onclick={() => (showDeleteDialog = true)}
                    >
                        <Trash2 class="h-4 w-4 mr-2" />
                        Delete Organization
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div class="grid gap-4 md:grid-cols-3">
                    <div class="flex items-center gap-2">
                        <Users class="h-5 w-5 text-muted-foreground" />
                        <span class="font-medium">{org.members.length}</span>
                        <span class="text-muted-foreground">Members</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <FolderKanban class="h-5 w-5 text-muted-foreground" />
                        <span class="font-medium">{org.projects.length}</span>
                        <span class="text-muted-foreground">Projects</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <Clock class="h-5 w-5 text-muted-foreground" />
                        <span class="font-medium">{org.retentionDays}</span>
                        <span class="text-muted-foreground">days retention</span>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Log Retention Policy</CardTitle>
                <CardDescription>
                    Configure how long logs are retained for this organization
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div class="space-y-4">
                    <div class="flex items-end gap-4">
                        <div class="space-y-2">
                            <Label for="retention-days">Retention Period (days)</Label>
                            <Input
                                id="retention-days"
                                type="number"
                                min="1"
                                max="365"
                                bind:value={retentionDays}
                                disabled={savingRetention}
                                class="w-32"
                            />
                        </div>
                        <div class="space-y-2">
                            <Label for="audit-retention-days">Audit Retention (days)</Label>
                            <Input
                                id="audit-retention-days"
                                type="number"
                                min="1"
                                max="3650"
                                placeholder="forever"
                                bind:value={auditRetentionDays}
                                disabled={savingRetention}
                                class="w-32"
                            />
                        </div>
                        <Button
                            onclick={saveRetention}
                            disabled={savingRetention || (retentionDays === org.retentionDays && (auditRetentionDays === '' ? null : Number(auditRetentionDays)) === org.auditRetentionDays)}
                        >
                            <Save class="h-4 w-4 mr-2" />
                            {savingRetention ? "Saving..." : "Save"}
                        </Button>
                    </div>
                    {#if retentionError}
                        <p class="text-sm text-destructive">{retentionError}</p>
                    {/if}
                    <p class="text-sm text-muted-foreground">
                        Logs older than {retentionDays} days will be automatically deleted during the daily cleanup.
                        Valid range: 1-365 days. Audit log retention: 1-3650 days, or empty for keep forever.
                    </p>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <div class="flex items-center gap-2">
                    <ShieldCheck class="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Entitlements</CardTitle>
                </div>
                <CardDescription>
                    Feature gates and usage caps for this organization. Empty cap = unlimited.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {#if entitlementsLoading}
                    <p class="text-muted-foreground text-sm">Loading entitlements...</p>
                {:else}
                    <div class="space-y-6">
                        <!-- Boolean feature gates -->
                        <div class="space-y-3">
                            <h3 class="text-sm font-medium">Feature gates</h3>
                            {#each booleanCaps() as cap}
                                {@const val = entitlements[cap]}
                                {#if val.kind === "boolean"}
                                    <div class="flex items-center justify-between">
                                        <Label for={`ent-${cap}`} class="font-mono text-sm">{cap}</Label>
                                        <Switch
                                            id={`ent-${cap}`}
                                            checked={val.enabled}
                                            onCheckedChange={(checked) => {
                                                entitlements = {
                                                    ...entitlements,
                                                    [cap]: { kind: "boolean", enabled: checked },
                                                };
                                            }}
                                            disabled={savingEntitlements}
                                        />
                                    </div>
                                {/if}
                            {/each}
                        </div>

                        <!-- Numeric limits and quotas -->
                        <div class="space-y-3">
                            <h3 class="text-sm font-medium">Limits & quotas</h3>
                            {#each numericCaps() as cap}
                                <div class="flex items-center justify-between gap-4">
                                    <Label for={`ent-${cap}`} class="font-mono text-sm">{cap}</Label>
                                    <Input
                                        id={`ent-${cap}`}
                                        type="number"
                                        min="0"
                                        placeholder="unlimited"
                                        bind:value={limitInputs[cap]}
                                        disabled={savingEntitlements}
                                        class="w-40"
                                    />
                                </div>
                            {/each}
                        </div>

                        {#if entitlementsError}
                            <p class="text-sm text-destructive">{entitlementsError}</p>
                        {/if}

                        <div class="flex items-center gap-3">
                            <Button onclick={saveEntitlements} disabled={savingEntitlements}>
                                <Save class="h-4 w-4 mr-2" />
                                {savingEntitlements ? "Saving..." : "Save entitlements"}
                            </Button>
                            <p class="text-sm text-muted-foreground">
                                Quota changes take effect on the next evaluator tick (~1 min).
                            </p>
                        </div>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Members</CardTitle>
                <CardDescription
                    >{org.members.length} members in this organization</CardDescription
                >
            </CardHeader>
            <CardContent>
                {#if org.members.length === 0}
                    <p class="text-center text-muted-foreground py-4">
                        No members
                    </p>
                {:else}
                    <div class="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Joined</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {#each org.members as member (member.id)}
                                    <TableRow>
                                        <TableCell class="font-medium"
                                            >{member.name}</TableCell
                                        >
                                        <TableCell>{member.email}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={member.role === "owner"
                                                    ? "default"
                                                    : "secondary"}
                                            >
                                                {member.role}
                                            </Badge>
                                        </TableCell>
                                        <TableCell
                                            class="text-sm text-muted-foreground"
                                        >
                                            {formatDate(member.created_at)}
                                        </TableCell>
                                    </TableRow>
                                {/each}
                            </TableBody>
                        </Table>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Projects</CardTitle>
                <CardDescription
                    >{org.projects.length} projects in this organization</CardDescription
                >
            </CardHeader>
            <CardContent>
                {#if org.projects.length === 0}
                    <p class="text-center text-muted-foreground py-4">
                        No projects
                    </p>
                {:else}
                    <div class="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Created</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {#each org.projects as project (project.id)}
                                    <TableRow>
                                        <TableCell class="font-medium"
                                            >{project.name}</TableCell
                                        >
                                        <TableCell
                                            class="text-sm text-muted-foreground"
                                        >
                                            {formatDate(project.created_at)}
                                        </TableCell>
                                    </TableRow>
                                {/each}
                            </TableBody>
                        </Table>
                    </div>
                {/if}
            </CardContent>
        </Card>

    {/if}
</div>

<AlertDialog bind:open={showDeleteDialog}>
    <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>Delete Organization</AlertDialogTitle>
            <AlertDialogDescription>
                Are you sure you want to delete <strong>{org?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="py-4">
            <div class="bg-destructive/10 border border-destructive/20 rounded-md p-4">
                <p class="text-sm text-destructive font-medium">
                    This will permanently delete:
                </p>
                <ul class="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                    <li>{org?.members.length} member associations</li>
                    <li>{org?.projects.length} projects and all their data</li>
                    <li>All logs and related data</li>
                </ul>
            </div>
        </div>
        <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onclick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete Organization"}
            </AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
</AlertDialog>
