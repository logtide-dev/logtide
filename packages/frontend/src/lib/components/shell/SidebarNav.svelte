<script lang="ts">
  import { untrack } from 'svelte';
  import {
    NAV_SECTIONS,
    ADMIN_NAV_ITEM,
    isInNavGroup,
    isNavGroupActive,
    isNavItemActive,
    type NavItem,
  } from '$lib/nav/nav-items';
  import { navIcon } from '$lib/nav/nav-icons';
  import FeatureBadge from '$lib/components/FeatureBadge.svelte';
  import { Separator } from '$lib/components/ui/separator';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  interface Props {
    pathname: string;
    /** Query string of the page: some items are active on a query (Hardware tab). */
    search?: string;
    isAdmin: boolean;
    /** Called after a link is clicked (the drawer closes itself with it) */
    onNavigate?: () => void;
  }

  let { pathname, search = '', isAdmin, onNavigate }: Props = $props();

  const linkBase =
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors';
  const linkIdle = 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground';
  const linkActive = 'bg-nav-active text-nav-active-foreground';

  function linkClass(item: NavItem): string {
    return `${linkBase} ${isNavItemActive(item, pathname, search) ? linkActive : linkIdle}`;
  }

  // A group is open inside its area and closed outside. The chevron overrides
  // that until the page enters or leaves the area again.
  const groups = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.children);
  let overrides = $state<Record<string, boolean>>({});
  let lastArea: Record<string, boolean> = {};
  $effect(() => {
    const now = Object.fromEntries(groups.map((g) => [g.id, isInNavGroup(g, pathname)]));
    untrack(() => {
      const changed = groups.filter((g) => g.id in lastArea && lastArea[g.id] !== now[g.id]).map((g) => g.id);
      if (changed.length > 0) {
        const next = { ...overrides };
        for (const id of changed) delete next[id];
        overrides = next;
      }
      lastArea = now;
    });
  });
  function isOpen(group: NavItem): boolean {
    return overrides[group.id] ?? isInNavGroup(group, pathname);
  }
  function toggle(group: NavItem) {
    overrides = { ...overrides, [group.id]: !isOpen(group) };
  }
</script>

{#snippet navLink(item: NavItem)}
  {@const Icon = navIcon(item.id)}
  <a
    href={item.href}
    target={item.external ? '_blank' : undefined}
    rel={item.external ? 'noopener noreferrer' : undefined}
    data-nav-item={item.id}
    aria-current={isNavItemActive(item, pathname, search) ? 'page' : undefined}
    class={linkClass(item)}
    onclick={() => onNavigate?.()}
  >
    <span data-icon={item.id} class="inline-flex shrink-0" aria-hidden="true">
      <Icon class="w-4 h-4" />
    </span>
    <span class="flex-1">{item.label}</span>
    {#if item.badge}
      <FeatureBadge id={item.badge.id} type={item.badge.type} showUntil={item.badge.showUntil} />
    {/if}
  </a>
{/snippet}

{#snippet navGroup(group: NavItem)}
  {@const Icon = navIcon(group.id)}
  {@const open = isOpen(group)}
  {@const current = isNavGroupActive(group, pathname, search)}
  <div class="relative">
    <a
      href={group.href}
      data-nav-item={group.id}
      class="{linkBase} pr-9 {current ? 'text-foreground' : linkIdle}"
      onclick={() => onNavigate?.()}
    >
      <span data-icon={group.id} class="inline-flex shrink-0" aria-hidden="true">
        <Icon class="w-4 h-4" />
      </span>
      <span class="flex-1">{group.label}</span>
    </a>
    <button
      type="button"
      class="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={open}
      aria-controls="nav-group-{group.id}"
      aria-label="{open ? 'Collapse' : 'Expand'} {group.label}"
      onclick={() => toggle(group)}
    >
      <ChevronRight class="h-4 w-4 transition-transform {open ? 'rotate-90' : ''}" />
    </button>
  </div>
  {#if open}
    <div id="nav-group-{group.id}" class="ml-5 space-y-0.5 border-l border-border pl-2">
      {#each group.children ?? [] as child (child.id)}
        {@const active = isNavItemActive(child, pathname, search)}
        <a
          href={child.href}
          data-nav-item={child.id}
          aria-current={active ? 'page' : undefined}
          class="block rounded-md px-3 py-1.5 text-sm transition-colors {active ? `${linkActive} font-medium` : linkIdle}"
          onclick={() => onNavigate?.()}
        >
          {child.label}
        </a>
      {/each}
    </div>
  {/if}
{/snippet}

<nav class="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Main">
  {#each NAV_SECTIONS as section, sectionIdx (section.id)}
    {#if sectionIdx > 0}
      <Separator class="my-2" />
    {/if}
    {#if section.label}
      <p class="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {section.label}
      </p>
    {/if}
    {#each section.items as item (item.id)}
      {#if item.children}
        {@render navGroup(item)}
      {:else}
        {@render navLink(item)}
      {/if}
    {/each}

    {#if section.id === 'manage' && isAdmin}
      <Separator class="my-2" />
      {@render navLink(ADMIN_NAV_ITEM)}
    {/if}
  {/each}
</nav>
