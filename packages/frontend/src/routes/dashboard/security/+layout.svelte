<script lang="ts">
  import { page } from '$app/state';
  import { incidentsLink } from './overview-links';

  interface Props {
    children: import('svelte').Snippet;
  }
  let { children }: Props = $props();

  const currentPath = $derived(page.url.pathname);

  const tabs = [
    { label: 'Overview', href: '/dashboard/security' },
    { label: 'Rules', href: '/dashboard/security/rules' },
  ];

  // Rules stays active for sub-paths such as a rule detail page.
  function isTabActive(href: string) {
    if (href === '/dashboard/security') return currentPath === href;
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }
</script>

<div class="border-b border-border bg-card">
  <div class="container mx-auto flex items-center justify-between px-6">
    <nav class="flex items-center gap-1 -mb-px" aria-label="Security sections">
      {#each tabs as tab}
        <a
          href={tab.href}
          aria-current={isTabActive(tab.href) ? 'page' : undefined}
          class="px-4 py-3 text-sm font-medium border-b-2 transition-colors {isTabActive(tab.href)
            ? 'border-nav-active-foreground bg-nav-active text-nav-active-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}"
        >
          {tab.label}
        </a>
      {/each}
    </nav>
    <a
      href={incidentsLink({})}
      class="text-sm text-muted-foreground hover:text-foreground hover:underline"
    >
      View incidents
    </a>
  </div>
</div>

{@render children()}
