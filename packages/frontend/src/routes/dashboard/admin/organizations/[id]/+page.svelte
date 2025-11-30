<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { adminAPI, type OrganizationDetails } from "$lib/api/admin";
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
    import {
        Building2,
        Users,
        FolderKanban,
        Trash2,
        ArrowLeft,
        AlertTriangle,
    } from "lucide-svelte";

    const orgId = $derived($page.params.id);
    let org: OrganizationDetails | null = $state(null);
    let loading = $state(true);
    let error = $state("");
    let showDeleteDialog = $state(false);
    let deleting = $state(false);

    async function loadOrganization() {
        loading = true;
        error = "";
        try {
            org = await adminAPI.getOrganizationDetails(orgId);
        } catch (err: any) {
            error = err.message || "Failed to load organization";
        } finally {
            loading = false;
        }
    }

    async function handleDelete() {
        if (!org) return;
        deleting = true;
        try {
            await adminAPI.deleteOrganization(org.id);
            window.location.href = "/admin/organizations";
        } catch (err: any) {
            error = err.message || "Failed to delete organization";
        } finally {
            deleting = false;
            showDeleteDialog = false;
        }
    }

    function formatDate(dateString: string) {
        return new Date(dateString).toLocaleString();
    }

    onMount(() => {
        loadOrganization();
    });
</script>

<div class="container mx-auto p-6 space-y-6">
    <div class="flex items-center gap-4">
        <a
            href="/admin/organizations"
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
                <div class="grid gap-4 md:grid-cols-2">
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
                </div>
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

        {#if showDeleteDialog}
            <div
                class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            >
                <Card class="w-full max-w-md">
                    <CardHeader>
                        <div class="flex items-center gap-2 text-destructive">
                            <AlertTriangle class="h-5 w-5" />
                            <CardTitle>Delete Organization</CardTitle>
                        </div>
                        <CardDescription>
                            Are you sure you want to delete <strong
                                >{org.name}</strong
                            >?
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div
                            class="bg-destructive/10 border border-destructive/20 rounded-md p-4"
                        >
                            <p class="text-sm text-destructive font-medium">
                                Warning: This action cannot be undone!
                            </p>
                            <p class="text-sm text-muted-foreground mt-2">
                                This will permanently delete:
                            </p>
                            <ul
                                class="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside"
                            >
                                <li>
                                    {org.members.length} member associations
                                </li>
                                <li>
                                    {org.projects.length} projects and all their
                                    data
                                </li>
                                <li>All logs and related data</li>
                            </ul>
                        </div>
                        <div class="flex gap-2 justify-end">
                            <Button
                                variant="outline"
                                onclick={() => (showDeleteDialog = false)}
                                disabled={deleting}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                onclick={handleDelete}
                                disabled={deleting}
                            >
                                {deleting
                                    ? "Deleting..."
                                    : "Delete Organization"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        {/if}
    {/if}
</div>
