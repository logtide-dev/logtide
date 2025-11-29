<script lang="ts">
    import { onMount } from "svelte";
    import { adminAPI, type UserBasic } from "$lib/api/admin";
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
        UserCheck,
        UserX,
        ChevronLeft,
        ChevronRight,
    } from "lucide-svelte";

    let users: UserBasic[] = $state([]);
    let loading = $state(true);
    let error = $state("");
    let search = $state("");
    let page = $state(1);
    let totalPages = $state(1);
    let total = $state(0);
    const limit = 50;

    async function loadUsers() {
        loading = true;
        error = "";
        try {
            const response = await adminAPI.getUsers(
                page,
                limit,
                search || undefined,
            );
            users = response.users;
            total = response.total;
            totalPages = response.totalPages;
        } catch (err: any) {
            error = err.message || "Failed to load users";
        } finally {
            loading = false;
        }
    }

    function handleSearch() {
        page = 1;
        loadUsers();
    }

    function nextPage() {
        if (page < totalPages) {
            page++;
            loadUsers();
        }
    }

    function prevPage() {
        if (page > 1) {
            page--;
            loadUsers();
        }
    }

    function formatDate(dateString: string | null) {
        if (!dateString) return "Never";
        return new Date(dateString).toLocaleString();
    }

    onMount(() => {
        loadUsers();
    });
</script>

<div class="container mx-auto p-6 space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-bold">User Management</h1>
            <p class="text-muted-foreground">Manage all users in the system</p>
        </div>
    </div>

    <Card>
        <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Total: {total} users</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
            <div class="flex gap-2">
                <div class="relative flex-1">
                    <Search
                        class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    />
                    <Input
                        type="text"
                        placeholder="Search by email or name..."
                        bind:value={search}
                        onkeydown={(e) => e.key === "Enter" && handleSearch()}
                        class="pl-10"
                    />
                </div>
                <Button onclick={handleSearch}>Search</Button>
            </div>

            {#if loading}
                <div class="text-center py-8">
                    <p class="text-muted-foreground">Loading users...</p>
                </div>
            {:else if error}
                <div class="text-center py-8">
                    <p class="text-destructive">{error}</p>
                </div>
            {:else if users.length === 0}
                <div class="text-center py-8">
                    <p class="text-muted-foreground">No users found</p>
                </div>
            {:else}
                <div class="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Last Login</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead class="text-right">Actions</TableHead
                                >
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {#each users as user (user.id)}
                                <TableRow>
                                    <TableCell class="font-medium"
                                        >{user.email}</TableCell
                                    >
                                    <TableCell>{user.name}</TableCell>
                                    <TableCell>
                                        {#if user.disabled}
                                            <Badge
                                                variant="destructive"
                                                class="gap-1"
                                            >
                                                <UserX class="h-3 w-3" />
                                                Disabled
                                            </Badge>
                                        {:else}
                                            <Badge
                                                variant="default"
                                                class="gap-1"
                                            >
                                                <UserCheck class="h-3 w-3" />
                                                Active
                                            </Badge>
                                        {/if}
                                    </TableCell>
                                    <TableCell>
                                        {#if user.is_admin}
                                            <Badge variant="secondary"
                                                >Admin</Badge
                                            >
                                        {:else}
                                            <Badge variant="outline">User</Badge
                                            >
                                        {/if}
                                    </TableCell>
                                    <TableCell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {formatDate(user.last_login)}
                                    </TableCell>
                                    <TableCell
                                        class="text-sm text-muted-foreground"
                                    >
                                        {formatDate(user.created_at)}
                                    </TableCell>
                                    <TableCell class="text-right">
                                        <a
                                            href="/admin/users/{user.id}"
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
            {/if}
        </CardContent>
    </Card>
</div>
