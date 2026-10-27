<script lang="ts" module>
  import type { ProjectHealthSummaryEntry } from '$lib/api/project-health';

  export interface HealthPillModel {
    kind: 'healthy' | 'warning' | 'critical' | 'no_data';
    text: string;
  }

  /** Muted issues never count towards the pill. */
  export function describeHealth(entry: ProjectHealthSummaryEntry): HealthPillModel {
    if (entry.status === 'no_data') return { kind: 'no_data', text: 'No data yet' };
    const open = entry.openIssues.filter((i) => !i.muted);
    const critical = open.filter((i) => i.severity === 'critical').length;
    if (critical > 0) return { kind: 'critical', text: `${critical.toLocaleString('en-US')} critical` };
    const warnings = open.length;
    if (warnings > 0) {
      return {
        kind: 'warning',
        text: `${warnings.toLocaleString('en-US')} ${warnings === 1 ? 'warning' : 'warnings'}`,
      };
    }
    return { kind: 'healthy', text: 'Healthy' };
  }
</script>

<script lang="ts">
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
    no_data: 'bg-muted text-muted-foreground',
  };
  const DOT: Record<HealthPillModel['kind'], string> = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    critical: 'bg-red-500',
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
