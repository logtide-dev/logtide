<script lang="ts">
    import { page } from "$app/state";
    import {
        LayoutDashboard,
        Users,
        Building2,
        FolderKanban,
        Settings,
        KeyRound,
    } from "lucide-svelte";
    import { cn } from "$lib/utils";
    import Footer from "$lib/components/Footer.svelte";
    import type { Snippet } from "svelte";

    let { children }: { children: Snippet } = $props();

    const navigation = [
        {
            name: "Dashboard",
            href: "/dashboard/admin",
            icon: LayoutDashboard,
        },
        {
            name: "User Management",
            href: "/dashboard/admin/users",
            icon: Users,
        },
        {
            name: "Organizations",
            href: "/dashboard/admin/organizations",
            icon: Building2,
        },
        {
            name: "Projects",
            href: "/dashboard/admin/projects",
            icon: FolderKanban,
        },
        {
            name: "Auth Providers",
            href: "/dashboard/admin/auth-providers",
            icon: KeyRound,
        },
        {
            name: "Settings",
            href: "/dashboard/admin/settings",
            icon: Settings,
        },
    ];

    const currentPath = $derived(page.url.pathname);

    function isActive(href: string) {
        if (href === "/dashboard/admin") {
            return currentPath === "/dashboard/admin";
        }
        return currentPath.startsWith(href);
    }
</script>

<div class="flex h-screen bg-background">
    <aside class="w-64 border-r bg-card">
        <div class="flex h-full flex-col">
            <div class="border-b p-6">
                <h2 class="text-lg font-semibold">Admin Panel</h2>
                <p class="text-sm text-muted-foreground">System Management</p>
            </div>

            <nav class="flex-1 space-y-1 p-4">
                {#each navigation as item}
                    <a
                        href={item.href}
                        class={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                            isActive(item.href)
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                    >
                        <item.icon class="h-5 w-5" />
                        {item.name}
                    </a>
                {/each}
            </nav>

            <div class="border-t p-4">
                <a
                    href="/dashboard"
                    class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    <Settings class="h-5 w-5" />
                    Back to Dashboard
                </a>
            </div>
        </div>
    </aside>

    <div class="flex-1 overflow-auto flex flex-col">
        <main class="flex-1">
            {@render children()}
        </main>
        <Footer />
    </div>
</div>
