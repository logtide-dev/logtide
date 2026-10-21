<script lang="ts">
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import { onMount, untrack } from "svelte";
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { browser } from "$app/environment";
    import { get } from "svelte/store";
    import { adminAPI, type UserDetails } from "$lib/api/admin";
    import { UsersAPI } from "$lib/api/users";
    import { toastStore } from "$lib/stores/toast";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Separator } from "$lib/components/ui/separator";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import * as Dialog from "$lib/components/ui/dialog";
    import {
        ArrowLeft,
        UserCheck,
        UserX,
        Shield,
        ShieldOff,
        Mail,
        Calendar,
        Building2,
        Key,
        Ban,
        CheckCircle,
    } from "@lucide/svelte";
    import { authStore } from "$lib/stores/auth";

    const userId = $derived(page.params.id);

    let user: UserDetails | null = $state(null);
    let loading = $state(true);
    let error = $state("");
    let actionLoading = $state(false);

    let showDisableDialog = $state(false);
    let showEnableDialog = $state(false);
    let showResetPasswordDialog = $state(false);
    let showPromoteAdminDialog = $state(false);
    let showDemoteAdminDialog = $state(false);
    let newPassword = $state("");
    let confirmPassword = $state("");
    let passwordError = $state("");

    // Check if current user is looking at their own profile
    const isOwnProfile = $derived($authStore.user?.id === userId);

    const usersAPI = new UsersAPI(() => get(authStore).token);

    $effect(() => {
        if (browser && $authStore.user) {
            if ($authStore.user.is_admin === undefined) {
                untrack(() => {
                    usersAPI
                        .getCurrentUser()
                        .then(({ user: current }) => {
                            const currentUser = get(authStore).user;
                            if (currentUser) {
                                authStore.updateUser({
                                    ...currentUser,
                                    ...current,
                                });
                                if (current.is_admin) loadUser();
                            }
                        })
                        .catch(() => goto("/dashboard"));
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => goto("/dashboard"));
            }
        }
    });

    async function loadUser() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = "";
        try {
            user = await adminAPI.getUserDetails(userId);
        } catch (err: any) {
            error = err.message || "Failed to load user details";
        } finally {
            loading = false;
        }
    }

    async function disableUser() {
        if (!user) return;
        actionLoading = true;
        try {
            await adminAPI.updateUserStatus(user.id, true);
            showDisableDialog = false;
            await loadUser();
        } catch (err: any) {
            error = err.message || "Failed to disable user";
            throw err;
        } finally {
            actionLoading = false;
        }
    }

    async function enableUser() {
        if (!user) return;
        actionLoading = true;
        try {
            await adminAPI.updateUserStatus(user.id, false);
            showEnableDialog = false;
            await loadUser();
        } catch (err: any) {
            error = err.message || "Failed to enable user";
            throw err;
        } finally {
            actionLoading = false;
        }
    }

    async function promoteToAdmin() {
        if (!user) return;
        actionLoading = true;
        try {
            await adminAPI.updateUserRole(user.id, true);
            showPromoteAdminDialog = false;
            toastStore.success("User promoted to admin");
            await loadUser();
        } catch (err: any) {
            error = err.message || "Failed to promote user to admin";
            throw err;
        } finally {
            actionLoading = false;
        }
    }

    async function demoteFromAdmin() {
        if (!user) return;
        actionLoading = true;
        try {
            await adminAPI.updateUserRole(user.id, false);
            showDemoteAdminDialog = false;
            toastStore.success("Admin role removed from user");
            await loadUser();
        } catch (err: any) {
            error = err.message || "Failed to remove admin role";
            throw err;
        } finally {
            actionLoading = false;
        }
    }

    async function resetPassword() {
        if (!user) return;

        passwordError = "";

        if (newPassword.length < 8) {
            passwordError = "Password must be at least 8 characters";
            return;
        }

        if (newPassword !== confirmPassword) {
            passwordError = "Passwords do not match";
            return;
        }

        actionLoading = true;
        try {
            await adminAPI.resetUserPassword(user.id, newPassword);
            showResetPasswordDialog = false;
            newPassword = "";
            confirmPassword = "";
            toastStore.success("Password reset. The user will need to log in again");
        } catch (err: any) {
            passwordError = err.message || "Failed to reset password";
        } finally {
            actionLoading = false;
        }
    }

    function formatDate(dateString: string | null) {
        if (!dateString) return "Never";
        return new Date(dateString).toLocaleString('en-US');
    }

    onMount(() => {
        if ($authStore.user?.is_admin) loadUser();
    });
