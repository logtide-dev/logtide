<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { page } from "$app/state";
    import { adminAPI, type UserDetails } from "$lib/api/admin";
    import { toastStore } from "$lib/stores/toast";
    import { authStore } from "$lib/stores/auth";
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import SettingsSection from "$lib/components/app/SettingsSection.svelte";
    import DangerZone from "$lib/components/app/DangerZone.svelte";
    import CopyButton from "$lib/components/app/CopyButton.svelte";
    import Timestamp from "$lib/components/app/Timestamp.svelte";
    import SeverityBadge from "$lib/components/app/SeverityBadge.svelte";
    import DataTable from "$lib/components/app/DataTable.svelte";
    import type { DataTableColumn } from "$lib/components/app/data-table";
    import { generatePassword } from "$lib/components/admin/admin-list-url";
    import { Shield, ShieldOff, Key } from "@lucide/svelte";
    import { formatCount } from "$lib/utils/format-number";

    type Membership = UserDetails["organizations"][number];

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
    let showPassword = $state(false);

    const isOwnProfile = $derived($authStore.user?.id === userId);

    let requestId = 0;

    /** First load shows skeletons; later refreshes keep the page and swap data in place. */
    async function loadUser() {
        const id = ++requestId;
        if (!user) loading = true;
        error = "";
        try {
            const result = await adminAPI.getUserDetails(userId);
            if (id !== requestId) return;
            user = result;
        } catch (err: any) {
            if (id !== requestId) return;
            error = err?.message || "Failed to load user details";
            if (user) toastStore.error(error);
        } finally {
            if (id === requestId) loading = false;
        }
    }

    $effect(() => {
        void userId;
        untrack(() => {
            user = null;
            loadUser();
        });
    });

    /** Runs a mutation, toasts backend messages (409 lockout guards included) and rethrows. */
    async function mutate(fn: () => Promise<unknown>, success: string, fallback: string) {
        actionLoading = true;
        try {
            await fn();
            toastStore.success(success);
            await loadUser();
        } catch (err: any) {
            toastStore.error(err?.message || fallback);
            throw err;
        } finally {
            actionLoading = false;
        }
    }

    const disableUser = () =>
        mutate(() => adminAPI.updateUserStatus(user!.id, true), "User disabled", "Failed to disable user");
    const enableUser = () =>
        mutate(() => adminAPI.updateUserStatus(user!.id, false), "User enabled", "Failed to enable user");
    const promoteToAdmin = () =>
        mutate(() => adminAPI.updateUserRole(user!.id, true), "User promoted to admin", "Failed to promote user");
    const demoteFromAdmin = () =>
        mutate(() => adminAPI.updateUserRole(user!.id, false), "Admin role removed", "Failed to remove admin role");

    function closeResetDialog() {
        showResetPasswordDialog = false;
        newPassword = "";
        confirmPassword = "";
        passwordError = "";
        showPassword = false;
    }

    function fillGeneratedPassword() {
        const password = generatePassword(16);
        newPassword = password;
        confirmPassword = password;
        showPassword = true;
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
            closeResetDialog();
            toastStore.success("Password reset. The user will need to log in again");
        } catch (err: any) {
            passwordError = err?.message || "Failed to reset password";
            toastStore.error(passwordError);
        } finally {
            actionLoading = false;
        }
    }

    const asCell = (s: unknown) => s as Snippet<[Membership]>;

    const orgColumns: DataTableColumn<Membership>[] = [
        { key: "name", header: "Organization", class: "min-w-[12rem]", cell: asCell(orgCell) },
        { key: "role", header: "Role", cell: asCell(roleCell) },
        { key: "joined", header: "Joined", class: "whitespace-nowrap", cell: asCell(joinedCell) },
    ];

    const displayName = $derived(user?.name || user?.email || "User");
</script>

<svelte:head>
    <title>{user?.email ?? "User"} - LogTide</title>
