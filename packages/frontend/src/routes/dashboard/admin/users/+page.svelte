<script lang="ts">
    import { untrack } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { adminAPI, type UserBasic, type UserSort } from "$lib/api/admin";
    import PageHeader from "$lib/components/app/PageHeader.svelte";
    import EmptyState from "$lib/components/app/EmptyState.svelte";
    import Pagination from "$lib/components/app/Pagination.svelte";
    import CopyButton from "$lib/components/app/CopyButton.svelte";
    import PasswordStrengthMeter from "$lib/components/auth/PasswordStrengthMeter.svelte";
    import type { DataTableSort } from "$lib/components/app/data-table";
    import AdminUsersTable from "$lib/components/admin/AdminUsersTable.svelte";
    import {
        buildListSearch,
        generatePassword,
        parseEnum,
        parsePage,
        parseSort,
    } from "$lib/components/admin/admin-list-url";
    import { Button } from "$lib/components/ui/button";
    import { SelectField } from "$lib/components/ui/select";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Switch } from "$lib/components/ui/switch";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Search, UserPlus } from "@lucide/svelte";
    import { toastStore } from "$lib/stores/toast";

    const LIMIT = 50;
    const DEFAULT_SORT: DataTableSort = { key: "created_at", dir: "desc" };
    const SORT_KEYS = ["email", "last_login", "created_at"] as const;
    const ROLES = ["", "admin", "user"] as const;
    const STATUSES = ["", "active", "disabled"] as const;

    // The URL is the source of truth for search, filters, sort and page.
    const params = $derived(page.url.searchParams);
    const q = $derived(params.get("q") ?? "");
    const pageNum = $derived(parsePage(params.get("page")));
    const role = $derived(parseEnum(params.get("role"), ROLES, ""));
    const status = $derived(parseEnum(params.get("status"), STATUSES, ""));
    const sort = $derived(parseSort(params, SORT_KEYS, DEFAULT_SORT));

    let users: UserBasic[] = $state([]);
    let total = $state(0);
    let loaded = $state(false);
    let loading = $state(false);
    let error = $state("");
    let searchInput = $state(untrack(() => q));
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let requestId = 0;

    function navigate(next: {
        q?: string;
        page?: number;
        role?: string;
        status?: string;
        sort?: DataTableSort;
    }) {
        const search = buildListSearch({
            q: next.q ?? q,
            page: next.page ?? pageNum,
            sort: next.sort ?? sort,
            defaultSort: DEFAULT_SORT,
            filters: { role: next.role ?? role, status: next.status ?? status },
        });
        goto(page.url.pathname + search, {
            replaceState: true,
            keepFocus: true,
            noScroll: true,
        });
    }

    function onSearchInput() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const next = searchInput.trim();
            if (next !== q) navigate({ q: next, page: 1 });
        }, 300);
    }

    $effect(() => () => clearTimeout(searchTimer));

    // Back/forward changes the URL query without touching the input.
    $effect(() => {
        const current = q;
        untrack(() => {
            if (current !== searchInput.trim()) searchInput = current;
        });
    });

    async function loadUsers() {
        const id = ++requestId;
        loading = true;
        error = "";
        try {
            const response = await adminAPI.getUsers({
                page: pageNum,
                limit: LIMIT,
                search: q || undefined,
                sort: sort.key as UserSort,
                order: sort.dir,
                role: role || undefined,
                status: status || undefined,
            });
            if (id !== requestId) return;
            users = response.users;
            total = response.total;
            loaded = true;
        } catch (err: any) {
            if (id !== requestId) return;
            error = err?.message || "Failed to load users";
            toastStore.error(error);
        } finally {
            if (id === requestId) loading = false;
        }
    }

    // Reload whenever the URL-derived query changes.
    $effect(() => {
        void [q, pageNum, role, status, sort.key, sort.dir];
        untrack(() => loadUsers());
    });

    const hasFilters = $derived(!!q || !!role || !!status);

    function clearFilters() {
        searchInput = "";
        navigate({ q: "", role: "", status: "", page: 1 });
    }

    let showCreateDialog = $state(false);
    let creating = $state(false);
    let showPassword = $state(false);
    let createForm = $state({
        email: "",
        name: "",
        password: "",
        confirmPassword: "",
        is_admin: false,
    });
    let createError = $state("");
    let createPasswordOk = $state(false);

    function resetCreateForm() {
        createForm = {
            email: "",
            name: "",
            password: "",
            confirmPassword: "",
            is_admin: false,
        };
        createError = "";
        showPassword = false;
    }

    function fillGeneratedPassword() {
        const password = generatePassword(16);
        createForm.password = password;
        createForm.confirmPassword = password;
        showPassword = true;
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
        if (!createPasswordOk) {
            createError = "Choose a stronger password";
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
            toastStore.success(`User ${email} created`);
            showCreateDialog = false;
            resetCreateForm();
            if (pageNum !== 1) navigate({ page: 1 });
            else await loadUsers();
        } catch (err: any) {
            createError = err?.message || "Failed to create user";
        } finally {
            creating = false;
        }
    }
