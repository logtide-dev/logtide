<script lang="ts">
  import type { ErrorGroupEvent } from '@logtide/shared';
  import Button from '$lib/components/ui/button/button.svelte';
  import { buttonVariants } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import BreadcrumbTimeline from '$lib/components/BreadcrumbTimeline.svelte';
  import StackTraceViewer from './StackTraceViewer.svelte';
  import { buildLogsWindowHref, buildSessionHref, buildTraceHref } from './error-group-links';
  import Bug from '@lucide/svelte/icons/bug';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  interface Props {
    event: ErrorGroupEvent | null;
    loading: boolean;
    hasOlder: boolean;
    hasNewer: boolean;
    onOlder: () => void;
    onNewer: () => void;
    projectId: string | null;
  }

  let { event, loading, hasOlder, hasNewer, onOlder, onNewer, projectId }: Props = $props();

  const log = $derived(event?.log ?? null);
  const eventTime = $derived(log?.time ?? event?.exception.createdAt ?? null);

  type Crumb = {
    type: string;
    category?: string;
    message: string;
    level?: string;
    timestamp: number;
    data?: Record<string, unknown>;
  };

  const breadcrumbs = $derived.by((): Crumb[] => {
    const raw = log?.metadata?.breadcrumbs;
    return Array.isArray(raw) && raw.length > 0 ? (raw as Crumb[]) : [];
  });

  const linkClass = buttonVariants({ variant: 'outline', size: 'sm' });
</script>

<Card>
  <CardHeader>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <CardTitle>Stack trace</CardTitle>
        {#if event}
          {#if !hasNewer}
            <Badge variant="secondary">Latest event</Badge>
          {:else if eventTime}
            <span class="text-sm text-muted-foreground">
              Event from <Timestamp value={eventTime} precision="second" />
            </span>
          {/if}
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" class="gap-1" disabled={!hasOlder || loading} onclick={onOlder}>
          <ChevronLeft class="h-4 w-4" aria-hidden="true" />
          Older
        </Button>
        <Button variant="outline" size="sm" class="gap-1" disabled={!hasNewer || loading} onclick={onNewer}>
          Newer
          <ChevronRight class="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
    <CardDescription>Stack trace from the event shown</CardDescription>
  </CardHeader>
  <CardContent class="space-y-4">
    {#if loading && !event}
      <div class="flex items-center justify-center py-12">
        <Spinner />
        <span class="ml-3 text-muted-foreground">Loading event</span>
      </div>
    {:else if event}
      <div class="flex flex-wrap items-center gap-2">
        {#if log}
          {#if log.traceId}
            <a href={buildTraceHref(log.traceId, projectId)} class={linkClass}>View trace</a>
          {/if}
          <a
            href={buildLogsWindowHref({ projectId, time: log.time, logId: log.id })}
            class={linkClass}
          >
            View logs around this event
          </a>
          {#if log.sessionId}
            <a href={buildSessionHref(log.sessionId, projectId)} class={linkClass}>View session</a>
          {/if}
        {:else}
          <p class="text-sm text-muted-foreground">The log entry for this event is no longer available</p>
        {/if}
      </div>

      <StackTraceViewer exception={{ exception: event.exception, frames: event.frames }} />

      {#if breadcrumbs.length > 0 && eventTime}
        <BreadcrumbTimeline {breadcrumbs} eventTime={new Date(eventTime).toISOString()} />
      {/if}
    {:else}
      <div class="py-12 text-center text-muted-foreground">
        <Bug class="mx-auto mb-4 h-12 w-12 opacity-50" aria-hidden="true" />
        <p>No stack trace available for this error</p>
      </div>
    {/if}
  </CardContent>
</Card>
