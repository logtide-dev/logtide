<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { formatResetDate } from '$lib/utils/quota';

  let {
    state,
    resetsAt = null,
  }: {
    state?: 'ok' | 'grace' | 'blocked' | 'unlimited';
    resetsAt?: Date | string | null;
  } = $props();

  const resetLabel = $derived.by(() => {
    if (!resetsAt) return null;
    const d = resetsAt instanceof Date ? resetsAt : new Date(resetsAt);
    return isNaN(d.getTime()) ? null : formatResetDate(d);
  });
</script>

{#if state === 'grace'}
  <Badge variant="outline" class="border-warning text-warning-text" data-testid="quota-state-grace">
    {resetLabel ? `Over limit, grace until ${resetLabel}` : 'Over limit, grace allowance in use'}
  </Badge>
{:else if state === 'blocked'}
  <Badge variant="destructive" data-testid="quota-state-blocked">
    {resetLabel ? `Blocked, over limit, resets ${resetLabel}` : 'Blocked, over limit'}
  </Badge>
{/if}
