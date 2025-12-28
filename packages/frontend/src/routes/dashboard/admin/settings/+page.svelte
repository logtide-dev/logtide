<script lang="ts">
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import * as Select from "$lib/components/ui/select";
    import { onMount } from "svelte";
    import { adminAPI, type UserBasic } from "$lib/api/admin";
    import { authStore } from "$lib/stores/auth";
    import { goto } from "$app/navigation";
    import {
        Settings,
        Shield,
        UserPlus,
        AlertTriangle,
        RefreshCw,
        Save,
        Info,
        User,
    } from "lucide-svelte";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";

    let loading = $state(true);
    let saving = $state(false);
    let error = $state<string | null>(null);
    let success = $state<string | null>(null);

    // Settings state
    let signupEnabled = $state(true);
    let authMode = $state<"standard" | "none">("standard");
    let defaultUserId = $state<string | null>(null);

    // Users list for auth-free mode selector
    let usersList = $state<UserBasic[]>([]);
    let loadingUsers = $state(false);

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
                                authStore.updateUser({
                                    ...currentUser,
                                    ...user,
                                });
                                if (user.is_admin) {
                                    loadSettings();
                                }
                            }
                        })
                        .catch((err) => {
                            console.error("Failed to refresh profile:", err);
                            goto("/dashboard");
                        });
                });
            } else if ($authStore.user.is_admin === false) {
                untrack(() => {
                    goto("/dashboard");
                });
            }
        }
    });

    async function loadSettings() {
        if ($authStore.user?.is_admin !== true) return;

        loading = true;
        error = null;
        try {
            const [settings, usersResponse] = await Promise.all([
                adminAPI.getSettings(),
                adminAPI.getUsers(1, 100), // Load up to 100 users for selection
            ]);
            signupEnabled = settings["auth.signup_enabled"] as boolean ?? true;
            authMode = (settings["auth.mode"] as "standard" | "none") ?? "standard";
            defaultUserId = (settings["auth.default_user_id"] as string) ?? null;
            // Only show active admin users for default user selection
            usersList = usersResponse.users.filter(u => !u.disabled && u.is_admin);
        } catch (e: any) {
            console.error("Error loading settings:", e);
            error = e.message || "Failed to load settings";
        } finally {
            loading = false;
        }
    }

    async function saveSettings() {
        saving = true;
        error = null;
        success = null;
        try {
            await adminAPI.updateSettings({
                "auth.signup_enabled": signupEnabled,
                "auth.mode": authMode,
                "auth.default_user_id": defaultUserId,
            });
            success = "Settings saved successfully";
            setTimeout(() => {
                success = null;
            }, 3000);
        } catch (e: any) {
            console.error("Error saving settings:", e);
            error = e.message || "Failed to save settings";
        } finally {
            saving = false;
        }
    }

    onMount(() => {
        if ($authStore.user?.is_admin) {
            loadSettings();
        }
    });

    const authModeOptionsList = [
        { value: "standard", label: "Standard Authentication" },
        { value: "none", label: "Auth-Free Mode" },
    ];

    function getAuthModeLabel(mode: string): string {
        return authModeOptionsList.find(o => o.value === mode)?.label ?? "Select mode...";
    }

    function getDefaultUserLabel(userId: string | null): string {
        if (!userId) return "Select default user...";
        const user = usersList.find(u => u.id === userId);
        return user ? `${user.name} (${user.email})` : "Select default user...";
    }

    function getSelectedUser(): UserBasic | null {
        if (!defaultUserId) return null;
        return usersList.find(u => u.id === defaultUserId) ?? null;
    }
</script>

