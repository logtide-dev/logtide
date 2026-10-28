<script lang="ts">
    import { onMount } from "svelte";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import SettingsSection from "$lib/components/app/SettingsSection.svelte";
    import ConfirmDialog from "$lib/components/app/ConfirmDialog.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import { Skeleton } from "$lib/components/ui/skeleton";
    import * as Select from "$lib/components/ui/select";
    import { adminAPI, type UserBasic } from "$lib/api/admin";
    import { toastStore } from "$lib/stores/toast";
    import { RefreshCw, TriangleAlert } from "@lucide/svelte";
    import {
        defaultUserOptions,
        settingsFromResponse,
        validateSettings,
        type InstanceSettingsForm,
    } from "$lib/utils/admin-settings";
    import {
        isSectionDirty,
        sectionPayload,
        isEnablingAuthFree,
        resetSection,
        type SettingsSectionKey,
    } from "$lib/components/admin/settings-sections";
    import Timestamp from "$lib/components/app/Timestamp.svelte";

    // The admin layout already blocks this page until the user is confirmed as admin.

    let loading = $state(true);
    let loaded = $state(false);
    let loadError = $state<string | null>(null);
    let savingSection = $state<SettingsSectionKey | null>(null);
    let sectionErrors = $state<Partial<Record<SettingsSectionKey, string>>>({});
    let lastSavedAt = $state<Partial<Record<SettingsSectionKey, string>>>({});

    const EMPTY: InstanceSettingsForm = {
        signupEnabled: true,
        authMode: "standard",
        defaultUserId: null,
        updatesChannel: "stable",
    };
    let saved = $state<InstanceSettingsForm>({ ...EMPTY });
    let form = $state<InstanceSettingsForm>({ ...EMPTY });

    let usersList = $state<UserBasic[]>([]);

    let confirmAuthFree = $state(false);
    let confirmRefresh = $state(false);

    const SECTIONS: SettingsSectionKey[] = ["signups", "auth", "updates"];
    const dirty = $derived({
        signups: isSectionDirty("signups", saved, form),
        auth: isSectionDirty("auth", saved, form),
        updates: isSectionDirty("updates", saved, form),
    });
    const anyDirty = $derived(SECTIONS.some((s) => dirty[s]));

    // Search settings: shown for reference only, the server does not store them.
    const searchDefaultMode = "fulltext";

    async function loadSettings() {
        loading = true;
        loadError = null;
        try {
            const [settings, usersResponse] = await Promise.all([
                adminAPI.getSettings(),
                adminAPI.getUsers(1, 100),
            ]);
            const next = settingsFromResponse(settings);
            saved = { ...next };
            form = { ...next };
            sectionErrors = {};
            loaded = true;

            // The saved default user may be outside the first page or not an
            // active admin: fetch it by id so the select shows the saved value.
            let savedUser: UserBasic | null = null;
            if (next.defaultUserId) {
                savedUser = usersResponse.users.find((u) => u.id === next.defaultUserId) ?? null;
                if (!savedUser) {
                    savedUser = await adminAPI.getUserDetails(next.defaultUserId).catch(() => null);
                }
            }
            usersList = defaultUserOptions(usersResponse.users, savedUser);
        } catch (e) {
            console.error("Error loading settings:", e);
            loadError = e instanceof Error && e.message ? e.message : "Failed to load settings";
        } finally {
            loading = false;
        }
    }

    function onRefresh() {
        if (anyDirty) confirmRefresh = true;
        else loadSettings();
    }

    function requestSave(section: SettingsSectionKey) {
        const invalid = validateSettings(form);
        if (section === "auth" && invalid) {
            sectionErrors = { ...sectionErrors, auth: invalid };
            return;
        }
        if (section === "auth" && isEnablingAuthFree(saved, form)) {
            confirmAuthFree = true;
            return;
        }
        saveSection(section).catch(() => {});
    }

    async function saveSection(section: SettingsSectionKey) {
        sectionErrors = { ...sectionErrors, [section]: undefined };
        savingSection = section;
        try {
            const res = await adminAPI.updateSettings(sectionPayload(section, form));
            // Show what the server actually stored, but only for this section so
            // edits in other sections are kept.
            const stored = res?.settings ? settingsFromResponse(res.settings) : form;
            saved = resetSection(section, stored, saved);
            form = resetSection(section, stored, form);
            lastSavedAt = { ...lastSavedAt, [section]: new Date().toISOString() };
            toastStore.success("Settings saved");
        } catch (e) {
            console.error("Error saving settings:", e);
            sectionErrors = {
                ...sectionErrors,
                [section]: e instanceof Error && e.message ? e.message : "Failed to save settings",
            };
            throw e;
        } finally {
            savingSection = null;
        }
    }

    function discard(section: SettingsSectionKey) {
        form = resetSection(section, saved, form);
        sectionErrors = { ...sectionErrors, [section]: undefined };
    }

    onMount(loadSettings);

    const authModeOptionsList = [
        { value: "standard", label: "Standard authentication" },
        { value: "none", label: "Auth-free mode" },
    ];

    function getAuthModeLabel(mode: string): string {
        return authModeOptionsList.find((o) => o.value === mode)?.label ?? "Select mode";
    }

    function getDefaultUserLabel(userId: string | null): string {
        if (!userId) return "Select default user";
        const user = usersList.find((u) => u.id === userId);
        return user ? `${user.name} (${user.email})` : "Select default user";
    }
