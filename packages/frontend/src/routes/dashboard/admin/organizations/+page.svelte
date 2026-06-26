<script lang="ts">
    import { onMount } from "svelte";
    import { adminAPI, type OrganizationBasic } from "$lib/api/admin";
    import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
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
        Search,
        Building2,
        Users,
        FolderKanban,
        ChevronLeft,
        ChevronRight,
    } from "@lucide/svelte";
    import { authStore } from "$lib/stores/auth";
    import { goto } from "$app/navigation";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";

    let organizations: OrganizationBasic[] = $state([]);
    let loading = $state(true);
    let error = $state("");
    let search = $state("");
    let page = $state(1);
    let totalPages = $state(1);
    let total = $state(0);
    const limit = 50;

    const usersAPI = new UsersAPI(() => get(authStore).token);

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
                                if (user.is_admin) loadOrganizations();
                            }
                        })
                        .catch(() => goto("/dashboard"));
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => goto("/dashboard"));
            }
        }
    });

    async function loadOrganizations() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = "";
        try {
            const response = await adminAPI.getOrganizations(
                page,
                limit,
                search || undefined,
            );
            organizations = response.organizations;
            total = response.total;
            totalPages = response.totalPages;
        } catch (err: any) {
            error = err.message || "Failed to load organizations";
        } finally {
            loading = false;
        }
    }

    function handleSearch() {
        page = 1;
        loadOrganizations();
    }

    function nextPage() {
        if (page < totalPages) {
            page++;
            loadOrganizations();
        }
    }

    function prevPage() {
        if (page > 1) {
            page--;
            loadOrganizations();
        }
    }

    function formatDate(dateString: string | Date) {
        const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
        return date.toLocaleString('en-US');
    }

    onMount(() => {
        if ($authStore.user?.is_admin) loadOrganizations();
    });
</script>

<svelte:head>
    <title>Organizations - Admin - LogTide</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-bold">Organization Management</h1>
            <p class="text-muted-foreground">
                Manage all organizations in the system
            </p>
        </div>
    </div>

    <Card>
        <CardHeader>
            <CardTitle>Organizations</CardTitle>
            <CardDescription>Total: {total} organizations</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
            <div class="flex gap-2">
                <div class="relative flex-1">
                    <Search
                        class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    />
                    <Input
                        type="text"
                        placeholder="Search by name or slug..."
                        bind:value={search}
                        onkeydown={(e) => e.key === "Enter" && handleSearch()}
                        class="pl-10"
                    />
                </div>
                <Button onclick={handleSearch}>Search</Button>
            </div>

            {#if loading && organizations.length === 0}
                <SkeletonTable rows={6} columns={6} />
            {:else if error}
                <div class="text-center py-8">
                    <p class="text-destructive">{error}</p>
                </div>
            {:else if organizations.length === 0}
                <div class="text-center py-8">
                    <p class="text-muted-foreground">No organizations found</p>
                </div>
            {:else}
                <TableLoadingOverlay loading={loading}>
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Members</TableHead>
                                <TableHead>Projects</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead class="text-right">Actions</TableHead
                                >
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#each organizations as org (org.id)}
                                <TableRow>
                                    <TableCell class="font-medium">
                                        <div class="flex items-center gap-2">
                                            <Building2
                                                class="h-4 w-4 text-muted-foreground"
                                            />
                                            {org.name}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <code class="text-sm">@{org.slug}</code>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" class="gap-1">
                                            <Users class="h-3 w-3" />
                                            {org.memberCount}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" class="gap-1">
                                            <FolderKanban class="h-3 w-3" />
                                            {org.projectCount}
                                        </Badge>
                                    </TableCell>
                                    <TableCell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {formatDate(org.created_at)}
                                    </TableCell>
                                    <TableCell class="text-right">
                                        <a
                                            href="/dashboard/admin/organizations/{org.id}"
                                            class={buttonVariants({
                                                variant: "ghost",
                                                size: "sm",
                                            })}
                                        >
                                            View Details
                                        </a>
                                    </TableCell>
                                </TableRow>
                            {/each}
                        </TableBody>
                    </Table>
                </div>

                <!-- Pagination -->
                <div class="flex items-center justify-between">
                    <p class="text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                    </p>
                    <div class="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onclick={prevPage}
                            disabled={page === 1}
                        >
                            <ChevronLeft class="h-4 w-4 mr-1" />
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onclick={nextPage}
                            disabled={page === totalPages}
                        >
                            Next
                            <ChevronRight class="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                </div>
                </TableLoadingOverlay>
            {/if}
        </CardContent>
    </Card>
</div>
