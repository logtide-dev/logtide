<script lang="ts">
  import { displayPreferences } from '$lib/stores/display-preferences';
  import { formatTimestamp, formatRelative, getDisplayZoneLabel } from '$lib/utils/datetime';

  interface Props {
    value: string | Date;
    precision?: 'minute' | 'second' | 'ms';
    relative?: boolean;
    showZone?: boolean;
  }

  let { value, precision = 'second', relative = false, showZone = false }: Props = $props();

  const date = $derived.by(() => {
    if (value === null || value === undefined || (value as unknown) === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  });

  let now = $state(new Date());

  $effect(() => {
    if (!relative || !date) return;
    now = new Date();
    const timer = setInterval(() => {
      now = new Date();
    }, 30_000);
    return () => clearInterval(timer);
  });

  // Reading the store here is what re-renders the text when the clock format or
  // the time zone preference changes.
  const text = $derived.by(() => {
    $displayPreferences;
    if (!date) return '';
    if (relative) return formatRelative(date, now);
    return formatTimestamp(date, { precision, withZone: showZone });
  });

  const title = $derived.by(() => {
    $displayPreferences;
    if (!date) return undefined;
    return `${formatTimestamp(date, { precision: 'ms' })} ${getDisplayZoneLabel(date)}`;
  });
</script>

{#if date}
  <time datetime={date.toISOString()} {title}>{text}</time>
{:else}
  <span class="text-muted-foreground">-</span>
{/if}
