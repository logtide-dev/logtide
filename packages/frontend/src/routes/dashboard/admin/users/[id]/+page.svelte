<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { adminAPI, type UserDetails } from "$lib/api/admin";
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
    import {
        ArrowLeft,
        UserCheck,
        UserX,
        Shield,
        Mail,
        Calendar,
        Building2,
        Key,
        Ban,
        CheckCircle,
    } from "lucide-svelte";

    const userId = $derived($page.params.id);

    let user: UserDetails | null = $state(null);
    let loading = $state(true);
    let error = $state("");
    let actionLoading = $state(false);

    let showDisableDialog = $state(false);
    let showEnableDialog = $state(false);
    let showResetPasswordDialog = $state(false);
    let newPassword = $state("");
    let confirmPassword = $state("");
    let passwordError = $state("");

    async function loadUser() {
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
            toastStore.success(
                "Password reset successfully. User will need to log in again.",
            );
        } catch (err: any) {
            passwordError = err.message || "Failed to reset password";
        } finally {
            actionLoading = false;
        }
    }

    function formatDate(dateString: string | null) {
        if (!dateString) return "Never";
        return new Date(dateString).toLocaleString();
    }

    onMount(() => {
        loadUser();
    });
</script>

<div class="container mx-auto p-6 space-y-6">
    <div class="flex items-center gap-4">
        <a
            href="/admin/users"
            class={buttonVariants({
                variant: "ghost",
                size: "icon",
            })}
        >
            <ArrowLeft class="h-4 w-4" />
        </a>
        <div class="flex-1">
            <h1 class="text-3xl font-bold">User Details</h1>
            <p class="text-muted-foreground">
                View and manage user information
            </p>
        </div>
    </div>

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
                        href="/admin/users"
                        class={buttonVariants({
                            variant: "outline",
                        }) + " mt-4"}
                    >
                        Back to Users
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
                                Enable User
                            </Button>
                        {:else}
                            <Button
                                variant="destructive"
                                class="w-full gap-2"
                                onclick={() => (showDisableDialog = true)}
                            >
                                <Ban class="h-4 w-4" />
                                Disable User
                            </Button>
                        {/if}

                        <Separator />

                        <Button
                            variant="outline"
                            class="w-full gap-2"
                            onclick={() => (showResetPasswordDialog = true)}
                        >
                            <Key class="h-4 w-4" />
                            Reset Password
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

<AlertDialog bind:open={showDisableDialog}>
    <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>Disable User</AlertDialogTitle>
            <AlertDialogDescription>
                Are you sure you want to disable this user? They will be
                immediately logged out and won't be able to log in again until
                re-enabled.
            </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onclick={disableUser} disabled={actionLoading}>
                {actionLoading ? "Disabling..." : "Disable User"}
            </AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
</AlertDialog>

<AlertDialog bind:open={showEnableDialog}>
    <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>Enable User</AlertDialogTitle>
            <AlertDialogDescription>
                Are you sure you want to enable this user? They will be able to
                log in again.
            </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onclick={enableUser} disabled={actionLoading}>
                {actionLoading ? "Enabling..." : "Enable User"}
            </AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
</AlertDialog>

<AlertDialog bind:open={showResetPasswordDialog}>
    <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>Reset Password</AlertDialogTitle>
            <AlertDialogDescription>
                Set a new password for this user. They will be logged out of all
                sessions.
            </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="space-y-4 py-4">
            <div class="space-y-2">
                <Label for="new-password">New Password</Label>
                <Input
                    id="new-password"
                    type="password"
                    placeholder="Enter new password"
                    bind:value={newPassword}
                    disabled={actionLoading}
                />
            </div>
            <div class="space-y-2">
                <Label for="confirm-password">Confirm Password</Label>
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
        <AlertDialogFooter>
            <AlertDialogCancel
                onclick={() => {
                    newPassword = "";
                    confirmPassword = "";
                    passwordError = "";
                }}
            >
                Cancel
            </AlertDialogCancel>
            <AlertDialogAction onclick={resetPassword} disabled={actionLoading}>
                {actionLoading ? "Resetting..." : "Reset Password"}
            </AlertDialogAction>
        </AlertDialogFooter>
    </AlertDialogContent>
</AlertDialog>
