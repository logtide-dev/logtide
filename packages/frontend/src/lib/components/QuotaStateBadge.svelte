<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';

  let { state }: { state?: 'ok' | 'grace' | 'blocked' | 'unlimited' } = $props();
</script>

{#if state === 'grace'}
  <Badge variant="outline" class="border-amber-500 text-amber-600" data-testid="quota-state-grace">In grace</Badge>
{:else if state === 'blocked'}
  <Badge variant="destructive" data-testid="quota-state-blocked">Blocked</Badge>
{/if}
