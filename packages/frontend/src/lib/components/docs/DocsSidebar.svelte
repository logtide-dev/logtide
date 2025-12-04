<script lang="ts">
    import { page } from "$app/stores";
    import {
        Book,
        Code,
        Rocket,
        FileText,
        ChevronRight,
        ChevronDown,
        Github,
    } from "lucide-svelte";

    interface NavItem {
        title: string;
        href: string;
        children?: NavItem[];
    }

    interface NavSection {
        title: string;
        icon: any;
        items: NavItem[];
        collapsed: boolean;
    }

    let navigation: NavSection[] = [
        {
            title: "Getting Started",
            icon: Rocket,
            collapsed: false,
            items: [
                { title: "Quick Start", href: "/docs" },
                { title: "Installation", href: "/docs/getting-started" },
                { title: "No-SDK Setup", href: "/docs/no-sdk-setup" },
            ],
        },
        {
            title: "API Reference",
            icon: Code,
            collapsed: false,
            items: [
                { title: "Overview", href: "/docs/api" },
                { title: "Authentication", href: "/docs/api#authentication" },
                { title: "Log Ingestion", href: "/docs/api#ingestion" },
                { title: "Log Query", href: "/docs/api#query" },
                { title: "Alerts", href: "/docs/api#alerts" },
            ],
        },
        {
            title: "SDKs",
            icon: Code,
            collapsed: false,
            items: [
                { title: "Overview", href: "/docs/sdks" },
                { title: "Node.js", href: "/docs/sdks/nodejs" },
                { title: "Python", href: "/docs/sdks/python" },
                { title: "Go", href: "/docs/sdks/go" },
                { title: "PHP", href: "/docs/sdks/php" },
                { title: "Kotlin", href: "/docs/sdks/kotlin" },
            ],
        },
        {
            title: "Integrations",
            icon: Code,
            collapsed: false,
            items: [
                { title: "Syslog", href: "/docs/syslog" },
                { title: "OpenTelemetry", href: "/docs/opentelemetry" },
            ],
        },
        {
            title: "Guides",
            icon: Book,
            collapsed: false,
            items: [
                { title: "Architecture", href: "/docs/architecture" },
                { title: "Deployment", href: "/docs/deployment" },
                { title: "Contributing", href: "/docs/contributing" },
            ],
        },
    ];

    function isActive(href: string, currentPath: string): boolean {
        // Special case for home/overview pages
        if (href === "/docs") {
            return currentPath === "/docs";
        }

        // Check if it's a hash link (e.g., /docs/api#authentication)
        if (href.includes("#")) {
            const [path, hash] = href.split("#");
            return currentPath === path;
        }

        // Exact match for other pages
        return currentPath === href;
    }

    function toggleSection(index: number) {
        navigation[index].collapsed = !navigation[index].collapsed;
    }
</script>

<nav class="docs-sidebar">
    <div class="sidebar-content">
        <a href="/docs" class="sidebar-header">
            <FileText class="w-5 h-5 text-primary" />
            <span class="font-semibold text-lg">Documentation</span>
        </a>

        <div class="nav-sections">
            {#each navigation as section, index}
                <div class="section">
                    <button
                        class="section-header"
                        on:click={() => toggleSection(index)}
                    >
                        <svelte:component
                            this={section.collapsed
                                ? ChevronRight
                                : ChevronDown}
                            class="w-4 h-4 chevron"
                        />
                        <span class="section-title">{section.title}</span>
                    </button>

                    {#if !section.collapsed}
                        <ul class="section-items">
                            {#each section.items as item}
                                <li>
                                    <a
                                        href={item.href}
                                        class="nav-link {isActive(
                                            item.href,
                                            $page.url.pathname,
                                        )
                                            ? 'active'
                                            : ''}"
                                    >
                                        <FileText class="w-4 h-4 doc-icon" />
                                        <span>{item.title}</span>
                                    </a>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </div>
            {/each}
        </div>

        <div class="sidebar-footer">
            <a
                href="https://github.com/logward-dev/logward"
                target="_blank"
                rel="noopener noreferrer"
                class="github-link"
            >
                <Github class="w-4 h-4" />
                <span>View on GitHub</span>
            </a>
        </div>
    </div>
</nav>

<style>
    .docs-sidebar {
        width: 280px;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        background: hsl(var(--background));
        border-right: 1px solid hsl(var(--border));
    }

    .sidebar-content {
        padding: 1.5rem;
    }

    .sidebar-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
        color: hsl(var(--foreground));
        text-decoration: none;
        transition: opacity 0.2s;
    }

    .sidebar-header:hover {
        opacity: 0.8;
    }

    .nav-sections {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .section {
        margin-bottom: 0.5rem;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        color: hsl(var(--muted-foreground));
        font-size: 0.875rem;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
        border-radius: 0.375rem;
        transition: all 0.2s;
    }

    .section-header:hover {
        background: hsl(var(--muted) / 0.5);
        color: hsl(var(--foreground));
    }

    .chevron :global(svg) {
        flex-shrink: 0;
        transition: transform 0.2s;
    }

    .section-title {
        flex: 1;
    }

    .section-items {
        list-style: none;
        margin: 0;
        padding: 0;
        margin-left: 1rem;
        padding-left: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        border-left: 1px solid rgba(148, 163, 184, 0.15);
        position: relative;
    }

    .nav-link {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        color: hsl(var(--muted-foreground));
        font-size: 0.875rem;
        text-decoration: none;
        border-radius: 0.375rem;
        border-left: 2px solid transparent;
        transition: all 0.2s;
        position: relative;
    }

    .nav-link:hover {
        background: hsl(var(--muted) / 0.5);
        color: hsl(var(--foreground));
    }

    .nav-link.active {
        background: transparent;
        color: hsl(var(--foreground));
        font-weight: 500;
        border-left-color: hsl(var(--primary));
    }

    .nav-link :global(svg) {
        flex-shrink: 0;
        opacity: 0.6;
    }

    .nav-link.active :global(svg) {
        opacity: 0.9;
        color: hsl(var(--primary));
    }

    /* Scrollbar styling */
    .docs-sidebar::-webkit-scrollbar {
        width: 6px;
    }

    .docs-sidebar::-webkit-scrollbar-track {
        background: transparent;
    }

    .docs-sidebar::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.2);
        border-radius: 3px;
    }

    .docs-sidebar::-webkit-scrollbar-thumb:hover {
        background: rgba(148, 163, 184, 0.3);
    }

    .sidebar-footer {
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid hsl(var(--border));
    }

    .github-link {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        color: hsl(var(--muted-foreground));
        font-size: 0.875rem;
        text-decoration: none;
        border-radius: 0.375rem;
        transition: all 0.2s;
    }

    .github-link:hover {
        background: hsl(var(--muted) / 0.5);
        color: hsl(var(--foreground));
    }

    .github-link :global(svg) {
        flex-shrink: 0;
    }

    @media (max-width: 1024px) {
        .docs-sidebar {
            display: none;
        }
    }
</style>
