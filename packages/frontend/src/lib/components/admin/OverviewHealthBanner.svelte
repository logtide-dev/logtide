<script lang="ts">
  import type { HealthStats } from '$lib/api/admin';
  import { stateTone } from '$lib/utils/severity';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { overallHealth } from './overview-health';

  interface Props {
    health: HealthStats | null;
    loading: boolean;
    error?: string | null;
  }

  let { health, loading, error = null }: Props = $props();

  const info = $derived(overallHealth(health));
  const tone = $derived(stateTone(info.tone));
</script>

{#if loading && !health}
  <Skeleton class="h-12 w-full" />
{:else}
  <div
    role="status"
    data-testid="overview-health"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 {tone.badge}"
  >
    <span class="size-2.5 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
    <p class="font-semibold">{info.label}</p>
    {#if info.problems.length > 0}
      <p class="text-sm">{info.problems.join(', ')}</p>
    {:else if !health && error}
      <p class="text-sm">{error}</p>
    {/if}
    <a href="/dashboard/admin/system-health" class="ml-auto text-sm font-medium underline-offset-4 hover:underline">
      System health
    </a>
  </div>
{/if}
