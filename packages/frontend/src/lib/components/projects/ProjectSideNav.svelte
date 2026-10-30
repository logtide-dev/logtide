<script lang="ts" module>
  export interface ProjectNavItem {
    id: string;
    label: string;
    /** Settings anchor, or null for the project root (Health). */
    anchor: string | null;
  }

  export const PROJECT_NAV_ITEMS: ProjectNavItem[] = [
    { id: 'health', label: 'Health', anchor: null },
    { id: 'general', label: 'General', anchor: 'general' },
    { id: 'connect', label: 'Connect', anchor: 'connect' },
    { id: 'api-keys', label: 'API keys', anchor: 'api-keys' },
    { id: 'inbound-webhooks', label: 'Receivers', anchor: 'inbound-webhooks' },
    { id: 'notifications', label: 'Notifications', anchor: 'notifications' },
    { id: 'danger-zone', label: 'Danger zone', anchor: 'danger-zone' },
  ];
</script>

<script lang="ts">
  interface Props {
    projectId: string;
    pathname: string;
    hash?: string;
    /** Unmuted open issues, shown as a badge on Health. */
    issueCount?: number;
    /** A deleted project is read-only: only Health stays. */
    deleted?: boolean;
  }

  let { projectId, pathname, hash = '', issueCount = 0, deleted = false }: Props = $props();

  const base = $derived(`/dashboard/projects/${encodeURIComponent(projectId)}`);
  const items = $derived(deleted ? PROJECT_NAV_ITEMS.slice(0, 1) : PROJECT_NAV_ITEMS);
  const onSettings = $derived(/\/settings\/?$/.test(pathname));

  function hrefFor(item: ProjectNavItem): string {
    return item.anchor ? `${base}/settings#${item.anchor}` : base;
  }

  // Scroll spy: on the settings page the active item follows the section in view.
  let spyAnchor = $state<string | null>(null);

  $effect(() => {
    if (!onSettings || typeof window === 'undefined') {
      spyAnchor = null;
      return;
    }
    const anchors = PROJECT_NAV_ITEMS.flatMap((i) => (i.anchor ? [i.anchor] : []));
    const update = () => {
      let current: string | null = null;
      for (const anchor of anchors) {
        const el = document.getElementById(anchor);
        if (el && el.getBoundingClientRect().top <= 120) current = anchor;
      }
      // At the bottom of the page the last short sections never reach the top.
      const { scrollHeight } = document.documentElement;
      if (current && scrollHeight > window.innerHeight && window.innerHeight + window.scrollY >= scrollHeight - 2) {
        current = anchors[anchors.length - 1];
      }
      spyAnchor = current;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  });

  function isActive(item: ProjectNavItem): boolean {
    if (!item.anchor) return !onSettings;
    if (!onSettings) return false;
    return (spyAnchor ?? (hash.replace(/^#/, '') || 'general')) === item.anchor;
  }
</script>

<nav
  aria-label="Project sections"
  class="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-20 md:w-44 md:shrink-0 md:flex-col md:self-start md:overflow-visible md:pb-0"
  data-testid="project-side-nav"
>
  {#each items as item (item.id)}
    {@const active = isActive(item)}
    <a
      href={hrefFor(item)}
      aria-current={active ? 'page' : undefined}
      data-testid="project-nav-{item.id}"
      class="flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors
        {active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}
        {item.id === 'danger-zone' && !active ? 'hover:text-destructive-text' : ''}"
    >
      {item.label}
      {#if item.anchor === null && issueCount > 0}
        <span
          class="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500/15 px-1.5 text-xs font-semibold text-red-700 dark:text-red-400"
          data-testid="project-nav-badge"
          aria-label="{issueCount} open {issueCount === 1 ? 'issue' : 'issues'}"
        >
          {issueCount.toLocaleString('en-US')}
        </span>
      {/if}
    </a>
  {/each}
</nav>
