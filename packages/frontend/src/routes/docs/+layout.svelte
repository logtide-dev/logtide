<script lang="ts">
    import DocsSidebar from "$lib/components/docs/DocsSidebar.svelte";
    import DocsTableOfContents from "$lib/components/docs/DocsTableOfContents.svelte";
    import Navbar from "$lib/components/ui/Navbar.svelte";
    import Footer from "$lib/components/Footer.svelte";
    import Button from "$lib/components/ui/button/button.svelte";
    import Menu from "@lucide/svelte/icons/menu";
    import X from "@lucide/svelte/icons/x";

    let mobileMenuOpen = $state(false);
</script>

<Navbar />

<div class="docs-layout min-h-screen bg-background flex flex-col">
    <!-- Mobile menu button -->
    <div class="mobile-menu-button lg:hidden">
        <Button variant="outline" size="sm" onclick={() => mobileMenuOpen = true}>
            <Menu class="w-4 h-4 mr-2" />
            Menu
        </Button>
    </div>

    <!-- Mobile sidebar overlay -->
    {#if mobileMenuOpen}
        <div
            class="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 lg:hidden"
            onclick={() => mobileMenuOpen = false}
            onkeydown={(e) => e.key === 'Escape' && (mobileMenuOpen = false)}
            role="button"
            tabindex="-1"
        ></div>
    {/if}

    <!-- Mobile sidebar drawer -->
    <aside
        class="fixed left-0 top-0 h-screen w-72 bg-background border-r border-border z-50 lg:hidden transform transition-transform duration-300 ease-in-out overflow-y-auto {mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
        <div class="flex items-center justify-between p-4 border-b border-border">
            <span class="font-semibold">Documentation</span>
            <Button variant="ghost" size="icon" onclick={() => mobileMenuOpen = false}>
                <X class="w-5 h-5" />
            </Button>
        </div>
        <div onclick={() => mobileMenuOpen = false}>
            <DocsSidebar mobile={true} />
        </div>
    </aside>

    <div class="flex flex-1">
        <DocsSidebar />

        <main class="docs-main flex-1">
            <div class="docs-content-wrapper max-w-4xl mx-auto p-8">
                <slot />
            </div>
        </main>

        <DocsTableOfContents />
    </div>

    <Footer />
</div>

<style>
    .docs-layout {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        margin-top: 64px;
    }

    .docs-main {
        flex: 1;
        min-width: 0;
    }

    .mobile-menu-button {
        position: sticky;
        top: 64px;
        z-index: 40;
        padding: 0.75rem 1rem;
        background: hsl(var(--background));
        border-bottom: 1px solid hsl(var(--border));
    }

    @media (max-width: 1024px) {
        .docs-layout > .flex {
            display: block;
        }
    }
</style>
