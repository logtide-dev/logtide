<script lang="ts">
  import type { ProjectHealthSummaryEntry } from '$lib/api/project-health';
  import { describeHealth, type HealthPillModel } from './health-pill';

  interface Props {
    /** undefined while the summary is loading or failed: renders a dash. */
    entry: ProjectHealthSummaryEntry | undefined;
  }

  let { entry }: Props = $props();

  const model = $derived(entry ? describeHealth(entry) : null);

  const TONE: Record<HealthPillModel['kind'], string> = {
    healthy: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    critical: 'bg-red-500/10 text-red-700 dark:text-red-400',
    inactive: 'bg-muted text-muted-foreground',
    no_data: 'bg-muted text-muted-foreground',
  };
  const DOT: Record<HealthPillModel['kind'], string> = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
    inactive: 'bg-muted-foreground',
    no_data: 'bg-muted-foreground/50',
  };
</script>

{#if model}
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium {TONE[model.kind]}"
    data-testid="health-pill"
    data-kind={model.kind}
  >
    <span class="size-1.5 rounded-full {DOT[model.kind]}" aria-hidden="true"></span>
    {model.text}
  </span>
{:else}
  <span class="text-muted-foreground" data-testid="health-pill-empty">-</span>
{/if}
