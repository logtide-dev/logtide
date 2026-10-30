<script lang="ts">
  import { onMount } from 'svelte';
  import { onboardingStore } from '$lib/stores/onboarding';
  import Button from '$lib/components/ui/button/button.svelte';
  import PartyPopper from '@lucide/svelte/icons/party-popper';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Bug from '@lucide/svelte/icons/bug';
  import Bell from '@lucide/svelte/icons/bell';
  import BookOpen from '@lucide/svelte/icons/book-open';

  const projectId = $derived($onboardingStore.projectId);

  const links = $derived([
    {
      href: projectId ? `/dashboard/logs?project=${projectId}` : '/dashboard/logs',
      label: 'Explore your logs',
      description: 'Search and filter what just arrived',
      icon: ScrollText,
    },
    {
      href: '/dashboard/traces',
      label: 'Open traces',
      description: 'Follow a request across services',
      icon: GitBranch,
    },
    {
      href: '/dashboard/errors',
      label: 'See errors',
      description: 'Grouped exceptions from your apps',
      icon: Bug,
    },
    {
      href: projectId
        ? `/dashboard/alerts?create=1&projectId=${projectId}`
        : '/dashboard/alerts?create=1',
      label: 'Create an alert',
      description: 'Get notified when something breaks',
      icon: Bell,
    },
  ]);

  onMount(() => {
    void onboardingStore.complete();
  });
</script>

<div class="space-y-8">
  <div class="space-y-2 text-center">
    <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
      <PartyPopper class="h-8 w-8 text-primary-text" aria-hidden="true" />
    </div>
    <h2 class="text-2xl font-bold">You're all set</h2>
    <p class="mx-auto max-w-md text-muted-foreground">
      Your workspace is ready. Here are good places to go next.
    </p>
  </div>

  <div class="grid gap-3 sm:grid-cols-2">
    {#each links as link (link.href)}
      <a
        href={link.href}
        class="flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <link.icon class="mt-0.5 h-5 w-5 shrink-0 text-primary-text" aria-hidden="true" />
        <span>
          <span class="block text-sm font-medium">{link.label}</span>
          <span class="block text-xs text-muted-foreground">{link.description}</span>
        </span>
      </a>
    {/each}
  </div>

  <div class="flex flex-wrap items-center justify-center gap-3">
    <Button href="/dashboard">Go to dashboard</Button>
    <Button variant="outline" href="https://logtide.dev/docs" target="_blank" rel="noopener noreferrer">
      <BookOpen class="mr-2 h-4 w-4" aria-hidden="true" />
      Read the docs
    </Button>
  </div>
</div>
