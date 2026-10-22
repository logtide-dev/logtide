<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import KeyValueTable from '$lib/components/app/KeyValueTable.svelte';
  import SeverityBadge from '$lib/components/app/SeverityBadge.svelte';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Tabs from '$lib/components/ui/tabs';
  import type { SpanRecord, TraceRecord, TraceErrorGroup } from '$lib/api/traces';
  import { extractExceptions, matchErrorGroup } from '$lib/utils/span-events';
  import { errorGroupUrl, spanLogsUrl, traceLogsUrl } from '$lib/utils/trace-links';
  import { NEUTRAL_TONE } from '$lib/utils/severity';
  import SpanExceptions from './SpanExceptions.svelte';
  import SpanLogsTab from './SpanLogsTab.svelte';
  import { formatDuration } from './format';

  interface Props {
    span: SpanRecord;
    trace: TraceRecord;
    projectId: string;
    errorGroups: TraceErrorGroup[];
    onClose: () => void;
    onFilterTraces: (path: string, value: unknown, negate: boolean) => void;
  }

  let { span, trace, projectId, errorGroups, onClose, onFilterTraces }: Props = $props();

  let activeTab = $state('overview');

  const exceptions = $derived(extractExceptions(span));
  const group = $derived(matchErrorGroup(span, errorGroups));
  const otherEvents = $derived(
    (Array.isArray(span.events) ? span.events : []).filter((e) => e && e.name !== 'exception'),
  );
  const attributes = $derived((span.attributes ?? {}) as Record<string, unknown>);
  const resourceAttributes = $derived((span.resource_attributes ?? {}) as Record<string, unknown>);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function eventData(event: Record<string, unknown>): Record<string, unknown> {
    const { name: _name, time: _time, ...rest } = event;
    return rest;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<aside class="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" aria-label="Span details">
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0 space-y-1.5">
      <h2 class="break-all font-mono text-sm font-semibold">{span.operation_name}</h2>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">{span.service_name}</Badge>
        {#if span.status_code === 'ERROR'}
          <SeverityBadge kind="state" value="failed" />
        {:else if span.status_code === 'OK'}
          <SeverityBadge kind="state" value="ok" />
        {:else}
          <span class="rounded-full border px-2 py-0.5 font-medium {NEUTRAL_TONE.badge}">Unset</span>
        {/if}
        <span class="tabular-nums text-muted-foreground">{formatDuration(span.duration_ms)}</span>
        <CopyButton value={span.span_id} ariaLabel="Copy span id" />
      </div>
    </div>
    <Button variant="ghost" size="icon" class="size-8 shrink-0" aria-label="Close span panel" onclick={onClose}>
      <X class="size-4" aria-hidden="true" />
    </Button>
  </div>

  <Tabs.Root bind:value={activeTab}>
    <Tabs.List class="w-full">
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="attributes">Attributes</Tabs.Trigger>
      <Tabs.Trigger value="events">Events</Tabs.Trigger>
      <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="overview" class="mt-3">
      <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-muted-foreground">Trace id</dt>
        <dd class="break-all font-mono text-xs">{span.trace_id}</dd>
        <dt class="text-muted-foreground">Span id</dt>
        <dd class="break-all font-mono text-xs">{span.span_id}</dd>
        {#if span.parent_span_id}
          <dt class="text-muted-foreground">Parent span id</dt>
          <dd class="break-all font-mono text-xs">{span.parent_span_id}</dd>
        {/if}
        <dt class="text-muted-foreground">Kind</dt>
        <dd>{span.kind ?? 'Unspecified'}</dd>
        <dt class="text-muted-foreground">Start</dt>
        <dd><Timestamp value={span.start_time} precision="ms" /></dd>
        <dt class="text-muted-foreground">End</dt>
        <dd><Timestamp value={span.end_time} precision="ms" /></dd>
        {#if span.status_message}
          <dt class="text-muted-foreground">Status message</dt>
          <dd class="break-words">{span.status_message}</dd>
        {/if}
      </dl>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" href={spanLogsUrl(span, trace, projectId)}>View span logs</Button>
        <Button variant="outline" size="sm" href={traceLogsUrl(trace, projectId)}>View trace logs</Button>
        {#if group}
          <Button variant="outline" size="sm" href={errorGroupUrl(group.errorGroupId, group.projectId || projectId)}>
            Open error group
          </Button>
          <SeverityBadge kind="state" value={group.status} />
        {/if}
      </div>
    </Tabs.Content>

    <Tabs.Content value="attributes" class="mt-3 space-y-4">
      <section aria-label="Span attributes">
        <h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Attributes</h3>
        {#if Object.keys(attributes).length > 0}
          <KeyValueTable data={attributes} onFilter={onFilterTraces} />
        {:else}
          <p class="text-sm text-muted-foreground">No attributes recorded</p>
        {/if}
      </section>
      <section aria-label="Resource attributes">
        <h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Resource attributes
        </h3>
        {#if Object.keys(resourceAttributes).length > 0}
          <KeyValueTable data={resourceAttributes} onFilter={onFilterTraces} />
        {:else}
          <p class="text-sm text-muted-foreground">No resource attributes recorded</p>
        {/if}
      </section>
    </Tabs.Content>

    <Tabs.Content value="events" class="mt-3 space-y-4">
      {#if exceptions.length === 0 && otherEvents.length === 0}
        <p class="text-sm text-muted-foreground">No events recorded</p>
      {/if}
      {#if exceptions.length > 0}
        <SpanExceptions {exceptions} />
      {/if}
      {#each otherEvents as event, i (i)}
        <section class="rounded-md border border-border p-3" aria-label="Event {String(event.name ?? i)}">
          <div class="mb-1 flex items-baseline justify-between gap-2">
            <h4 class="break-all text-sm font-medium">{String(event.name ?? 'event')}</h4>
            {#if typeof event.time === 'string' && event.time}
              <span class="text-xs text-muted-foreground"><Timestamp value={event.time} precision="ms" /></span>
            {/if}
          </div>
          <KeyValueTable
            data={(event.attributes && typeof event.attributes === 'object'
              ? event.attributes
              : eventData(event)) as Record<string, unknown>}
          />
        </section>
      {/each}
    </Tabs.Content>

    <Tabs.Content value="logs" class="mt-3">
      {#if activeTab === 'logs'}
        <SpanLogsTab {projectId} {span} {trace} />
      {/if}
    </Tabs.Content>
  </Tabs.Root>
</aside>
