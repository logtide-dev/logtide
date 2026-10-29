<script lang="ts">
  import type { Component } from 'svelte';
  import type { ChannelDisplayType } from '@logtide/shared';
  import Mail from '@lucide/svelte/icons/mail';
  import Webhook from '@lucide/svelte/icons/webhook';
  import { BrandIcon, channelBrand } from '$lib/components/brand';
  import { getDestinationType } from './destination-types';

  interface Props {
    type: ChannelDisplayType;
    class?: string;
  }

  let { type, class: className = '' }: Props = $props();

  // Generic destinations get a Lucide glyph; vendors get their own mark.
  const ICONS: Partial<Record<ChannelDisplayType, Component>> = {
    email: Mail as unknown as Component,
    webhook: Webhook as unknown as Component,
  };

  // Semantic tokens carry their own dark variants (see app.css).
  const CHIPS: Partial<Record<ChannelDisplayType, string>> = {
    email: 'bg-info/15 text-info-text',
    webhook: 'bg-muted text-muted-foreground',
  };

  const brand = $derived(channelBrand(type));
  const Icon = $derived(ICONS[type] ?? ICONS.webhook!);
  const chip = $derived(brand ? 'border border-border bg-background text-foreground' : (CHIPS[type] ?? CHIPS.webhook));
  const label = $derived(getDestinationType(type).label);
</script>

<span
  role="img"
  aria-label={label}
  class="inline-flex size-8 shrink-0 items-center justify-center rounded-full {chip} {className}"
>
  {#if brand}
    <BrandIcon {brand} />
  {:else}
    <Icon class="size-4" aria-hidden="true" />
  {/if}
</span>
