<script lang="ts">
  /**
   * Sub navigation of the Metrics section (1.8): Sources | Explore | Catalog.
   * Links, not tabs: each view has its own URL. The active item follows the
   * current path; host and service pages count as Sources.
   */
  import { page } from '$app/state';

  interface Props {
    /** Extra query string kept on every link (for example the scope params). */
    search?: string;
  }

  let { search = '' }: Props = $props();

  const items = [
    { id: 'sources', label: 'Sources', href: '/dashboard/metrics' },
    { id: 'explore', label: 'Explore', href: '/dashboard/metrics/explore' },
    { id: 'catalog', label: 'Catalog', href: '/dashboard/metrics/catalog' },
  ] as const;

  function activeId(pathname: string): (typeof items)[number]['id'] {
    if (pathname.startsWith('/dashboard/metrics/explore')) return 'explore';
    if (pathname.startsWith('/dashboard/metrics/catalog')) return 'catalog';
    return 'sources';
  }

  const active = $derived(activeId(page.url.pathname));
  const suffix = $derived(search ? (search.startsWith('?') ? search : `?${search}`) : '');
</script>

<nav aria-label="Metrics views" class="flex gap-5 border-b border-border">
  {#each items as item (item.id)}
    <a
      href={`${item.href}${suffix}`}
      class="-mb-px border-b-2 px-0.5 pb-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {active === item.id
        ? 'border-primary font-medium text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'}"
      aria-current={active === item.id ? 'page' : undefined}
      data-sveltekit-noscroll
    >
      {item.label}
    </a>
  {/each}
</nav>
