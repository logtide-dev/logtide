<script lang="ts">
  // Big aggregated banner: All systems operational / Partial outage / Major outage.
  // Mirrors the look-and-feel of the public status page banner so users get the
  // same visual cue inside their custom dashboards.

  import type { SystemStatusConfig } from '@logtide/shared';
  import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import XOctagon from '@lucide/svelte/icons/x-octagon';
  import HelpCircle from '@lucide/svelte/icons/help-circle';
  import { stateTone } from '$lib/utils/severity';

  interface SystemStatusData {
    overallStatus: 'operational' | 'degraded' | 'outage' | 'no_monitors';
    totalMonitors: number;
    upCount: number;
    downCount: number;
    unknownCount: number;
  }

  interface Props {
    config: SystemStatusConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config, data }: Props = $props();
  const typed = $derived(data as SystemStatusData | null);

  function bannerStyle(s: SystemStatusData['overallStatus'] | undefined) {
    if (s === 'operational') {
      return {
        bg: 'bg-success/10 border-success/30',
        text: stateTone('ok').text,
        dot: stateTone('ok').dot,
        label: 'All systems operational',
        icon: CheckCircle2,
      };
    }
    if (s === 'degraded') {
      return {
        bg: 'bg-warning/10 border-warning/30',
        text: stateTone('acknowledged').text,
        dot: stateTone('acknowledged').dot,
        label: 'Partial system outage',
        icon: AlertTriangle,
      };
    }
    if (s === 'outage') {
      return {
        bg: 'bg-destructive/10 border-destructive/30',
        text: stateTone('down').text,
        dot: stateTone('down').dot,
        label: 'Major system outage',
        icon: XOctagon,
      };
    }
    return {
      bg: 'bg-muted/30 border-border',
      text: 'text-muted-foreground',
      dot: 'bg-muted-foreground',
      label: 'No monitors configured',
      icon: HelpCircle,
    };
  }

  const banner = $derived(bannerStyle(typed?.overallStatus));
  const Icon = $derived(banner.icon);
</script>

<div class="h-full w-full p-3">
  <div
    class="h-full rounded-lg border {banner.bg} px-5 py-4 flex items-center justify-between gap-4"
  >
    <div class="flex items-center gap-3 min-w-0">
      <span class="relative flex h-3 w-3 flex-shrink-0">
        {#if typed?.overallStatus === 'operational' || typed?.overallStatus === 'degraded' || typed?.overallStatus === 'outage'}
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full {banner.dot} opacity-60"></span>
        {/if}
        <span class="relative inline-flex h-3 w-3 rounded-full {banner.dot} shadow-sm"></span>
      </span>
      <Icon class="w-5 h-5 flex-shrink-0 {banner.text}" />
      <span class="text-base sm:text-lg font-semibold truncate {banner.text}">
        {banner.label}
      </span>
    </div>

    {#if config.showCounts && typed && typed.totalMonitors > 0}
      <div class="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm flex-shrink-0">
        <div class="flex items-center gap-1.5 {stateTone('ok').text}">
          <span class="font-semibold">{typed.upCount}</span>
          <span class="hidden sm:inline">up</span>
        </div>
        {#if typed.downCount > 0}
          <div class="flex items-center gap-1.5 {stateTone('down').text}">
            <span class="font-semibold">{typed.downCount}</span>
            <span class="hidden sm:inline">down</span>
          </div>
        {/if}
        {#if typed.unknownCount > 0}
          <div class="flex items-center gap-1.5 text-muted-foreground">
            <span class="font-semibold">{typed.unknownCount}</span>
            <span class="hidden sm:inline">unknown</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
