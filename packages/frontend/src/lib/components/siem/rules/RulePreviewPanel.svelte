<script lang="ts">
  import type { SigmaRulePreviewResult } from '@logtide/shared';
  import { sigmaAPI, SigmaApiError } from '$lib/api/sigma';
  import { Button } from '$lib/components/ui/button';
  import Spinner from '$lib/components/Spinner.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import KeyValueTable from '$lib/components/app/KeyValueTable.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import { logLink } from '$lib/components/siem/shared/log-link';

  interface Props {
    organizationId: string;
    ruleId: string;
    /** Returns unsaved YAML from the editor, or null to preview the stored rule. */
    getDraftYaml?: () => string | null;
  }

  let { organizationId, ruleId, getDraftYaml }: Props = $props();

  type Range = '24h' | '7d';
  const RANGES: { value: Range; label: string }[] = [
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
  ];

  const TRUNCATION_TEXT: Record<'max_logs' | 'timeout', string> = {
    max_logs: 'Scanned the 50,000 most recent logs',
    timeout: 'Stopped after 30 seconds',
  };

  let range = $state<Range>('24h');
  let running = $state(false);
  let elapsed = $state(0);
  let result = $state<SigmaRulePreviewResult | null>(null);
  let error = $state('');

  $effect(() => {
    if (!running) return;
    elapsed = 0;
    const timer = setInterval(() => (elapsed += 1), 1000);
    return () => clearInterval(timer);
  });

  // A different rule must not show the previous rule's preview.
  $effect(() => {
    ruleId;
    result = null;
    error = '';
  });

  async function run() {
    if (running) return;
    running = true;
    error = '';
    try {
      const draft = getDraftYaml?.() ?? null;
      result = await sigmaAPI.previewRule(ruleId, {
        organizationId,
        range,
        ...(draft ? { yaml: draft } : {}),
      });
    } catch (e) {
      result = null;
      if (e instanceof SigmaApiError && e.status === 429) {
        error = 'A preview is already running, try again in a moment';
      } else {
        error = e instanceof Error ? e.message : 'Preview failed';
      }
    } finally {
      running = false;
    }
  }

  const n = (value: number) => value.toLocaleString('en-US');
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-3">
    <div class="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Preview range">
      {#each RANGES as r (r.value)}
        <button
          type="button"
          role="radio"
          aria-checked={range === r.value}
          class="rounded px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {range ===
          r.value
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:text-foreground'}"
          disabled={running}
          onclick={() => (range = r.value)}
        >
          {r.label}
        </button>
      {/each}
    </div>
    <Button onclick={run} disabled={running}>
      {#if running}<Spinner size="sm" class="mr-2" />{/if}
      Run preview
    </Button>
    {#if running}
      <span class="text-sm text-muted-foreground" aria-live="polite">
        Scanning logs, {elapsed.toLocaleString('en-US')}s elapsed
      </span>
    {/if}
  </div>

  {#if error}
    <p role="alert" class="text-sm text-destructive-text">{error}</p>
  {/if}

  {#if result}
    <div class="space-y-3" aria-live="polite">
      <p class="text-sm">
        <span class="font-medium">
          {n(result.matches)}
          {result.matches === 1 ? 'match' : 'matches'} in {n(result.scanned)}
          {result.scanned === 1 ? 'log' : 'logs'} scanned
        </span>
        {#if result.truncated && result.truncatedReason}
          <span
            class="ml-2 inline-flex items-center rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-text"
          >
            Partial scan
          </span>
          <span class="ml-1 text-muted-foreground">{TRUNCATION_TEXT[result.truncatedReason]}</span>
        {/if}
      </p>
      {#if result.suppressed > 0}
        <p class="text-sm text-muted-foreground">{n(result.suppressed)} suppressed by exceptions</p>
      {/if}

      {#if result.samples.length > 0}
        <ul class="divide-y divide-border rounded-md border border-border">
          {#each result.samples as sample (sample.id)}
            <li class="space-y-2 p-3">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Timestamp value={sample.time} precision="second" />
                <span class="font-mono text-xs">{sample.service}</span>
                <SeverityBadge kind="level" value={sample.level} />
                <a
                  class="ml-auto text-sm underline underline-offset-2 hover:text-foreground"
                  href={logLink({ logId: sample.id, projectId: sample.projectId, time: sample.time })}
                >
                  Open in Logs
                </a>
              </div>
              <p class="break-words text-sm">{sample.message}</p>
              {#if Object.keys(sample.matchedFields ?? {}).length > 0}
                <KeyValueTable data={sample.matchedFields} />
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
