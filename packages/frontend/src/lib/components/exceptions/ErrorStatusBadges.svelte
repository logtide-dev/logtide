<script lang="ts">
  import type { ErrorGroup } from '@logtide/shared';
  import { Badge } from '$lib/components/ui/badge';
  import ErrorGroupStatusBadge from './shared/ErrorGroupStatusBadge.svelte';
  import { regressedTone } from './error-status';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  interface Props {
    group: Pick<ErrorGroup, 'status' | 'regressedAt'>;
  }

  let { group }: Props = $props();

  const showRegressed = $derived(!!group.regressedAt && group.status !== 'resolved');
  const tone = regressedTone();
</script>

<span class="inline-flex flex-wrap items-center gap-1">
  <ErrorGroupStatusBadge status={group.status} />
  {#if showRegressed}
    <Badge variant="outline" class="{tone.badge} text-xs px-1.5 py-0.5 flex items-center gap-1">
      <RotateCcw class="w-3 h-3" aria-hidden="true" />
      Regressed
    </Badge>
  {/if}
</span>
