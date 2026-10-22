<script lang="ts">
  import type { Snippet } from 'svelte';
  import { readableForeground } from '../contrast';

  interface Props {
    title: string;
    description: string | null;
    logoUrl: string | null;
    accentColor: string | null;
    /** Anchor of the subscribe form; omit when subscriptions are off. */
    subscribeHref?: string;
    actions?: Snippet;
  }

  let { title, description, logoUrl, accentColor, subscribeHref, actions }: Props = $props();

  let failedLogo = $state<string | null>(null);
  const showLogo = $derived(!!logoUrl && failedLogo !== logoUrl);

  // The accent only paints decorative parts and the button; body text keeps the theme colour.
  const foreground = $derived(accentColor ? readableForeground(accentColor) : null);
  const accent = $derived(foreground ? accentColor : null);
</script>

<header
  class="mb-6 flex flex-wrap items-start justify-between gap-3 border-t-4 pt-4 {accent ? '' : 'border-primary'}"
  style={accent ? `border-color: ${accent}` : undefined}
>
  <div class="min-w-0">
    <h1 class="text-xl font-bold tracking-tight {showLogo ? 'sr-only' : ''}">{title}</h1>
    {#if showLogo}
      <img
        src={logoUrl}
        alt={title}
        class="h-10 max-w-64 object-contain object-left"
        onerror={() => (failedLogo = logoUrl)}
      />
    {/if}
    {#if description}
      <p class="mt-1 text-sm text-muted-foreground">{description}</p>
    {:else if !showLogo}
      <p class="mt-0.5 text-xs text-muted-foreground">Service status</p>
    {/if}
  </div>
  <div class="flex items-center gap-2">
    {#if subscribeHref}
      <a
        href={subscribeHref}
        class="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors {accent
          ? 'hover:opacity-90'
          : 'bg-primary text-primary-foreground hover:bg-primary/90'}"
        style={accent ? `background-color: ${accent}; color: ${foreground}` : undefined}
      >
        Subscribe to updates
      </a>
    {/if}
    {@render actions?.()}
  </div>
</header>
