<script lang="ts">
  import { TROUBLESHOOTING_TIPS } from './troubleshooting-tips';
  import { untrack } from 'svelte';
  import CheckCircle from '@lucide/svelte/icons/check-circle-2';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { firstSignalAPI, type FirstSignal } from '$lib/api/first-signal';

  interface Props {
    projectId: string;
    onDetected: (signal: FirstSignal) => void;
    onSkip?: () => void;
    intervalMs?: number;
    tipsAfterMs?: number;
    fetchSignal?: (projectId: string) => Promise<FirstSignal>;
  }

  let {
    projectId,
    onDetected,
    onSkip,
    intervalMs = 3000,
    tipsAfterMs = 60000,
    fetchSignal = (id: string) => firstSignalAPI.get(id),
  }: Props = $props();

  let detected = $state<FirstSignal | null>(null);
  let showTips = $state(false);

  const received = $derived.by(() => {
    if (!detected) return '';
    const kinds: string[] = [];
    if (detected.logs) kinds.push('logs');
    if (detected.traces) kinds.push('traces');
    if (detected.metrics) kinds.push('metrics');
    if (detected.errors) kinds.push('errors');
    if (kinds.length === 0) return 'data';
    if (kinds.length === 1) return kinds[0];
    return `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
  });

  $effect(() => {
    const id = projectId;
    let stopped = false;
    let inflight = false;
    let done = false;

    async function poll() {
      if (stopped || done || inflight) return;
      inflight = true;
      try {
        const signal = await fetchSignal(id);
        if (stopped || done) return;
        if (signal.logs || signal.traces || signal.metrics || signal.errors) {
          done = true;
          detected = signal;
          showTips = false;
          untrack(() => onDetected(signal));
        }
      } catch {
        // transient failure: keep polling, it must not count as a missing signal
      } finally {
        inflight = false;
      }
    }

    const interval = setInterval(poll, intervalMs);
    const tipsTimer = setTimeout(() => {
      if (!stopped && !done) showTips = true;
    }, tipsAfterMs);
    void poll();

    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(tipsTimer);
    };
  });
</script>

{#if detected}
  <div
    class="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 p-4"
    role="status"
  >
    <CheckCircle class="mt-0.5 size-5 shrink-0 text-success-text" aria-hidden="true" />
    <div>
      <p class="font-medium text-success-text">Received {received}</p>
      <p class="text-sm text-muted-foreground">Your project is connected and sending data.</p>
    </div>
  </div>
{:else}
  <EmptyState
    variant="setup"
    title="Waiting for your first signal"
    description="Send a log, trace or metric with the snippets above. This page checks every few seconds."
  >
    {#snippet actions()}
      {#if onSkip}
        <Button variant="outline" onclick={() => onSkip?.()}>Skip for now</Button>
      {/if}
    {/snippet}
  </EmptyState>

  {#if showTips}
    <div class="mt-4 rounded-lg border border-border bg-card p-4" data-testid="troubleshooting-tips">
      <p class="text-sm font-medium">Nothing yet? Check these</p>
      <ul class="mt-2 space-y-2 text-sm text-muted-foreground">
        {#each TROUBLESHOOTING_TIPS as tip (tip.title)}
          <li><span class="font-medium text-foreground">{tip.title}.</span> {tip.body}</li>
        {/each}
      </ul>
    </div>
  {/if}
{/if}