</script>

<svelte:head>
    <title>{user?.name ?? user?.email ?? 'User'} - LogTide</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        title={user?.name ?? user?.email ?? 'User'}
        appliesTo="instance"
        description="View and manage user information"
        breadcrumbs={[
            { label: 'All users', href: '/dashboard/admin/users' },
            { label: user?.name ?? user?.email ?? 'User' },
        ]}
    />

    {#if loading}
        <div class="text-center py-12">
            <p class="text-muted-foreground">Loading user details...</p>
        </div>
    {:else if error && !user}
        <Card>
            <CardContent class="py-12">
                <div class="text-center">
                    <p class="text-destructive">{error}</p>
                    <a
                        href="/dashboard/admin/users"
                        class={buttonVariants({
                            variant: "outline",
                        }) + " mt-4"}
                    >
                        Back to all users
                    </a>
                </div>
            </CardContent>
        </Card>
    {:else if user}
        <div class="grid gap-6 md:grid-cols-3">
            <div class="md:col-span-2 space-y-6">
                <Card>
                    <CardHeader>
                        <div class="flex items-center justify-between">
                            <div>
                                <CardTitle>User Information</CardTitle>
                                <CardDescription
                                    >Basic user details and status</CardDescription
                                >
                            </div>
                            <div class="flex gap-2">
                                {#if user.disabled}
                                    <Badge variant="destructive" class="gap-1">
                                        <UserX class="h-3 w-3" />
                                        Disabled
                                    </Badge>
                                {:else}
                                    <Badge variant="default" class="gap-1">
                                        <UserCheck class="h-3 w-3" />
                                        Active
                                    </Badge>
                                {/if}
                                {#if user.is_admin}
                                    <Badge variant="secondary" class="gap-1">
                                        <Shield class="h-3 w-3" />
                                        Admin
                                    </Badge>
                                {/if}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="grid gap-4 md:grid-cols-2">
                            <div class="space-y-2">
                                <Label
                                    class="text-muted-foreground flex items-center gap-2"
                                >
                                    <Mail class="h-4 w-4" />
                                    Email
                                </Label>
                                <p class="font-medium">{user.email}</p>
                            </div>
                            <div class="space-y-2">
                                <Label class="text-muted-foreground">Name</Label
                                >
                                <p class="font-medium">{user.name}</p>
                            </div>
                            <div class="space-y-2">
                                <Label
                                    class="text-muted-foreground flex items-center gap-2"
                                >
                                    <Calendar class="h-4 w-4" />
                                    Created
                                </Label>
                                <p class="text-sm">
                                    {formatDate(user.created_at)}
                                </p>
                            </div>
                            <div class="space-y-2">
                                <Label class="text-muted-foreground"
                                    >Last Login</Label
                                >
                                <p class="text-sm">
                                    {formatDate(user.last_login)}
                                </p>
                            </div>
                            <div class="space-y-2">
                                <Label class="text-muted-foreground"
                                    >Last Updated</Label
                                >
                                <p class="text-sm">
                                    {formatDate(user.updated_at)}
                                </p>
                            </div>
                            <div class="space-y-2">
                                <Label class="text-muted-foreground"
                                    >Active Sessions</Label
                                >
                                <p class="font-medium">{user.activeSessions}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <Building2 class="h-5 w-5" />
                            Organizations
                        </CardTitle>
                        <CardDescription
                            >Organizations this user belongs to</CardDescription
                        >
                    </CardHeader>
                    <CardContent>
                        {#if user.organizations.length === 0}
                            <p class="text-muted-foreground text-center py-4">
                                No organizations
                            </p>
                        {:else}
                            <div class="space-y-3">
                                {#each user.organizations as org}
                                    <div
                                        class="flex items-center justify-between p-3 border rounded-lg"
                                    >
                                        <div>
                                            <p class="font-medium">
                                                {org.name}
                                            </p>
                                            <p
                                                class="text-sm text-muted-foreground"
                                            >
                                                @{org.slug}
                                            </p>
                                        </div>
                                        <div class="text-right">
                                            <Badge variant="outline"
                                                >{org.role}</Badge
                                            >
                                            <p
                                                class="text-xs text-muted-foreground mt-1"
                                            >
                                                Joined {formatDate(
                                                    org.created_at,
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </CardContent>
                </Card>
            </div>

            <div class="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Actions</CardTitle>
                        <CardDescription>Manage user account</CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-3">
                        {#if user.disabled}
                            <Button
                                variant="default"
                                class="w-full gap-2"
                                onclick={() => (showEnableDialog = true)}
                            >
                                <CheckCircle class="h-4 w-4" />
                                Enable user
                            </Button>
                        {:else}
                            <Button
                                variant="destructive"
                                class="w-full gap-2"
                                onclick={() => (showDisableDialog = true)}
                            >
                                <Ban class="h-4 w-4" />
                                Disable user
                            </Button>
                        {/if}

                        <Separator />

                        {#if user.is_admin}
                            <Button
                                variant="outline"
                                class="w-full gap-2"
                                onclick={() => (showDemoteAdminDialog = true)}
                                disabled={isOwnProfile}
                                title={isOwnProfile ? "You cannot remove the admin role from yourself" : ""}
                            >
                                <ShieldOff class="h-4 w-4" />
                                Remove admin role
                            </Button>
                        {:else}
                            <Button
                                variant="outline"
                                class="w-full gap-2"
                                onclick={() => (showPromoteAdminDialog = true)}
                            >
                                <Shield class="h-4 w-4" />
                                Promote to admin
                            </Button>
                        {/if}

                        <Separator />

                        <Button
                            variant="outline"
                            class="w-full gap-2"
                            onclick={() => (showResetPasswordDialog = true)}
                        >
                            <Key class="h-4 w-4" />
                            Reset password
                        </Button>
                    </CardContent>
                </Card>

                {#if error}
                    <Card class="border-destructive">
                        <CardContent class="pt-6">
                            <p class="text-sm text-destructive">{error}</p>
                        </CardContent>
                    </Card>
                {/if}
            </div>
        </div>
    {/if}
</div>

<ConfirmDialog
    bind:open={showDisableDialog}
    title="Disable user"
    description="They will be logged out immediately and cannot log in again until the account is re-enabled."
    confirmLabel="Disable user"
    busy={actionLoading}
    onConfirm={disableUser}
/>

<ConfirmDialog
    bind:open={showEnableDialog}
    title="Enable user"
    description="They will be able to log in again."
    confirmLabel="Enable user"
    destructive={false}
    busy={actionLoading}
    onConfirm={enableUser}
/>

<Dialog.Root bind:open={showResetPasswordDialog}>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>Reset password</Dialog.Title>
            <Dialog.Description>
                Set a new password for this user. They will be logged out of all
                sessions.
            </Dialog.Description>
        </Dialog.Header>
        <div class="space-y-4 py-4">
            <div class="space-y-2">
                <Label for="new-password">New password</Label>
                <Input
                    id="new-password"
                    type="password"
                    placeholder="Enter new password"
                    bind:value={newPassword}
                    disabled={actionLoading}
                />
            </div>
            <div class="space-y-2">
                <Label for="confirm-password">Confirm password</Label>
                <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Confirm new password"
                    bind:value={confirmPassword}
                    disabled={actionLoading}
                />
            </div>
            {#if passwordError}
                <p class="text-sm text-destructive">{passwordError}</p>
            {/if}
        </div>
        <Dialog.Footer>
            <Button
                variant="outline"
                disabled={actionLoading}
                onclick={() => {
                    showResetPasswordDialog = false;
                    newPassword = "";
                    confirmPassword = "";
                    passwordError = "";
                }}
            >
                Cancel
            </Button>
            <Button variant="destructive" onclick={resetPassword} disabled={actionLoading}>
                {actionLoading ? "Resetting..." : "Reset password"}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
    bind:open={showPromoteAdminDialog}
    title="Promote to admin"
    description="This user will get full access to instance settings, user management and all organizations."
    confirmLabel="Promote to admin"
    destructive={false}
    busy={actionLoading}
    onConfirm={promoteToAdmin}
/>

<ConfirmDialog
    bind:open={showDemoteAdminDialog}
    title="Remove admin role"
    description="This user will lose access to instance settings and user management."
    confirmLabel="Remove admin role"
    busy={actionLoading}
    onConfirm={demoteFromAdmin}
/>
