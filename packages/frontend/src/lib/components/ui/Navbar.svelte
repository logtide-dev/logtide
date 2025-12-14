<script lang="ts">
    import { page } from "$app/stores";
    import { Menu, X, Github } from "lucide-svelte";
    import ThemeToggle from "$lib/components/ThemeToggle.svelte";
    import { logoPath } from "$lib/utils/theme";

    let mobileMenuOpen = false;

    function toggleMobileMenu() {
        mobileMenuOpen = !mobileMenuOpen;
    }

    function closeMobileMenu() {
        mobileMenuOpen = false;
    }

    $: currentPath = $page.url.pathname;
    $: isDashboard =
        currentPath === "/" ||
        (!currentPath.startsWith("/docs") &&
            !currentPath.startsWith("/login") &&
            !currentPath.startsWith("/register"));
    $: isDocs = currentPath.startsWith("/docs");
</script>

<nav class="navbar">
    <div class="navbar-container">
        <!-- Logo/Brand -->
        <a href="/" class="navbar-brand" on:click={closeMobileMenu}>
            <img src={$logoPath} alt="LogWard" class="h-10 w-auto" />
        </a>

        <!-- Desktop Navigation -->
        <div class="navbar-links desktop">
            <a href="/" class="nav-link {isDashboard ? 'active' : ''}">
                Dashboard
            </a>
            <a href="/docs" class="nav-link {isDocs ? 'active' : ''}"> Docs </a>
            <a
                href="https://github.com/logward-dev/logward"
                target="_blank"
                rel="noopener noreferrer"
                class="nav-link github-link"
                title="View on GitHub"
            >
                <Github class="w-4 h-4" />
            </a>
            <ThemeToggle />
        </div>

        <!-- Mobile Menu Button -->
        <button
            class="mobile-menu-button"
            on:click={toggleMobileMenu}
            aria-label="Toggle menu"
        >
            {#if mobileMenuOpen}
                <X class="w-6 h-6" />
            {:else}
                <Menu class="w-6 h-6" />
            {/if}
        </button>
    </div>

    <!-- Mobile Navigation -->
    {#if mobileMenuOpen}
        <div class="navbar-links mobile">
            <a
                href="/"
                class="nav-link {isDashboard ? 'active' : ''}"
                on:click={closeMobileMenu}
            >
                Dashboard
            </a>
            <a
                href="/docs"
                class="nav-link {isDocs ? 'active' : ''}"
                on:click={closeMobileMenu}
            >
                Docs
            </a>
            <a
                href="https://github.com/logward-dev/logward"
                target="_blank"
                rel="noopener noreferrer"
                class="nav-link"
                on:click={closeMobileMenu}
            >
                <Github class="w-4 h-4 inline-block mr-2" />
                GitHub
            </a>
        </div>
    {/if}
</nav>

<style>
    .navbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 50;
        background: hsl(var(--background));
        border-bottom: 1px solid hsl(var(--border));
        backdrop-filter: blur(8px);
    }

    .navbar-container {
        max-width: 1400px;
        margin: 0 auto;
        padding: 0 1rem;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .navbar-brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        text-decoration: none;
        font-weight: 600;
        font-size: 1.25rem;
        color: hsl(var(--foreground));
        transition: opacity 0.2s;
    }

    .navbar-brand:hover {
        opacity: 0.8;
    }

    .navbar-links {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .navbar-links.desktop {
        display: none;
    }

    @media (min-width: 768px) {
        .navbar-links.desktop {
            display: flex;
        }
    }

    .navbar-links.mobile {
        position: absolute;
        top: 64px;
        left: 0;
        right: 0;
        background: hsl(var(--background));
        border-bottom: 1px solid hsl(var(--border));
        padding: 1rem;
        flex-direction: column;
        gap: 0.5rem;
        animation: slideDown 0.2s ease-out;
    }

    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .nav-link {
        padding: 0.5rem 1rem;
        border-radius: 0.375rem;
        text-decoration: none;
        color: hsl(var(--muted-foreground));
        font-size: 0.875rem;
        font-weight: 500;
        transition: all 0.2s;
        position: relative;
    }

    .nav-link:hover {
        color: hsl(var(--foreground));
        background: hsl(var(--muted) / 0.5);
    }

    .nav-link.active {
        color: hsl(var(--primary));
        background: hsl(var(--primary) / 0.1);
    }

    .github-link {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem;
    }

    .github-link:hover {
        color: hsl(var(--foreground));
    }

    .mobile-menu-button {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem;
        border: none;
        background: transparent;
        color: hsl(var(--foreground));
        cursor: pointer;
        border-radius: 0.375rem;
        transition: background 0.2s;
    }

    .mobile-menu-button:hover {
        background: hsl(var(--muted) / 0.5);
    }

    @media (min-width: 768px) {
        .mobile-menu-button {
            display: none;
        }
    }
</style>
