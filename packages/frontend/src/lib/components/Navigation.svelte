<script lang="ts">
  import { page } from '$app/stores';
  import Button from '$lib/components/ui/button/button.svelte';
  import { goto } from '$app/navigation';

  interface NavItem {
    label: string;
    path: string;
  }

  const navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Search', path: '/dashboard/search' },
    { label: 'Traces', path: '/dashboard/traces' },
    { label: 'Alerts', path: '/dashboard/alerts' },
    { label: 'Settings', path: '/dashboard/settings' },
  ];

  let currentPath = $derived($page.url.pathname);

  function isActive(path: string): boolean {
    return currentPath === path;
  }

  function navigateTo(path: string) {
    goto(path);
  }
</script>

<nav class="flex items-center gap-1">
  {#each navItems as item}
    <Button
      variant={isActive(item.path) ? 'default' : 'ghost'}
      size="sm"
      onclick={() => navigateTo(item.path)}
    >
      {item.label}
    </Button>
  {/each}
</nav>
