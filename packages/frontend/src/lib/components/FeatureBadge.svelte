<script lang="ts">
  import { browser } from '$app/environment';
  import { Badge } from '$lib/components/ui/badge';

  interface Props {
    /** Unique ID for this badge (used for acknowledgment persistence) */
    id: string;
    /** Type of badge */
    type: 'new' | 'updated' | 'beta';
    /** Show until this date (ISO string), then auto-hide */
    showUntil?: string;
  }

  let {
    id,
    type = 'new',
    showUntil
  }: Props = $props();

  const ACKNOWLEDGED_KEY = 'logtide_acknowledged_badges';

  let isAcknowledged = $state(false);
  let isExpired = $state(false);

  // Check if this badge was acknowledged or is expired
  $effect(() => {
    if (!browser) return;

    // Check expiration
    if (showUntil) {
      const expirationDate = new Date(showUntil);
      if (new Date() > expirationDate) {
        isExpired = true;
        return;
      }
    }

    // Check acknowledgment
    try {
      const acknowledged = localStorage.getItem(ACKNOWLEDGED_KEY);
      if (acknowledged) {
        const acknowledgedIds = JSON.parse(acknowledged) as string[];
        isAcknowledged = acknowledgedIds.includes(id);
      }
    } catch (e) {
      console.error('Failed to load acknowledged badges:', e);
    }
  });

  export function acknowledge() {
    if (!browser) return;

    try {
      const acknowledged = localStorage.getItem(ACKNOWLEDGED_KEY);
      const acknowledgedIds = acknowledged ? JSON.parse(acknowledged) as string[] : [];

      if (!acknowledgedIds.includes(id)) {
        acknowledgedIds.push(id);
        localStorage.setItem(ACKNOWLEDGED_KEY, JSON.stringify(acknowledgedIds));
      }

      isAcknowledged = true;
    } catch (e) {
      console.error('Failed to acknowledge badge:', e);
    }
  }

  const badgeConfig = {
    new: {
      text: 'New',
      variant: 'default' as const,
      class: 'bg-green-500 hover:bg-green-500/80 text-white'
    },
    updated: {
      text: 'Updated',
      variant: 'secondary' as const,
      class: 'bg-blue-500 hover:bg-blue-500/80 text-white'
    },
    beta: {
      text: 'Beta',
      variant: 'outline' as const,
      class: 'border-orange-500 text-orange-500'
    }
  };

  let config = $derived(badgeConfig[type]);
</script>

{#if !isAcknowledged && !isExpired}
  <Badge
    variant={config.variant}
    class="ml-auto text-[10px] px-1.5 py-0 h-4 {config.class}"
  >
    {config.text}
  </Badge>
{/if}
