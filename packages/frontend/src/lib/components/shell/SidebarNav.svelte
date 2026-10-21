<script lang="ts">
  import { NAV_SECTIONS, ADMIN_NAV_ITEM, isNavItemActive, type NavItem } from '$lib/nav/nav-items';
  import { navIcon } from '$lib/nav/nav-icons';
  import FeatureBadge from '$lib/components/FeatureBadge.svelte';
  import { Separator } from '$lib/components/ui/separator';

  interface Props {
    pathname: string;
    isAdmin: boolean;
    /** Called after a link is clicked (the drawer closes itself with it) */
    onNavigate?: () => void;
  }

  let { pathname, isAdmin, onNavigate }: Props = $props();

  const linkBase =
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors';
  const linkIdle = 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground';
  const linkActive = 'bg-nav-active text-nav-active-foreground';

  function linkClass(item: NavItem): string {
    return `${linkBase} ${isNavItemActive(item, pathname) ? linkActive : linkIdle}`;
  }
</script>

{#snippet navLink(item: NavItem)}
  {@const Icon = navIcon(item.id)}
  <a
    href={item.href}
    target={item.external ? '_blank' : undefined}
    rel={item.external ? 'noopener noreferrer' : undefined}
    data-nav-item={item.id}
    aria-current={isNavItemActive(item, pathname) ? 'page' : undefined}
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
      {@render navLink(item)}
    {/each}

    {#if section.id === 'manage' && isAdmin}
      <Separator class="my-2" />
      {@render navLink(ADMIN_NAV_ITEM)}
    {/if}
  {/each}
</nav>
