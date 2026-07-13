<script lang="ts">
  import { page } from '$app/state';
  import { organizationStore } from '$lib/stores/organization';
  import { layoutStore } from '$lib/stores/layout';
  import { canManageMembers } from '@logtide/shared';
  import type { OrganizationWithRole } from '@logtide/shared';
  import Building2 from '@lucide/svelte/icons/building-2';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import Fingerprint from '@lucide/svelte/icons/fingerprint';
  import BellRing from '@lucide/svelte/icons/bell-ring';
  import Users from '@lucide/svelte/icons/users';
  import ClipboardList from '@lucide/svelte/icons/clipboard-list';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Settings from '@lucide/svelte/icons/settings';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import Send from '@lucide/svelte/icons/send';
  import Newspaper from '@lucide/svelte/icons/newspaper';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let currentOrg = $state<OrganizationWithRole | null>(null);
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
    const unsubscribe = organizationStore.subscribe((state) => {
      currentOrg = state.currentOrganization;
    });
    return unsubscribe;
  });

  interface NavItem {
    label: string;
    href: string;
    icon: typeof Building2;
    adminOnly?: boolean;
    ownerOnly?: boolean;
  }

  interface NavGroup {
    label: string;
    items: NavItem[];
  }

  const navGroups: NavGroup[] = [
    {
      label: 'General',
      items: [
        { label: 'Organization', href: '/dashboard/settings/general', icon: Building2 },
      ],
    },
    {
      label: 'Security & Data',
      items: [
        { label: 'PII Masking', href: '/dashboard/settings/pii-masking', icon: ShieldAlert },
        { label: 'Identifier Patterns', href: '/dashboard/settings/patterns', icon: Fingerprint },
        { label: 'Pipelines', href: '/dashboard/settings/pipelines', icon: GitBranch },
      ],
    },
    {
      label: 'Notifications',
      items: [
        { label: 'Channels', href: '/dashboard/settings/channels', icon: BellRing },
        { label: 'Email Digests', href: '/dashboard/settings/digests', icon: Newspaper },
        { label: 'Webhook Deliveries', href: '/dashboard/settings/webhooks', icon: Send },
      ],
    },
    {
      label: 'Team',
      items: [
        { label: 'Members', href: '/dashboard/settings/members', icon: Users },
      ],
    },
    {
      label: 'Billing & Usage',
      items: [
        { label: 'Usage', href: '/dashboard/settings/usage', icon: BarChart3 },
      ],
    },
    {
      label: 'Administration',
      items: [
        { label: 'Audit Log', href: '/dashboard/settings/audit-log', icon: ClipboardList, adminOnly: true },
      ],
    },
  ];

  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
  }

  let canManage = $derived(currentOrg ? canManageMembers(currentOrg.role) : false);

  let currentPageLabel = $derived(
    navGroups.flatMap((g) => g.items).find((item) => isActive(item.href))?.label ?? 'Settings'
  );

  function shouldShowItem(item: NavItem): boolean {
    if (item.adminOnly && !canManage) return false;
    if (item.ownerOnly && currentOrg?.role !== 'owner') return false;
    return true;
  }

  function shouldShowGroup(group: NavGroup): boolean {
    return group.items.some(shouldShowItem);
  }
</script>

<div class="container mx-auto {containerPadding} {maxWidthClass}">
  <!-- Page Header -->
  <div class="mb-6">
    <div class="flex items-center gap-2 text-sm text-muted-foreground mb-1">
      <Settings class="w-3.5 h-3.5" />
      <span>Settings</span>
      <ChevronRight class="w-3.5 h-3.5" />
      <span class="text-foreground font-medium">{currentPageLabel}</span>
    </div>
    <h1 class="text-3xl font-bold tracking-tight">Settings</h1>
    <p class="text-muted-foreground mt-1">
      Manage settings for {currentOrg?.name || 'your organization'}
    </p>
  </div>

  <div class="flex flex-col lg:flex-row gap-8">
    <!-- Desktop Sidebar -->
    <nav class="hidden lg:block w-56 flex-shrink-0">
      <div class="sticky top-24 space-y-6">
        {#each navGroups as group}
          {#if shouldShowGroup(group)}
            <div>
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
                {group.label}
              </p>
              <div class="space-y-0.5">
                {#each group.items as item}
                  {#if shouldShowItem(item)}
                    {@const Icon = item.icon}
                    <a
                      href={item.href}
                      class="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                        {isActive(item.href)
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'}"
                    >
                      <Icon class="w-4 h-4" />
                      {item.label}
                    </a>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </nav>

    <!-- Mobile Nav -->
    <nav class="lg:hidden -mx-1 overflow-x-auto">
      <div class="flex gap-1 pb-4 min-w-max px-1">
        {#each navGroups as group}
          {#each group.items as item}
            {#if shouldShowItem(item)}
              {@const Icon = item.icon}
              <a
                href={item.href}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors
                  {isActive(item.href)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
              >
                <Icon class="w-3.5 h-3.5" />
                {item.label}
              </a>
            {/if}
          {/each}
        {/each}
      </div>
    </nav>

    <!-- Content Area -->
    <div class="flex-1 min-w-0">
      {@render children?.()}
    </div>
  </div>
</div>