</script>

<svelte:head>
    <title>All users - LogTide</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        title="All users"
        appliesTo="instance"
        description="Every account on this instance"
    >
        {#snippet actions()}
            <Button
                onclick={() => {
                    resetCreateForm();
                    showCreateDialog = true;
                }}
            >
                <UserPlus class="h-4 w-4 mr-2" />
                Create user
            </Button>
        {/snippet}
    </PageHeader>

    <div class="flex flex-wrap items-end gap-3">
        <div class="relative min-w-[14rem] flex-1">
            <Search
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
            />
            <Input
                type="search"
                aria-label="Search users by email or name"
                placeholder="Search by email or name"
                bind:value={searchInput}
                oninput={onSearchInput}
                class="pl-10 max-md:h-11"
            />
        </div>
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
            Role
            <SelectField
                class="w-40 max-md:h-11"
                value={role}
                onValueChange={(v) => navigate({ role: v, page: 1 })}
                options={[
                    { value: "", label: "All roles" },
                    { value: "admin", label: "Admins" },
                    { value: "user", label: "Users" },
                ]}
            />
        </label>
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
            Status
            <SelectField
                class="w-40 max-md:h-11"
                value={status}
                onValueChange={(v) => navigate({ status: v, page: 1 })}
                options={[
                    { value: "", label: "All statuses" },
                    { value: "active", label: "Active" },
                    { value: "disabled", label: "Disabled" },
                ]}
            />
        </label>
    </div>

    {#if error && !loaded}
        <EmptyState variant="error" title="Could not load users" description={error}>
            {#snippet actions()}
                <Button variant="outline" size="sm" onclick={loadUsers}>Retry</Button>
            {/snippet}
        </EmptyState>
    {:else}
        <div class="space-y-4" aria-busy={loading}>
            <div class={loading && loaded ? "opacity-70 transition-opacity" : "transition-opacity"}>
                <AdminUsersTable
                    {users}
                    loading={!loaded}
                    bind:sort={() => sort, (s) => navigate({ sort: s, page: 1 })}
                >
                    {#snippet empty()}
                        {#if hasFilters}
                            <EmptyState variant="no-results" title="No users match" description="Try a different search or clear the filters.">
                                {#snippet actions()}
                                    <Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
                                {/snippet}
                            </EmptyState>
                        {:else}
                            <EmptyState variant="no-data" title="No users yet" description="Create the first account with the button above." />
                        {/if}
                    {/snippet}
                </AdminUsersTable>
            </div>
            {#if error}
                <p class="text-sm text-destructive-text" role="alert">
                    {error}
                    <button type="button" class="underline underline-offset-4" onclick={loadUsers}>Retry</button>
                </p>
            {/if}
            <Pagination
                page={pageNum}
                pageSize={LIMIT}
                {total}
                onPageChange={(p) => navigate({ page: p })}
            />
        </div>
    {/if}
</div>

<Dialog.Root bind:open={showCreateDialog}>
    <Dialog.Content class="max-w-lg">
        <Dialog.Header>
            <Dialog.Title>Create user</Dialog.Title>
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
                    <div class="flex items-center justify-between gap-2">
                        <Label for="create-user-password">Password</Label>
                        <div class="flex items-center gap-1">
                            {#if createForm.password}
                                <CopyButton value={createForm.password} label="Copy password" />
                            {/if}
                            <Button type="button" variant="outline" size="sm" disabled={creating} onclick={fillGeneratedPassword}>
                                Generate password
                            </Button>
                        </div>
                    </div>
                    <Input
                        id="create-user-password"
                        type={showPassword ? "text" : "password"}
                        bind:value={createForm.password}
                        disabled={creating}
                        autocomplete="new-password"
                        aria-describedby="create-user-password-strength"
                    />
                    <PasswordStrengthMeter
                        id="create-user-password-strength"
                        value={createForm.password}
                        bind:ok={createPasswordOk}
                        user={{ email: createForm.email, name: createForm.name }}
                    />
                </div>
                <div class="space-y-2">
                    <Label for="create-user-confirm">Confirm password</Label>
                    <Input
                        id="create-user-confirm"
                        type={showPassword ? "text" : "password"}
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
                    {creating ? "Creating..." : "Create user"}
                </Button>
            </Dialog.Footer>
        </form>
    </Dialog.Content>
</Dialog.Root>
