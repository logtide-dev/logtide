<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import Inbox from '@lucide/svelte/icons/inbox';
  import SearchX from '@lucide/svelte/icons/search-x';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Rocket from '@lucide/svelte/icons/rocket';

  interface Props {
    variant: 'no-data' | 'no-results' | 'error' | 'setup';
    icon?: Component;
    title: string;
    description?: string;
    actions?: Snippet;
  }

  let { variant, icon, title, description, actions }: Props = $props();

  const DEFAULT_ICONS: Record<Props['variant'], Component> = {
    'no-data': Inbox as unknown as Component,
    'no-results': SearchX as unknown as Component,
    error: TriangleAlert as unknown as Component,
    setup: Rocket as unknown as Component,
  };

  const Icon = $derived(icon ?? DEFAULT_ICONS[variant]);
  const isError = $derived(variant === 'error');
</script>

<div
  role={isError ? 'alert' : 'status'}
  class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center"
>
  <Icon
    class="size-10 {isError ? 'text-destructive-text' : 'text-muted-foreground'}"
    aria-hidden="true"
  />
  <div class="space-y-1">
    <h3 class="text-base font-semibold">{title}</h3>
    {#if description}
      <p class="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
