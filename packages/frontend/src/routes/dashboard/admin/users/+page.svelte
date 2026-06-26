<script lang="ts">
    import { onMount } from "svelte";
    import { adminAPI, type UserBasic } from "$lib/api/admin";
    import { SkeletonTable, TableLoadingOverlay } from "$lib/components/ui/skeleton";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import { Badge } from "$lib/components/ui/badge";
    import * as Dialog from "$lib/components/ui/dialog";
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
        UserPlus,
        ChevronLeft,
        ChevronRight,
    } from "@lucide/svelte";
    import { toastStore } from "$lib/stores/toast";
    import { authStore } from "$lib/stores/auth";
    import { goto } from "$app/navigation";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";

    let users: UserBasic[] = $state([]);
    let loading = $state(true);
    let error = $state("");
    let search = $state("");
    let page = $state(1);
    let totalPages = $state(1);
    let total = $state(0);
    const limit = 50;

    let showCreateDialog = $state(false);
    let creating = $state(false);
    let createForm = $state({
        email: "",
        name: "",
        password: "",
        confirmPassword: "",
        is_admin: false,
    });
    let createError = $state("");

    function resetCreateForm() {
        createForm = {
            email: "",
            name: "",
            password: "",
            confirmPassword: "",
            is_admin: false,
        };
        createError = "";
    }

    async function createUser(event?: Event) {
        event?.preventDefault();
        createError = "";

        const email = createForm.email.trim();
        const name = createForm.name.trim();

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            createError = "Please enter a valid email address";
            return;
        }
        if (!name) {
            createError = "Name is required";
            return;
        }
        if (createForm.password.length < 8) {
            createError = "Password must be at least 8 characters long";
            return;
        }
        if (createForm.password !== createForm.confirmPassword) {
            createError = "Passwords do not match";
            return;
        }

        creating = true;
        try {
            await adminAPI.createUser({
                email,
                name,
                password: createForm.password,
                is_admin: createForm.is_admin,
            });
            toastStore.success(`User ${email} created successfully`);
            showCreateDialog = false;
            resetCreateForm();
            page = 1;
            await loadUsers();
        } catch (err: any) {
            createError = err?.message || "Failed to create user";
        } finally {
            creating = false;
        }
    }

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
                                if (user.is_admin) loadUsers();
                            }
                        })
                        .catch(() => goto("/dashboard"));
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => goto("/dashboard"));
            }
        }
    });

    async function loadUsers() {
        if ($authStore.user?.is_admin !== true) return;

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
        return new Date(dateString).toLocaleString('en-US');
    }

    onMount(() => {
        if ($authStore.user?.is_admin) loadUsers();
    });
</script>

<svelte:head>
    <title>Users - Admin - LogTide</title>
</svelte:head>

<div class="container mx-auto p-6 space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-bold">User Management</h1>
            <p class="text-muted-foreground">Manage all users in the system</p>
        </div>
        <Button
            onclick={() => {
                resetCreateForm();
                showCreateDialog = true;
            }}
        >
            <UserPlus class="h-4 w-4 mr-2" />
            Create User
        </Button>
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

            {#if loading && users.length === 0}
                <SkeletonTable rows={8} columns={7} />
            {:else if error}
                <div class="text-center py-8">
                    <p class="text-destructive">{error}</p>
                </div>
            {:else if users.length === 0}
                <div class="text-center py-8">
                    <p class="text-muted-foreground">No users found</p>
                </div>
            {:else}
                <TableLoadingOverlay loading={loading}>
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
                                            href="/dashboard/admin/users/{user.id}"
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
                </TableLoadingOverlay>
            {/if}
        </CardContent>
    </Card>
</div>

<Dialog.Root bind:open={showCreateDialog}>
    <Dialog.Content class="max-w-lg">
        <Dialog.Header>
            <Dialog.Title>Create User</Dialog.Title>
            <Dialog.Description>
                Provision a new user account. Share the credentials with the
                user to let them sign in.
            </Dialog.Description>
        </Dialog.Header>
        <form onsubmit={createUser}>
            <div class="space-y-4 py-4">
                <div class="space-y-2">
                    <Label for="create-user-email">Email</Label>
                    <Input
                        id="create-user-email"
                        type="email"
                        placeholder="user@example.com"
                        bind:value={createForm.email}
                        disabled={creating}
                        autocomplete="off"
                    />
                </div>
                <div class="space-y-2">
                    <Label for="create-user-name">Name</Label>
                    <Input
                        id="create-user-name"
                        type="text"
                        placeholder="Full name"
                        bind:value={createForm.name}
                        disabled={creating}
                        autocomplete="off"
                    />
                </div>
                <div class="space-y-2">
                    <Label for="create-user-password">Password</Label>
                    <Input
                        id="create-user-password"
                        type="password"
                        placeholder="Minimum 8 characters"
                        bind:value={createForm.password}
                        disabled={creating}
                        autocomplete="new-password"
                    />
                </div>
                <div class="space-y-2">
                    <Label for="create-user-confirm">Confirm password</Label>
                    <Input
                        id="create-user-confirm"
                        type="password"
                        placeholder="Re-enter password"
                        bind:value={createForm.confirmPassword}
                        disabled={creating}
                        autocomplete="new-password"
                    />
                </div>
                <div class="flex items-center justify-between">
                    <div>
                        <Label for="create-user-admin">Admin access</Label>
                        <p class="text-xs text-muted-foreground">
                            Grants full access to admin settings.
                        </p>
                    </div>
                    <Switch
                        id="create-user-admin"
                        bind:checked={createForm.is_admin}
                        disabled={creating}
                    />
                </div>
                {#if createError}
                    <p class="text-sm text-destructive">{createError}</p>
                {/if}
            </div>
            <Dialog.Footer>
                <Button
                    type="button"
                    variant="outline"
                    disabled={creating}
                    onclick={() => {
                        showCreateDialog = false;
                        resetCreateForm();
                    }}
                >
                    Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                    {creating ? "Creating..." : "Create User"}
                </Button>
            </Dialog.Footer>
        </form>
    </Dialog.Content>
</Dialog.Root>
