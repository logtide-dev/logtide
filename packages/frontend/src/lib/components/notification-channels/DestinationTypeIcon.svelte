<script lang="ts">
  import type { Component } from 'svelte';
  import type { ChannelDisplayType } from '@logtide/shared';
  import Mail from '@lucide/svelte/icons/mail';
  import Webhook from '@lucide/svelte/icons/webhook';
  import Slack from '@lucide/svelte/icons/slack';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import Siren from '@lucide/svelte/icons/siren';
  import { getDestinationType } from './destination-types';

  interface Props {
    type: ChannelDisplayType;
    class?: string;
  }

  let { type, class: className = '' }: Props = $props();

  const ICONS: Record<ChannelDisplayType, Component> = {
    email: Mail as unknown as Component,
    webhook: Webhook as unknown as Component,
    slack: Slack as unknown as Component,
    teams: MessageSquare as unknown as Component,
    discord: MessageCircle as unknown as Component,
    pagerduty: Siren as unknown as Component,
  };

  // Semantic tokens carry their own dark variants (see app.css).
  const CHIPS: Record<ChannelDisplayType, string> = {
    email: 'bg-info/15 text-info-text',
    webhook: 'bg-muted text-muted-foreground',
    slack: 'bg-critical/15 text-critical-text',
    teams: 'bg-info/15 text-info-text',
    discord: 'bg-secondary text-secondary-foreground',
    pagerduty: 'bg-success/15 text-success-text',
  };

  const Icon = $derived(ICONS[type] ?? ICONS.webhook);
  const chip = $derived(CHIPS[type] ?? CHIPS.webhook);
  const label = $derived(getDestinationType(type).label);
</script>

<span
  role="img"
  aria-label={label}
  class="inline-flex size-8 shrink-0 items-center justify-center rounded-full {chip} {className}"
>
  <Icon class="size-4" aria-hidden="true" />
</span>
