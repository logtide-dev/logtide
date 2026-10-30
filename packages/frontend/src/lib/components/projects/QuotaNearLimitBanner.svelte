<script lang="ts">
  import { getCapabilityUsage, type CapabilityUsage } from '$lib/api/usage';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Gauge from '@lucide/svelte/icons/gauge';

  interface Props {
    organizationId: string;
    role: 'owner' | 'admin' | 'member' | null | undefined;
    manageHref?: string;
  }

  let { organizationId, role, manageHref = '/dashboard/settings/usage' }: Props = $props();

  const NEAR_LIMIT = 0.8;

  let caps = $state<CapabilityUsage[]>([]);

  const canSee = $derived(role === 'owner' || role === 'admin');

  $effect(() => {
    const orgId = organizationId;
    if (!canSee || !orgId) {
      caps = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await getCapabilityUsage(orgId);
        if (!cancelled) caps = res?.capabilities ?? [];
      } catch {
        // The banner is advisory: a failure just hides it.
        if (!cancelled) caps = [];
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const near = $derived(
    caps
      .filter((c) => c.kind === 'quota' && c.limit != null && c.limit > 0 && c.current / c.limit >= NEAR_LIMIT)
      .map((c) => ({ ...c, percent: Math.floor((c.current / (c.limit as number)) * 100) }))
      .sort((a, b) => b.percent - a.percent),
  );
</script>

{#if canSee && near.length > 0}
  <Alert data-testid="quota-near-limit-banner" class="border-amber-500/40 bg-amber-500/5">
    <Gauge class="size-4 text-amber-600 dark:text-amber-400" />
    <AlertDescription>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <ul class="space-y-0.5">
          {#each near as cap (cap.capability)}
            <li>{cap.description} is at {cap.percent.toLocaleString('en-US')}% of your plan limit.</li>
          {/each}
        </ul>
        <a href={manageHref} class="text-sm font-medium underline underline-offset-4 hover:text-foreground">
          View usage
        </a>
      </div>
    </AlertDescription>
  </Alert>
{/if}
