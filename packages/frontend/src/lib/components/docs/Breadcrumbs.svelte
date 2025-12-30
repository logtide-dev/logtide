<script lang="ts">
    import { page } from "$app/state";
    import { ChevronRight } from "lucide-svelte";

    interface Breadcrumb {
        label: string;
        href?: string;
    }

    let breadcrumbs = $derived(getBreadcrumbs(page.url.pathname));

    function getBreadcrumbs(pathname: string): Breadcrumb[] {
        const segments = pathname.split("/").filter(Boolean);
        const crumbs: Breadcrumb[] = [{ label: "Docs", href: "/docs" }];

        let currentPath = "/docs";
        for (let i = 1; i < segments.length; i++) {
            const segment = segments[i];
            currentPath += "/" + segment;

            const label = segment
                .split("-")
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");

            // Last item doesn't get a link
            if (i === segments.length - 1) {
                crumbs.push({ label });
            } else {
                crumbs.push({ label, href: currentPath });
            }
        }

        return crumbs;
    }
</script>

<nav class="flex items-center gap-2 text-sm text-muted-foreground mb-6">
    {#each breadcrumbs as crumb, i}
        {#if i > 0}
            <ChevronRight class="w-4 h-4" />
        {/if}

        {#if crumb.href}
            <a
                href={crumb.href}
                class="hover:text-foreground transition-colors"
            >
                {crumb.label}
            </a>
        {:else}
            <span class="text-foreground font-medium">{crumb.label}</span>
        {/if}
    {/each}
</nav>
