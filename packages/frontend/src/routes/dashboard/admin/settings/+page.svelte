<script lang="ts">
    import PageHeader from "$lib/components/app/PageHeader.svelte";
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
        Search,
        ArrowUpCircle,
    } from "@lucide/svelte";
    import { browser } from "$app/environment";
    import { untrack } from "svelte";
    import { UsersAPI } from "$lib/api/users";
    import { get } from "svelte/store";
    import {
        defaultUserOptions,
        settingsFromResponse,
        settingsPayload,
        validateSettings,
    } from "$lib/utils/admin-settings";

    let loading = $state(true);
    let saving = $state(false);
    let error = $state<string | null>(null);
    let success = $state<string | null>(null);

    // Settings state
    let signupEnabled = $state(true);
    let authMode = $state<"standard" | "none">("standard");
    let defaultUserId = $state<string | null>(null);

    // Search settings: shown for reference only, the server does not store them
    let searchDefaultMode = $state<"fulltext" | "substring">("fulltext");
    let searchSubstringIndexed = $state(true);

    // Updates settings state
    let updatesChannel = $state<"stable" | "beta">("stable");

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
            applySettings(settings);

            // The saved default user may be outside the first page or not an
            // active admin: fetch it by id so the select shows the saved value.
            let savedUser: UserBasic | null = null;
            if (defaultUserId) {
                savedUser = usersResponse.users.find((u) => u.id === defaultUserId) ?? null;
                if (!savedUser) {
                    savedUser = await adminAPI.getUserDetails(defaultUserId).catch(() => null);
                }
            }
            usersList = defaultUserOptions(usersResponse.users, savedUser);
        } catch (e: any) {
            console.error("Error loading settings:", e);
            error = e.message || "Failed to load settings";
        } finally {
            loading = false;
        }
    }

    function applySettings(settings: Record<string, unknown>) {
        const form = settingsFromResponse(settings);
        signupEnabled = form.signupEnabled;
        authMode = form.authMode;
        defaultUserId = form.defaultUserId;
        updatesChannel = form.updatesChannel;
    }

    async function saveSettings() {
        error = null;
        success = null;
        const form = { signupEnabled, authMode, defaultUserId, updatesChannel };
        const invalid = validateSettings(form);
        if (invalid) {
            error = invalid;
            return;
        }
        saving = true;
        try {
            const res = await adminAPI.updateSettings(settingsPayload(form));
            // Show what the server actually stored
            if (res?.settings) applySettings(res.settings);
            success = "Settings saved";
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
        { value: "standard", label: "Standard authentication" },
        { value: "none", label: "Auth-free mode" },
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

<svelte:head>
    <title>Instance settings - LogTide</title>
</svelte:head>

<div class="space-y-8">
    <PageHeader
        title="Instance settings"
        appliesTo="instance"
        description="Configure global authentication and security settings"
    >
        {#snippet actions()}
            <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading}>
                <RefreshCw class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}" />
                Refresh
            </Button>
            <Button
                size="sm"
                onclick={saveSettings}
                disabled={saving || loading || (authMode === "none" && !defaultUserId)}
                title={authMode === "none" && !defaultUserId ? "Select a default user for auth-free mode" : undefined}
            >
                <Save class="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save changes"}
            </Button>
        {/snippet}
    </PageHeader>

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
            class="bg-success/15 text-success-text p-4 rounded-md flex items-center gap-2"
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
                <h2 class="text-xl font-semibold">Loading settings...</h2>
            </div>
        {:else}
            <div class="grid gap-6 md:grid-cols-2">
                <!-- User registration settings -->
                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <UserPlus class="h-5 w-5" />
                            User registration
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
                            <div class="bg-warning/10 border border-warning/20 rounded-md p-3">
                                <p class="text-sm text-warning-text">
                                    New user registration is disabled. Users can only be added via invitations or admin creation.
                                </p>
                            </div>
                        {/if}
                    </CardContent>
                </Card>

                <!-- Authentication mode settings -->
                <Card>
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <Shield class="h-5 w-5" />
                            Authentication mode
                        </CardTitle>
                        <CardDescription>
                            Configure how users authenticate to the platform
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="space-y-2">
                            <Label>Authentication mode</Label>
                            <Select.Root
                                type="single"
                                value={authMode}
                                onValueChange={(v) => {
                                    if (v && (v === 'standard' || v === 'none')) {
                                        authMode = v;
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
                            <div class="bg-warning/10 border border-warning/20 rounded-md p-3 space-y-2">
                                <p class="text-sm font-medium text-warning-text">
                                    Auth-free mode active
                                </p>
                                <p class="text-sm text-muted-foreground">
                                    All users will be automatically logged in as the default user.
                                    This mode is intended for single-user deployments only.
                                </p>
                            </div>
                        {:else}
                            <div class="bg-info/10 border border-info/20 rounded-md p-3">
                                <p class="text-sm text-info-text">
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
                                Default user configuration
                            </CardTitle>
                            <CardDescription>
                                Select the default user for auth-free mode. All requests will be processed as this user.
                            </CardDescription>
                        </CardHeader>
                        <CardContent class="space-y-4">
                            <div class="space-y-2">
                                <Label>Default user</Label>
                                {#if usersList.length === 0}
                                    <div class="bg-warning/10 border border-warning/20 rounded-md p-3">
                                        <p class="text-sm text-warning-text">
                                            No users available. Create a user first before enabling auth-free mode.
                                        </p>
                                    </div>
                                {:else}
                                    <Select.Root
                                        type="single"
                                        value={defaultUserId || undefined}
                                        onValueChange={(v) => {
                                            if (v) {
                                                defaultUserId = v;
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
                                                        {#if user.disabled}
                                                            <span class="text-xs text-muted-foreground">(disabled)</span>
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
                                <div class="bg-warning/10 border border-warning/20 rounded-md p-3">
                                    <p class="text-sm text-warning-text">
                                        Please select a default user before saving. Auth-free mode requires a default user to be configured.
                                    </p>
                                </div>
                            {/if}
                            <div class="bg-muted/50 rounded-md p-4 space-y-2">
                                <p class="text-sm font-medium">What happens in Auth-Free mode:</p>
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

                <!-- Search settings -->
                <Card class="md:col-span-2">
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <Search class="h-5 w-5" />
                            Search settings
                        </CardTitle>
                        <CardDescription>
                            Configure log search behavior and performance
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="grid gap-4 md:grid-cols-2">
                            <div class="space-y-2">
                                <Label>Default search mode</Label>
                                <Select.Root
                                    type="single"
                                    disabled
                                    value={searchDefaultMode}
                                    onValueChange={(v) => {
                                        if (v && (v === 'fulltext' || v === 'substring')) {
                                            searchDefaultMode = v;
                                        }
                                    }}
                                >
                                    <Select.Trigger class="w-full">
                                        {searchDefaultMode === "fulltext" ? "Full-text (Word-based)" : "Substring (Anywhere)"}
                                    </Select.Trigger>
                                    <Select.Content>
                                        <Select.Item value="fulltext">Full-text (Word-based)</Select.Item>
                                        <Select.Item value="substring">Substring (anywhere)</Select.Item>
                                    </Select.Content>
                                </Select.Root>
                                <p class="text-xs text-muted-foreground">
                                    Default mode for new search sessions. Not configurable on this instance yet.
                                </p>
                            </div>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <div class="space-y-0.5">
                                        <Label>Substring index enabled</Label>
                                        <p class="text-sm text-muted-foreground">
                                            pg_trgm trigram index is active
                                        </p>
                                    </div>
                                    <Switch
                                        checked={searchSubstringIndexed}
                                        onCheckedChange={(checked) => (searchSubstringIndexed = checked)}
                                        disabled
                                    />
                                </div>
                            </div>
                        </div>
                        <div class="bg-info/10 border border-info/20 rounded-md p-3">
                            <p class="text-sm text-info-text">
                                <strong>Full-text:</strong> Word-based search with stemming (e.g., "fail" finds "failed", "failing").<br/>
                                <strong>Substring:</strong> Finds text anywhere in the message (e.g., "bluez" finds "spa.bluez5.native").
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <!-- Update Channel Settings -->
                <Card class="md:col-span-2">
                    <CardHeader>
                        <CardTitle class="flex items-center gap-2">
                            <ArrowUpCircle class="h-5 w-5" />
                            Update notifications
                        </CardTitle>
                        <CardDescription>
                            Choose which release channel to track for update notifications
                        </CardDescription>
                    </CardHeader>
                    <CardContent class="space-y-4">
                        <div class="grid gap-4 md:grid-cols-2">
                            <div class="space-y-2">
                                <Label>Release channel</Label>
                                <Select.Root
                                    type="single"
                                    value={updatesChannel}
                                    onValueChange={(v) => {
                                        if (v && (v === 'stable' || v === 'beta')) {
                                            updatesChannel = v;
                                        }
                                    }}
                                >
                                    <Select.Trigger class="w-full">
                                        {updatesChannel === "stable" ? "Stable" : "Beta (Pre-releases)"}
                                    </Select.Trigger>
                                    <Select.Content>
                                        <Select.Item value="stable">Stable</Select.Item>
                                        <Select.Item value="beta">Beta (Pre-releases)</Select.Item>
                                    </Select.Content>
                                </Select.Root>
                                <p class="text-xs text-muted-foreground">
                                    Controls which releases trigger "update available" notifications
                                </p>
                            </div>
                        </div>
                        <div class="bg-info/10 border border-info/20 rounded-md p-3">
                            <p class="text-sm text-info-text">
                                <strong>Stable:</strong> Only notify for production-ready releases.<br/>
                                <strong>Beta:</strong> Also notify for pre-release versions (may contain experimental features).
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <!-- Warning Banner -->
            <div class="bg-destructive/5 border border-destructive/20 rounded-lg p-4">
                <div class="flex items-start gap-3">
                    <AlertTriangle class="h-5 w-5 text-destructive mt-0.5" />
                    <div>
                        <h3 class="font-medium text-destructive">Important security notice</h3>
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
            <h2 class="text-xl font-semibold">Verifying access...</h2>
            <p class="text-muted-foreground mt-2">
                Updating your profile permissions.
            </p>
        </div>
    {/if}
</div>
