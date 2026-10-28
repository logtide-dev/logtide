<script lang="ts" module>
  export interface OrgNavItem {
    id: string;
    label: string;
  }

  export const ORG_NAV_ITEMS: OrgNavItem[] = [
    { id: 'projects', label: 'Projects' },
    { id: 'members', label: 'Members' },
    { id: 'retention', label: 'Retention' },
    { id: 'entitlements', label: 'Entitlements' },
    { id: 'danger-zone', label: 'Danger zone' },
  ];
</script>

<script lang="ts">
  interface Props {
    /** Section id currently in view or last clicked. */
    active?: string;
  }

  let { active = 'projects' }: Props = $props();
</script>

<nav
  aria-label="Organization sections"
  class="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-20 md:w-44 md:shrink-0 md:flex-col md:self-start md:overflow-visible md:pb-0"
  data-testid="org-side-nav"
>
  {#each ORG_NAV_ITEMS as item (item.id)}
    <a
      href="#{item.id}"
      aria-current={active === item.id ? 'true' : undefined}
      data-testid="org-nav-{item.id}"
      class="flex shrink-0 items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors
        {active === item.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}
        {item.id === 'danger-zone' && active !== item.id ? 'hover:text-destructive-text' : ''}"
    >
      {item.label}
    </a>
  {/each}
</nav>
