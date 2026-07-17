<script lang="ts">
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import Clock from '@lucide/svelte/icons/clock';
  import type { ProjectSkewHealth } from '$lib/api/projects';

  export type SkewSignal = 'logs' | 'spans' | 'metrics';

  let { skew, signal }: { skew: ProjectSkewHealth | null; signal: SkewSignal } = $props();

  const show = $derived(!!skew && skew.count24h > 0);

  // Round to the nearest hour when the skew is at least an hour, otherwise minutes.
  // The number is the diagnosis, so it has to read like a sentence, not a duration.
  function humanize(ms: number): string {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) {
      return `${minutes.toLocaleString('en-US')} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }
    const hours = Math.round(ms / 3600000);
    return `${hours.toLocaleString('en-US')} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  const direction = $derived(
    !skew
      ? ''
      : skew.maxPastMs >= skew.maxFutureMs
        ? `${humanize(skew.maxPastMs)} in the past`
        : `${humanize(skew.maxFutureMs)} ahead of the server clock`,
  );

  // How long ago the most recent skewed record arrived. Relative phrasing avoids
  // a locale-dependent absolute timestamp and tells the user whether this is
  // still happening or they already fixed it and are looking at the tail of the
  // window.
  function timeAgo(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) {
      return 'just now';
    }
    if (minutes < 60) {
      return `${minutes.toLocaleString('en-US')} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    }
    const hours = Math.floor(diffMs / 3600000);
    return `${hours.toLocaleString('en-US')} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  const lastSeen = $derived(!skew ? '' : timeAgo(skew.lastSeenAt));

  const NOUN: Record<SkewSignal, { singular: string; plural: string }> = {
    logs: { singular: 'log', plural: 'logs' },
    spans: { singular: 'span', plural: 'spans' },
    metrics: { singular: 'metric', plural: 'metrics' },
  };
  const noun = $derived(!skew ? '' : skew.count24h === 1 ? NOUN[signal].singular : NOUN[signal].plural);

  const TITLE: Record<SkewSignal, string> = {
    logs: 'Logs are arriving with an out-of-range timestamp',
    spans: 'Spans are arriving with an out-of-range timestamp',
    metrics: 'Metrics are arriving with an out-of-range timestamp',
  };
</script>

{#if show && skew}
  <Alert class="border-amber-500/50 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-600">
    <Clock class="h-4 w-4" />
    <AlertTitle>{TITLE[signal]}</AlertTitle>
    <AlertDescription>
      {#if signal === 'logs'}
        <p>
          In the last 24 hours, {skew.count24h.toLocaleString('en-US')}
          {noun} arrived with a timestamp up to {direction}.
          They are stored and searchable, but threshold alert rules only count logs inside their
          time window, so these logs cannot trigger an alert.
        </p>
        <p class="mt-2">
          This usually means the shipper is sending a <code>time</code> field that does not match
          the current instant. Omitting the field entirely makes LogTide use the server ingestion
          time instead.
        </p>
      {:else if signal === 'spans'}
        <p>
          In the last 24 hours, {skew.count24h.toLocaleString('en-US')}
          {noun} ended with a timestamp up to {direction}.
          They are stored, but trace views only show spans that ended inside their time window,
          so these spans will not appear in trace views for that period.
        </p>
        <p class="mt-2">
          This usually means a clock or exporter timestamp problem on the sending host.
        </p>
      {:else}
        <p>
          In the last 24 hours, {skew.count24h.toLocaleString('en-US')}
          {noun} arrived with a timestamp up to {direction}.
          They are stored, but dashboards only show data points inside their time window, so
          these metrics will not appear in dashboards for that period.
        </p>
        <p class="mt-2">
          This usually means a clock or exporter timestamp problem on the sending host.
        </p>
      {/if}
      <p class="mt-2 text-xs text-muted-foreground">
        Most recent at {lastSeen}.
      </p>
    </AlertDescription>
  </Alert>
{/if}
