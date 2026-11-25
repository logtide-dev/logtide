<!--
  Status dot for a metric source.

  Props:
    status  'ok' | 'warning' | 'critical' | 'stale' | 'unknown'
    reason  human reason (statusReason); shown as tooltip and read by screen readers
    showLabel  also print the status word next to the dot (default false)
-->
<script lang="ts">
  import type { MetricSourceStatus } from '@logtide/shared';
  import * as Tooltip from '$lib/components/ui/tooltip';

  interface Props {
    status: MetricSourceStatus;
    reason?: string | null;
    showLabel?: boolean;
  }

  let { status, reason = null, showLabel = false }: Props = $props();

  const STATUS: Record<MetricSourceStatus, { label: string; dot: string }> = {
    ok: { label: 'Healthy', dot: 'bg-success' },
    warning: { label: 'Warning', dot: 'bg-warning' },
    critical: { label: 'Critical', dot: 'bg-destructive' },
    stale: { label: 'No data', dot: 'bg-muted-foreground/60' },
    unknown: { label: 'Unknown', dot: 'bg-muted-foreground/30' },
  };

  const info = $derived(STATUS[status] ?? STATUS.unknown);
  const description = $derived(reason ? `${info.label}: ${reason}` : info.label);
</script>

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="inline-flex items-center gap-2" role="img" aria-label={description} data-status={status}>
          <span class="inline-block h-2.5 w-2.5 rounded-full {info.dot}" data-testid="status-dot"></span>
          {#if showLabel}<span class="text-sm">{info.label}</span>{/if}
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>
      <p class="text-xs">{description}</p>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
