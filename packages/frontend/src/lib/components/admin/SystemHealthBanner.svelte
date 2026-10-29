<script lang="ts">
  import { stateTone } from '$lib/utils/severity';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { healthState } from './system-health';

  interface Props {
    /** Overall status from the health stats, or null when unavailable. */
    overall: string | null;
    loading: boolean;
    error?: string | null;
  }

  let { overall, loading, error = null }: Props = $props();

  const info = $derived(healthState(overall));
  const tone = $derived(stateTone(info.state));

  const SUMMARY: Record<string, string> = {
    healthy: 'All components are responding normally.',
    degraded: 'At least one component is slow or partially failing.',
    down: 'At least one component is not responding.',
  };
</script>

{#if loading && !overall}
  <Skeleton class="h-16 w-full" />
{:else if !overall}
  <div role="status" class="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
    Overall status is unavailable{error ? `: ${error}` : ''}.
  </div>
{:else}
  <div
    role="status"
    data-testid="health-banner"
    class="flex items-center gap-3 rounded-lg border p-4 {tone.badge}"
  >
    <span class="size-3 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
    <div>
      <p class="font-semibold">System {info.label.toLowerCase()}</p>
      <p class="text-sm opacity-90">{SUMMARY[overall] ?? ''}</p>
    </div>
  </div>
{/if}