<div class="container mx-auto p-6 space-y-8">
    <div class="flex justify-between items-center">
        <div>
            <h1 class="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Settings class="h-8 w-8" />
                System Settings
            </h1>
            <p class="text-muted-foreground mt-1">
                Configure global authentication and security settings
            </p>
        </div>
        <div class="flex items-center gap-4">
            <Button
                variant="outline"
                size="sm"
                onclick={loadSettings}
                disabled={loading}
            >
                <RefreshCw
                    class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}"
                />
                Refresh
            </Button>
            <Button
                size="sm"
                onclick={saveSettings}
                disabled={saving || loading}
            >
                <Save class="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save Changes"}
            </Button>
        </div>
    </div>

    {#if error}
        <div
            class="bg-destructive/15 text-destructive p-4 rounded-md flex items-center gap-2"
        >
            <AlertTriangle class="h-5 w-5" />
            <span>{error}</span>
        </div>
    {/if}

    {#if success}
        <div
            class="bg-green-500/15 text-green-600 dark:text-green-400 p-4 rounded-md flex items-center gap-2"
        >
            <Info class="h-5 w-5" />
            <span>{success}</span>
        </div>
    {/if}

    {#if $authStore.user?.is_admin}
        {#if loading}
            <div class="flex flex-col items-center justify-center p-12 text-center">
                <div class="bg-muted/50 p-6 rounded-full mb-4">
                    <RefreshCw class="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
                <h2 class="text-xl font-semibold">Loading Settings...</h2>
            </div>
        {:else}
            <div class="grid gap-6 md:grid-cols-2">
                <!-- User Registration Settings -->
                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <UserPlus class="h-5 w-5" />
                            User Registration
                        </CardTitle>
                        <CardDescription>
                            Control whether new users can register on the platform
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="flex items-center justify-between">
                            <div class="space-y-0.5">
                                <Label>Enable Sign-ups</Label>
                                <p class="text-sm text-muted-foreground">
                                    Allow new users to create accounts
                                </p>
                            </div>
                            <Switch
                                checked={signupEnabled}
                                onCheckedChange={(checked) => (signupEnabled = checked)}
                            />
                        </div>
                        {#if !signupEnabled}
                            <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
                                <p class="text-sm text-yellow-600 dark:text-yellow-400">
                                    New user registration is disabled. Users can only be added via invitations or admin creation.
                                </p>
                            </div>
                        {/if}
                    </CardContent>
                </Card>

                <!-- Authentication Mode Settings -->
                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <Shield class="h-5 w-5" />
                            Authentication Mode
                        </CardTitle>
                        <CardDescription>
                            Configure how users authenticate to the platform
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="space-y-2">
                            <Label>Authentication Mode</Label>
                            <Select.Root
                                type="single"
                                value={{ value: authMode, label: getAuthModeLabel(authMode) }}
                                onValueChange={(v) => {
                                    if (v) {
                                        const newValue = typeof v === 'string' ? v : v.value;
                                        if (newValue === 'standard' || newValue === 'none') {
                                            authMode = newValue;
                                        }
                                    }
                                }}
                            >
                                <Select.Trigger class="w-full">
                                    {getAuthModeLabel(authMode)}
                                </Select.Trigger>
                                <Select.Content>
                                    {#each authModeOptionsList as option}
                                        <Select.Item value={option.value}>
                                            {option.label}
                                        </Select.Item>
                                    {/each}
                                </Select.Content>
                            </Select.Root>
                        </div>
                        {#if authMode === "none"}
                            <div class="bg-orange-500/10 border border-orange-500/20 rounded-md p-3 space-y-2">
                                <p class="text-sm font-medium text-orange-600 dark:text-orange-400">
                                    Auth-Free Mode Active
                                </p>
                                <p class="text-sm text-muted-foreground">
                                    All users will be automatically logged in as the default user.
                                    This mode is intended for single-user deployments only.
                                </p>
                            </div>
                        {:else}
                            <div class="bg-blue-500/10 border border-blue-500/20 rounded-md p-3">
                                <p class="text-sm text-blue-600 dark:text-blue-400">
                                    Standard authentication requires users to login with email/password, OIDC, or LDAP.
                                </p>
                            </div>
                        {/if}
                    </CardContent>
                </Card>

                <!-- Default User Settings (only shown when auth-free mode) -->
                {#if authMode === "none"}
                    <Card class="md:col-span-2">
                        <CardHeader>
                            <CardTitle class="flex items-center gap-2">
                                <User class="h-5 w-5" />
                                Default User Configuration
                            </CardTitle>
                            <CardDescription>
                                Select the default user for auth-free mode. All requests will be processed as this user.
                            </CardDescription>
                        </CardHeader>
                        <CardContent class="space-y-4">
                            <div class="space-y-2">
                                <Label>Default User</Label>
                                {#if usersList.length === 0}
                                    <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
                                        <p class="text-sm text-yellow-600 dark:text-yellow-400">
                                            No users available. Create a user first before enabling auth-free mode.
                                        </p>
                                    </div>
                                {:else}
                                    <Select.Root
                                        type="single"
                                        value={defaultUserId ? { value: defaultUserId, label: getDefaultUserLabel(defaultUserId) } : undefined}
                                        onValueChange={(v) => {
                                            if (v) {
                                                const newValue = typeof v === 'string' ? v : v.value;
                                                defaultUserId = newValue;
                                            }
                                        }}
                                    >
                                        <Select.Trigger class="w-full">
                                            {getDefaultUserLabel(defaultUserId)}
                                        </Select.Trigger>
                                        <Select.Content>
                                            {#each usersList as user}
                                                <Select.Item value={user.id}>
                                                    <div class="flex items-center gap-2">
                                                        <span class="font-medium">{user.name}</span>
                                                        <span class="text-muted-foreground">({user.email})</span>
                                                        {#if user.is_admin}
                                                            <span class="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">Admin</span>
                                                        {/if}
                                                    </div>
                                                </Select.Item>
                                            {/each}
                                        </Select.Content>
                                    </Select.Root>
                                    <p class="text-xs text-muted-foreground">
                                        All requests will be processed as this user when auth-free mode is enabled
                                    </p>
                                {/if}
                            </div>
                            {#if !defaultUserId && usersList.length > 0}
                                <div class="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3">
                                    <p class="text-sm text-yellow-600 dark:text-yellow-400">
                                        Please select a default user before saving. Auth-free mode requires a default user to be configured.
                                    </p>
                                </div>
                            {/if}
                            <div class="bg-muted/50 rounded-md p-4 space-y-2">
                                <p class="text-sm font-medium">What happens in Auth-Free Mode:</p>
                                <ul class="text-sm text-muted-foreground list-disc list-inside space-y-1">
                                    <li>All requests bypass authentication and use the selected default user</li>
                                    <li>Login and registration pages redirect to the dashboard</li>
                                    <li>Perfect for single-user deployments</li>
                                    <li>The default user must have access to the desired organizations and projects</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                {/if}
            </div>

            <!-- Warning Banner -->
            <div class="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
                <div class="flex items-start gap-3">
                    <AlertTriangle class="h-5 w-5 text-destructive mt-0.5" />
                    <div>
                        <h3 class="font-medium text-destructive">Important Security Notice</h3>
                        <p class="text-sm text-muted-foreground mt-1">
                            Changing authentication settings affects all users immediately. Auth-Free mode should only be used in trusted, single-user environments.
                            Never enable Auth-Free mode on a publicly accessible instance.
                        </p>
                    </div>
                </div>
            </div>
        {/if}
    {:else}
        <div class="flex flex-col items-center justify-center p-12 text-center">
            <div class="bg-muted/50 p-6 rounded-full mb-4">
                <RefreshCw class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
            <h2 class="text-xl font-semibold">Verifying Access...</h2>
            <p class="text-muted-foreground mt-2">
                Updating your profile permissions.
            </p>
        </div>
    {/if}
</div>
