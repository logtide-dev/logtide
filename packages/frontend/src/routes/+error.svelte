<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle,
    } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import {
        AlertCircle,
        Home,
        Search,
        ArrowLeft,
        FileQuestion,
    } from "lucide-svelte";
    import { fade, fly } from "svelte/transition";

    let status = $derived(page.status);
    let message = $derived(page.error?.message || "An unexpected error occurred");
    let is404 = $derived(status === 404);

    function goBack() {
        window.history.back();
    }

    function goHome() {
        goto("/");
    }

    function goToDashboard() {
        goto("/dashboard");
    }

    function goToSearch() {
        goto("/dashboard/search");
    }
</script>

<div class="min-h-screen flex items-center justify-center p-4 bg-background">
    <div class="w-full max-w-2xl" in:fade={{ duration: 300 }}>
        <Card class="border-border bg-card">
            <CardHeader class="text-center pb-4">
                <!-- Icon Section -->
                <div
                    class="flex justify-center mb-6"
                    in:fly={{ y: -20, duration: 400, delay: 100 }}
                >
                    {#if is404}
                        <div class="relative">
                            <div
                                class="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse"
                            ></div>
                            <div
                                class="relative bg-primary/10 rounded-full p-6"
                            >
                                <FileQuestion
                                    class="w-16 h-16 text-primary"
                                    strokeWidth={1.5}
                                />
                            </div>
                        </div>
                    {:else}
                        <div class="relative">
                            <div
                                class="absolute inset-0 bg-destructive/20 blur-2xl rounded-full animate-pulse"
                            ></div>
                            <div
                                class="relative bg-destructive/10 rounded-full p-6"
                            >
                                <AlertCircle
                                    class="w-16 h-16 text-destructive"
                                    strokeWidth={1.5}
                                />
                            </div>
                        </div>
                    {/if}
                </div>

                <!-- Status Code -->
                <div in:fly={{ y: 20, duration: 400, delay: 200 }}>
                    <div
                        class="text-7xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"
                    >
                        {status}
                    </div>
                </div>

                <!-- Title & Description -->
                <div in:fly={{ y: 20, duration: 400, delay: 300 }}>
                    <CardTitle class="text-2xl mb-2">
                        {#if is404}
                            Page Not Found
                        {:else}
                            Something Went Wrong
                        {/if}
                    </CardTitle>
                    <CardDescription class="text-base">
                        {#if is404}
                            The page you're looking for doesn't exist or has
                            been moved.
                        {:else}
                            {message}
                        {/if}
                    </CardDescription>
                </div>
            </CardHeader>

            <CardContent class="pb-6">
                <!-- Action Buttons -->
                <div
                    class="flex flex-col sm:flex-row gap-3 justify-center"
                    in:fly={{ y: 20, duration: 400, delay: 400 }}
                >
                    <Button variant="default" onclick={goBack} class="gap-2">
                        <ArrowLeft class="w-4 h-4" />
                        Go Back
                    </Button>

                    <Button variant="outline" onclick={goHome} class="gap-2">
                        <Home class="w-4 h-4" />
                        Home
                    </Button>

                    <Button
                        variant="outline"
                        onclick={goToDashboard}
                        class="gap-2"
                    >
                        <Home class="w-4 h-4" />
                        Dashboard
                    </Button>

                    <Button
                        variant="outline"
                        onclick={goToSearch}
                        class="gap-2"
                    >
                        <Search class="w-4 h-4" />
                        Search
                    </Button>
                </div>

                <!-- Additional Info (only show in development) -->
                {#if import.meta.env.DEV && !is404}
                    <div
                        class="mt-6 p-4 bg-muted rounded-lg"
                        in:fade={{ duration: 300, delay: 500 }}
                    >
                        <p
                            class="text-xs text-muted-foreground font-mono break-all"
                        >
                            <span class="font-semibold">Debug Info:</span>
                            {message}
                        </p>
                    </div>
                {/if}
            </CardContent>
        </Card>

        <!-- Footer Hint -->
        <div
            class="text-center mt-6 text-sm text-muted-foreground"
            in:fade={{ duration: 300, delay: 600 }}
        >
            {#if is404}
                <p>If you believe this is a mistake, please contact support.</p>
            {:else}
                <p>
                    If this problem persists, please contact your administrator.
                </p>
            {/if}
        </div>
    </div>
</div>

<style>
    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }

    .animate-pulse {
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
</style>
