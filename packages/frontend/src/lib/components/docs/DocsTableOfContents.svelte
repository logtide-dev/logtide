<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";

    interface TocItem {
        id: string;
        text: string;
        level: number;
    }

    let headings: TocItem[] = [];
    let activeId = "";

    // Re-extract headings when page changes (browser only)
    $: if (typeof window !== "undefined" && $page.url.pathname) {
        // Use setTimeout to ensure DOM has updated
        setTimeout(() => extractHeadings(), 50);
    }

    function extractHeadings() {
        // Only run in browser
        if (typeof window === "undefined") return;

        // Extract h2 and h3 headings from the content
        const contentArea = document.querySelector(".docs-content");
        if (!contentArea) {
            headings = [];
            return;
        }

        const headingElements = contentArea.querySelectorAll("h2, h3");
        headings = Array.from(headingElements)
            .filter((el) => el.id && el.id.length > 0) // Only headings with IDs
            .map((el) => ({
                id: el.id,
                text: el.textContent || "",
                level: parseInt(el.tagName.substring(1)),
            }));

        // Set initial active heading
        updateActiveHeading();
    }

    function updateActiveHeading() {
        if (headings.length === 0) return;

        const scrollTop = window.scrollY;
        const offset = 120; // Account for fixed header

        // Find the heading that's currently at or above the scroll position
        let currentId = headings[0]?.id || "";

        for (const heading of headings) {
            const element = document.getElementById(heading.id);
            if (element) {
                const top = element.getBoundingClientRect().top + scrollTop;
                if (top <= scrollTop + offset) {
                    currentId = heading.id;
                } else {
                    break;
                }
            }
        }

        if (currentId !== activeId) {
            activeId = currentId;
        }
    }

    onMount(() => {
        extractHeadings();

        // Use scroll event for tracking
        window.addEventListener("scroll", updateActiveHeading, { passive: true });

        return () => {
            window.removeEventListener("scroll", updateActiveHeading);
        };
    });

    function scrollToHeading(id: string) {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }
</script>

{#if headings.length > 0}
    <nav class="docs-toc">
        <div class="toc-content">
            <h4 class="toc-header">ON THIS PAGE</h4>

            <ul class="toc-list">
                {#each headings as heading}
                    <li
                        class="toc-item"
                        class:toc-item-h3={heading.level === 3}
                    >
                        <button
                            on:click={() => scrollToHeading(heading.id)}
                            title={heading.text}
                            class="toc-link {activeId === heading.id
                                ? 'active'
                                : ''}"
                        >
                            {heading.text}
                        </button>
                    </li>
                {/each}
            </ul>
        </div>
    </nav>
{/if}

<style>
    .docs-toc {
        width: 240px;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        background: hsl(var(--background));
        border-left: 1px solid hsl(var(--border));
    }

    .toc-content {
        padding: 1.5rem 1rem;
    }

    .toc-header {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: hsl(var(--muted-foreground));
        margin-bottom: 1rem;
        padding-left: 0.5rem;
    }

    .toc-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .toc-item {
        position: relative;
    }

    .toc-item-h3 {
        padding-left: 0.75rem;
    }

    .toc-link {
        display: block;
        width: 100%;
        text-align: left;
        padding: 0.375rem 0.5rem;
        padding-left: 0.75rem;
        font-size: 0.813rem;
        line-height: 1.4;
        color: hsl(var(--muted-foreground));
        background: none;
        border: none;
        border-left: 2px solid transparent;
        cursor: pointer;
        transition: all 0.2s;
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
    }

    .toc-link:hover {
        color: hsl(var(--foreground));
        background: hsl(var(--muted) / 0.3);
    }

    .toc-link.active {
        color: hsl(var(--foreground));
        font-weight: 500;
        border-left-color: hsl(var(--primary));
        background: transparent;
    }

    /* Scrollbar styling */
    .docs-toc::-webkit-scrollbar {
        width: 6px;
    }

    .docs-toc::-webkit-scrollbar-track {
        background: transparent;
    }

    .docs-toc::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.2);
        border-radius: 3px;
    }

    .docs-toc::-webkit-scrollbar-thumb:hover {
        background: rgba(148, 163, 184, 0.3);
    }

    @media (max-width: 1280px) {
        .docs-toc {
            display: none;
        }
    }
</style>