</svelte:head>

{#snippet orgCell(o: Membership)}
    <a
        href="/dashboard/admin/organizations/{o.id}"
        class="font-medium underline-offset-4 hover:text-primary hover:underline"
    >
        {o.name}
    </a>
    <p class="text-xs text-muted-foreground">{o.slug}</p>
{/snippet}

{#snippet roleCell(o: Membership)}
    <Badge variant="outline">{o.role}</Badge>
{/snippet}

{#snippet joinedCell(o: Membership)}
    <span class="text-muted-foreground"><Timestamp value={o.created_at} precision="minute" /></span>
{/snippet}

<div class="space-y-6">
    <PageHeader
        title={user ? displayName : "User"}
        appliesTo="instance"
        breadcrumbs={[
            { label: "Admin", href: "/dashboard/admin" },
            { label: "Users", href: "/dashboard/admin/users" },
            { label: user?.email ?? "User" },
        ]}
    >
        {#snippet meta()}
            {#if user}
                <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <SeverityBadge kind="state" value={user.disabled ? "disabled" : "active"} />
                    <Badge variant={user.is_admin ? "secondary" : "outline"}>{user.is_admin ? "Admin" : "User"}</Badge>
                    <span class="inline-flex items-center gap-1">
                        <span class="font-mono text-xs">{user.id}</span>
                        <CopyButton value={user.id} label="Copy user ID" />
                    </span>
                </div>
            {/if}
        {/snippet}
    </PageHeader>

    {#if loading && !user}
        <div class="space-y-4" aria-busy="true">
            <Skeleton height="10rem" width="100%" />
            <Skeleton height="8rem" width="100%" />
        </div>
    {:else if error && !user}
        <EmptyState variant="error" title="Could not load this user" description={error}>
            {#snippet actions()}
                <Button variant="outline" size="sm" onclick={loadUser}>Retry</Button>
                <a href="/dashboard/admin/users" class={buttonVariants({ variant: "outline", size: "sm" })}>
                    Back to users
                </a>
            {/snippet}
        </EmptyState>
    {:else if user}
        <SettingsSection title="Profile" description="Account details and activity">
            <dl class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div>
                    <dt class="text-sm text-muted-foreground">Email</dt>
                    <dd class="font-medium break-all">{user.email}</dd>
                </div>
                <div>
                    <dt class="text-sm text-muted-foreground">Name</dt>
                    <dd class="font-medium">{user.name || "-"}</dd>
                </div>
                <div>
                    <dt class="text-sm text-muted-foreground">Created</dt>
                    <dd><Timestamp value={user.created_at} precision="minute" /></dd>
                </div>
                <div>
                    <dt class="text-sm text-muted-foreground">Last login</dt>
                    <dd>
                        {#if user.last_login}
                            <Timestamp value={user.last_login} relative />
                        {:else}
                            <span class="text-muted-foreground">Never</span>
                        {/if}
                    </dd>
                </div>
                <div>
                    <dt class="text-sm text-muted-foreground">Last updated</dt>
                    <dd><Timestamp value={user.updated_at} precision="minute" /></dd>
                </div>
                <div>
                    <dt class="text-sm text-muted-foreground">Active sessions</dt>
                    <dd class="font-medium tabular-nums">{formatCount(user.activeSessions)}</dd>
                </div>
            </dl>
        </SettingsSection>

        <SettingsSection
            title="Organizations"
            description="Organizations this user belongs to"
        >
            <DataTable columns={orgColumns} rows={user.organizations} rowKey={(o) => o.id}>
                {#snippet empty()}
                    <EmptyState variant="no-data" title="No organizations" description="This user is not a member of any organization." />
                {/snippet}
            </DataTable>
        </SettingsSection>

        <SettingsSection
            title="Role"
            description={user.is_admin
                ? "This user is an instance admin with full access to instance settings, users and organizations."
                : "Promote this user to instance admin to give them full access to instance settings."}
        >
            <div class="flex flex-wrap items-center gap-3">
                {#if user.is_admin}
                    <Button
                        variant="outline"
                        class="gap-2"
                        onclick={() => (showDemoteAdminDialog = true)}
                        disabled={isOwnProfile}
                    >
                        <ShieldOff class="h-4 w-4" />
                        Remove admin role
                    </Button>
                {:else}
                    <Button variant="outline" class="gap-2" onclick={() => (showPromoteAdminDialog = true)}>
                        <Shield class="h-4 w-4" />
                        Promote to admin
                    </Button>
                {/if}
                {#if isOwnProfile && user.is_admin}
                    <p class="text-sm text-muted-foreground">
                        You cannot remove your own admin role, so the instance always keeps an admin. Ask another admin to do it.
                    </p>
                {/if}
            </div>
        </SettingsSection>

        <SettingsSection
            title="Password"
            description="Set a new password. The user is logged out of all sessions."
        >
            <Button variant="outline" class="gap-2" onclick={() => (showResetPasswordDialog = true)}>
                <Key class="h-4 w-4" />
                Reset password
            </Button>
        </SettingsSection>

        <DangerZone>
            {#if user.disabled}
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="space-y-1">
                        <h3 class="font-semibold">Enable account</h3>
                        <p class="text-sm text-muted-foreground">This account is disabled. Enabling lets the user log in again.</p>
                    </div>
                    <Button onclick={() => (showEnableDialog = true)}>Enable user</Button>
                </div>
            {:else}
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="space-y-1">
                        <h3 class="font-semibold">Disable account</h3>
                        <p class="text-sm text-muted-foreground">
                            The user is logged out immediately and cannot log in until the account is enabled again.
                        </p>
                        {#if isOwnProfile}
                            <p class="text-sm text-muted-foreground">
                                This is your own account. You cannot disable it, so you cannot lock yourself out.
                            </p>
                        {:else if user.is_admin}
                            <p class="text-sm text-muted-foreground">
                                The last active admin cannot be disabled.
                            </p>
                        {/if}
                    </div>
                    <Button variant="destructive" onclick={() => (showDisableDialog = true)} disabled={isOwnProfile}>
                        Disable user
                    </Button>
                </div>
            {/if}
        </DangerZone>
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

<Dialog.Root
    bind:open={showResetPasswordDialog}
    onOpenChange={(o) => {
        if (!o) closeResetDialog();
    }}
>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>Reset password</Dialog.Title>
            <Dialog.Description>
                Set a new password for this user. They will be logged out of all sessions.
            </Dialog.Description>
        </Dialog.Header>
        <div class="space-y-4 py-4">
            <div class="space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <Label for="new-password">New password</Label>
                    <div class="flex items-center gap-1">
                        {#if newPassword}
                            <CopyButton value={newPassword} label="Copy password" />
                        {/if}
                        <Button type="button" variant="outline" size="sm" disabled={actionLoading} onclick={fillGeneratedPassword}>
                            Generate password
                        </Button>
                    </div>
                </div>
                <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Minimum 8 characters"
                    bind:value={newPassword}
                    disabled={actionLoading}
                    autocomplete="new-password"
                />
            </div>
            <div class="space-y-2">
                <Label for="confirm-password">Confirm password</Label>
                <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    bind:value={confirmPassword}
                    disabled={actionLoading}
                    autocomplete="new-password"
                />
            </div>
            {#if passwordError}
                <p class="text-sm text-destructive">{passwordError}</p>
            {/if}
        </div>
        <Dialog.Footer>
            <Button variant="outline" disabled={actionLoading} onclick={closeResetDialog}>Cancel</Button>
            <Button variant="destructive" onclick={resetPassword} disabled={actionLoading}>
                {actionLoading ? "Resetting..." : "Reset password"}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
