<script lang="ts">
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { stateTone } from '$lib/utils/severity';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import { LIVE_TAIL_LIMITS, type LiveTailState } from './live-tail';

  interface Props {
    live: boolean;
    state: LiveTailState;
    pausedBy: 'manual' | 'scroll' | null;
    limit: number;
    disabled?: boolean;
    onToggle: (next: boolean) => void;
    onPause: () => void;
    onResume: () => void;
    onRetry: () => void;
    onLimitChange: (limit: number) => void;
  }

  let { live, state, pausedBy, limit, disabled = false, onToggle, onPause, onResume, onRetry, onLimitChange }: Props =
    $props();

  const uid = $props.id();

  const LABELS: Record<LiveTailState, string> = {
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
  };
  // Connection states reuse the shared state palette (severity module).
  const TONES: Record<LiveTailState, string> = {
    connecting: 'pending',
    live: 'ok',
    reconnecting: 'acknowledged',
    disconnected: 'failed',
  };

  const tone = $derived(stateTone(TONES[state]));

  function changeLimit(e: Event) {
    const next = Number.parseInt((e.currentTarget as HTMLSelectElement).value, 10);
    if (Number.isFinite(next) && next > 0) onLimitChange(next);
  }
</script>

<div class="flex flex-wrap items-center gap-2 max-md:w-full">
  <div
    class="flex items-center gap-2 max-md:h-10 max-md:flex-1 max-md:justify-center max-md:rounded-md max-md:border max-md:border-input max-md:bg-background max-md:px-1"
  >
    <label for="{uid}-switch" class="cursor-pointer whitespace-nowrap text-sm">Live tail</label>
    <Switch
      id="{uid}-switch"
      aria-label="Live tail"
      {disabled}
      bind:checked={() => live, (next) => onToggle(next)}
    />
  </div>

  {#if live}
    <span
      role="status"
      data-testid="live-tail-state"
      class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium {tone.badge}"
    >
      <span
        class="size-1.5 rounded-full {tone.dot} {state === 'live' ? 'motion-safe:animate-pulse' : ''}"
        aria-hidden="true"
      ></span>
      {LABELS[state]}
    </span>

    {#if pausedBy}
      <span class="text-xs text-muted-foreground">{pausedBy === 'scroll' ? 'Paused while scrolled' : 'Paused'}</span>
    {/if}

    {#if pausedBy}
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        aria-label="Resume live tail"
        title="Resume live tail"
        onclick={onResume}
      >
        <Play />
      </Button>
    {:else}
      <Button
        variant="ghost"
        size="icon"
        class="size-8"
        aria-label="Pause live tail"
        title="Pause live tail"
        onclick={onPause}
      >
        <Pause />
      </Button>
    {/if}

    {#if state === 'disconnected'}
      <Button variant="outline" size="sm" class="h-8 gap-1.5" onclick={onRetry}>
        <RotateCw class="size-3.5" />
        Reconnect
      </Button>
    {/if}

    <select
      aria-label="Rows kept in live tail"
      title="Rows kept in live tail"
      class="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={String(limit)}
      onchange={changeLimit}
    >
      {#each LIVE_TAIL_LIMITS as size (size)}
        <option value={String(size)}>{size.toLocaleString('en-US')}</option>
      {/each}
    </select>
  {/if}
</div>
