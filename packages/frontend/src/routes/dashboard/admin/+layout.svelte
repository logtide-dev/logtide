<script lang="ts">
  import { page } from '$app/state';
  import {
    LayoutDashboard,
    Users,
    Building2,
    FolderKanban,
    Settings,
    KeyRound,
    HeartPulse,
    BarChart3,
  } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { authStore } from '$lib/stores/auth';
  import { layoutStore } from '$lib/stores/layout';
  import { UsersAPI } from '$lib/api/users';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import SectionNav from '$lib/components/settings/SectionNav.svelte';

  let { children }: { children: Snippet } = $props();

  // Centralized admin guard for the whole /dashboard/admin section.
  // This layout nests inside the dashboard layout (AppLayout), but the app
  // shell does not know about is_admin, so enforce it here: individual admin
  // pages must never load data before the guard has resolved.
  let adminResolved = $state(false);

  const usersAPI = new UsersAPI(() => get(authStore).token);

  let maxWidthClass = $state('max-w-7xl');
  let containerPadding = $state('px-6 py-8');

  $effect(() => {
    const unsubscribe = layoutStore.maxWidthClass.subscribe((value) => {
      maxWidthClass = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = layoutStore.containerPadding.subscribe((value) => {
      containerPadding = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    if (!browser) return;

    if (!$authStore.token) {
      untrack(() => goto('/login'));
      return;
    }

    if (!$authStore.user) return;

    if ($authStore.user.is_admin === undefined) {
      untrack(() => {
        usersAPI
          .getCurrentUser()
          .then(({ user }) => {
            const currentUser = get(authStore).user;
            if (currentUser) {
              authStore.updateUser({ ...currentUser, ...user });
            }
            if (user.is_admin) {
              adminResolved = true;
            } else {
              goto('/dashboard');
            }
          })
          .catch(() => goto('/dashboard'));
      });
    } else if ($authStore.user.is_admin === false) {
      untrack(() => goto('/dashboard'));
    } else {
      adminResolved = true;
    }
  });

  const groups = [
    {
      label: 'Instance',
      items: [
        { label: 'Instance overview', href: '/dashboard/admin', icon: LayoutDashboard },
        { label: 'System health', href: '/dashboard/admin/system-health', icon: HeartPulse },
        { label: 'Instance usage', href: '/dashboard/admin/usage', icon: BarChart3 },
        { label: 'Instance settings', href: '/dashboard/admin/settings', icon: Settings },
      ],
    },
    {
      label: 'Manage',
      items: [
        { label: 'All organizations', href: '/dashboard/admin/organizations', icon: Building2 },
        { label: 'All projects', href: '/dashboard/admin/projects', icon: FolderKanban },
        { label: 'All users', href: '/dashboard/admin/users', icon: Users },
        { label: 'Auth providers', href: '/dashboard/admin/auth-providers', icon: KeyRound },
      ],
    },
  ];

  const currentPath = $derived(page.url.pathname);

  function isActive(href: string): boolean {
    if (href === '/dashboard/admin') {
      return currentPath === '/dashboard/admin';
    }
    return currentPath === href || currentPath.startsWith(href + '/');
  }
</script>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <div class="flex flex-col lg:flex-row gap-8">
    <div class="flex-shrink-0 lg:w-56">
      <span
        class="mb-4 inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
      >
        Instance admin
      </span>
      <SectionNav {groups} {isActive} ariaLabel="Instance admin navigation" />
    </div>

    <div class="flex-1 min-w-0">
      {#if adminResolved}
        {@render children()}
      {/if}
    </div>
  </div>
</div>
