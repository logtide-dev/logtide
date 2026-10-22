<script lang="ts">
  import type { Component } from 'svelte';

  interface NavEntry {
    label: string;
    href: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: Component<any> | any;
  }

  interface NavGroup {
    label: string;
    items: NavEntry[];
  }

  interface Props {
    groups: NavGroup[];
    isActive: (href: string) => boolean;
    ariaLabel?: string;
  }

  let { groups, isActive, ariaLabel = 'Section navigation' }: Props = $props();

  let pillRow: HTMLElement | undefined = $state();

  // The pill row scrolls sideways on narrow screens: keep the active pill visible.
  $effect(() => {
    // Re-run when the active entry changes (isActive reads the page store).
    groups.forEach((g) => g.items.forEach((i) => isActive(i.href)));
    const active = pillRow?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  });
</script>

<!-- Desktop sidebar -->
<nav class="hidden lg:block w-56 flex-shrink-0" aria-label={ariaLabel}>
  <div class="sticky top-24 space-y-6">
    {#each groups as group (group.label)}
      <div>
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
          {group.label}
        </p>
        <div class="space-y-0.5">
          {#each group.items as item (item.href)}
            {@const Icon = item.icon}
            <a
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              class="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                {isActive(item.href)
                  ? 'bg-nav-active text-nav-active-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'}"
            >
              <Icon class="w-4 h-4" />
              {item.label}
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</nav>

<!-- Mobile pill row -->
<nav bind:this={pillRow} class="lg:hidden -mx-1 overflow-x-auto" aria-label="{ariaLabel} (compact)">
  <div class="flex gap-1 pb-4 min-w-max px-1">
    {#each groups as group (group.label)}
      {#each group.items as item (item.href)}
        {@const Icon = item.icon}
        <a
          href={item.href}
          aria-current={isActive(item.href) ? 'page' : undefined}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors
            {isActive(item.href)
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
        >
          <Icon class="w-3.5 h-3.5" />
          {item.label}
        </a>
      {/each}
    {/each}
  </div>
</nav>