</script>

<svelte:head>
    <title>Instance settings - LogTide</title>
</svelte:head>

{#snippet sectionFooter(section: SettingsSectionKey)}
    <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div class="text-sm" aria-live="polite">
            {#if sectionErrors[section]}
                <span role="alert" class="text-destructive-text">{sectionErrors[section]}</span>
            {:else if dirty[section]}
                <span class="text-warning-text">Unsaved changes</span>
            {:else if lastSavedAt[section]}
                <span class="text-muted-foreground">Saved <Timestamp value={lastSavedAt[section]} /></span>
            {/if}
        </div>
        <div class="flex items-center gap-2">
            <Button
                variant="ghost"
                size="sm"
                disabled={!dirty[section] || savingSection !== null}
                onclick={() => discard(section)}
            >
                Discard
            </Button>
            <Button
                size="sm"
                disabled={!dirty[section] || savingSection !== null}
                onclick={() => requestSave(section)}
            >
                {savingSection === section ? "Saving..." : "Save"}
            </Button>
        </div>
    </div>
{/snippet}

<div class="space-y-8">
    <PageHeader
        title="Instance settings"
        appliesTo="instance"
        description="Sign-ups, authentication and update notifications for this instance"
    >
        {#snippet actions()}
            <Button variant="outline" size="sm" onclick={onRefresh} disabled={loading}>
                <RefreshCw class="mr-2 h-4 w-4 {loading ? 'animate-spin' : ''}" aria-hidden="true" />
                Refresh
            </Button>
        {/snippet}
    </PageHeader>

    {#if loading && !loaded && !loadError}
        <div class="space-y-4" aria-busy="true">
            <Skeleton class="h-32 w-full" />
            <Skeleton class="h-48 w-full" />
            <Skeleton class="h-32 w-full" />
        </div>
    {:else if loadError}
        <EmptyState variant="error" title="Could not load settings" description={loadError}>
            {#snippet actions()}
                <Button variant="outline" size="sm" onclick={loadSettings}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else}
        <!-- Sign-ups -->
        <SettingsSection title="Sign-ups" description="Control whether new users can create accounts on this instance">
            <div class="flex items-center justify-between gap-4">
                <div class="space-y-0.5">
                    <Label for="signups-switch">Allow sign-ups</Label>
                    <p class="text-sm text-muted-foreground">Anyone who can reach the instance can register</p>
                </div>
                <Switch
                    id="signups-switch"
                    checked={form.signupEnabled}
                    onCheckedChange={(checked) => (form.signupEnabled = checked)}
                />
            </div>
            {#if !form.signupEnabled}
                <p class="mt-4 rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning-text">
                    Sign-ups are disabled. Users can only be added by invitation or by an admin.
                </p>
            {/if}
            {@render sectionFooter("signups")}
        </SettingsSection>

        <!-- Authentication -->
        <SettingsSection title="Authentication" description="How users sign in to this instance">
            <div class="mb-4 flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive-text" aria-hidden="true" />
                <p class="text-sm text-muted-foreground">
                    Authentication changes affect all users immediately. Auth-free mode skips sign-in entirely: use it
                    only on trusted, single-user instances, never on one reachable from the internet.
                </p>
            </div>

            <div class="space-y-4">
                <div class="space-y-2">
                    <Label>Authentication mode</Label>
                    <Select.Root
                        type="single"
                        value={form.authMode}
                        onValueChange={(v) => {
                            if (v === "standard" || v === "none") form.authMode = v;
                        }}
                    >
                        <Select.Trigger class="w-full" aria-label="Authentication mode">
                            {getAuthModeLabel(form.authMode)}
                        </Select.Trigger>
                        <Select.Content>
                            {#each authModeOptionsList as option (option.value)}
                                <Select.Item value={option.value}>{option.label}</Select.Item>
                            {/each}
                        </Select.Content>
                    </Select.Root>
                </div>

                {#if form.authMode === "none"}
                    <div class="space-y-3 rounded-md border border-warning/20 bg-warning/10 p-3">
                        <p class="text-sm font-medium text-warning-text">Auth-free mode</p>
                        <p class="text-sm text-muted-foreground">
                            Every request is processed as the default user below. Login and registration pages
                            redirect to the dashboard. The default user needs access to the organizations and
                            projects you want to expose.
                        </p>
                    </div>

                    <div class="space-y-2">
                        <Label>Default user</Label>
                        {#if usersList.length === 0}
                            <p class="rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning-text">
                                No eligible users. Create an active admin user before enabling auth-free mode.
                            </p>
                        {:else}
                            <Select.Root
                                type="single"
                                value={form.defaultUserId || undefined}
                                onValueChange={(v) => {
                                    if (v) form.defaultUserId = v;
                                }}
                            >
                                <Select.Trigger class="w-full" aria-label="Default user">
                                    {getDefaultUserLabel(form.defaultUserId)}
                                </Select.Trigger>
                                <Select.Content>
                                    {#each usersList as user (user.id)}
                                        <Select.Item value={user.id}>
                                            <div class="flex items-center gap-2">
                                                <span class="font-medium">{user.name}</span>
                                                <span class="text-muted-foreground">({user.email})</span>
                                                {#if user.is_admin}
                                                    <span class="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">Admin</span>
                                                {/if}
                                                {#if user.disabled}
                                                    <span class="text-xs text-muted-foreground">(disabled)</span>
                                                {/if}
                                            </div>
                                        </Select.Item>
                                    {/each}
                                </Select.Content>
                            </Select.Root>
                            {#if !form.defaultUserId}
                                <p class="text-sm text-warning-text">Select a default user before saving.</p>
                            {/if}
                        {/if}
                    </div>
                {:else}
                    <p class="rounded-md border border-info/20 bg-info/10 p-3 text-sm text-info-text">
                        Users sign in with email and password, or with any enabled OIDC or LDAP provider.
                    </p>
                {/if}
            </div>
            {@render sectionFooter("auth")}
        </SettingsSection>

        <!-- Search (read only) -->
        <SettingsSection title="Search" description="Log search behavior">
            <div class="grid gap-4 md:grid-cols-2">
                <div class="space-y-2">
                    <Label>Default search mode</Label>
                    <Select.Root type="single" disabled value={searchDefaultMode}>
                        <Select.Trigger class="w-full" aria-label="Default search mode">Full-text (word-based)</Select.Trigger>
                        <Select.Content>
                            <Select.Item value="fulltext">Full-text (word-based)</Select.Item>
                            <Select.Item value="substring">Substring (anywhere)</Select.Item>
                        </Select.Content>
                    </Select.Root>
                    <p class="text-xs text-muted-foreground">Not configurable on this instance yet.</p>
                </div>
            </div>
            <p class="mt-4 text-sm text-muted-foreground">
                Full-text matches whole words with stemming ("fail" finds "failed"). Substring finds text anywhere in
                the message ("bluez" finds "spa.bluez5.native").
            </p>
        </SettingsSection>

        <!-- Updates -->
        <SettingsSection title="Update notifications" description="Which release channel triggers update notices">
            <div class="max-w-md space-y-2">
                <Label>Release channel</Label>
                <Select.Root
                    type="single"
                    value={form.updatesChannel}
                    onValueChange={(v) => {
                        if (v === "stable" || v === "beta") form.updatesChannel = v;
                    }}
                >
                    <Select.Trigger class="w-full" aria-label="Release channel">
                        {form.updatesChannel === "stable" ? "Stable" : "Beta (pre-releases)"}
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="stable">Stable</Select.Item>
                        <Select.Item value="beta">Beta (pre-releases)</Select.Item>
                    </Select.Content>
                </Select.Root>
                <p class="text-xs text-muted-foreground">
                    Stable notifies for production-ready releases only. Beta also notifies for pre-releases, which may
                    contain experimental features.
                </p>
            </div>
            {@render sectionFooter("updates")}
        </SettingsSection>
    {/if}
</div>

<ConfirmDialog
    bind:open={confirmAuthFree}
    title="Enable auth-free mode?"
    description="Everyone who can reach this instance will be signed in automatically as the default user, with no password. Only do this on a trusted, single-user instance that is not exposed to the internet."
    confirmLabel="Enable auth-free mode"
    onConfirm={() => saveSection("auth")}
/>

<ConfirmDialog
    bind:open={confirmRefresh}
    title="Discard unsaved changes?"
    description="Refreshing reloads the settings from the server and drops the edits you have not saved."
    confirmLabel="Discard and refresh"
    onConfirm={loadSettings}
/>
