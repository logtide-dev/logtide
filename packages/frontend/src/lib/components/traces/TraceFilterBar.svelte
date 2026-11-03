<script lang="ts">
  import { SelectField } from '$lib/components/ui/select';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { validateAttr, removeAttrChip } from './attr';
  import { formatDuration } from './format';

  type Patch = Partial<{
    service: string | null;
    status: 'errors' | 'ok' | null;
    minDuration: number | null;
    maxDuration: number | null;
    attr: string;
    operation: string | null;
  }>;

  interface Props {
    services: string[];
    service: string | null;
    status: 'errors' | 'ok' | null;
    minDuration: number | null;
    maxDuration: number | null;
    attr: string;
    operation: string | null;
    onChange: (patch: Patch) => void;
    onJumpToTrace: (traceId: string) => void;
    /** Phones can fold the fields away; the active filter chips stay visible. */
    showFields?: boolean;
  }

  let {
    services,
    service,
    status,
    minDuration,
    maxDuration,
    attr,
    operation,
    onChange,
    onJumpToTrace,
    showFields = true,
  }: Props = $props();

  let attrDraft = $state('');
  let traceIdDraft = $state('');

  // Follow the committed value (URL changes, chip removal, clear all).
  $effect(() => {
    attrDraft = attr;
  });

  const validation = $derived(validateAttr(attrDraft));
  const committed = $derived(validateAttr(attr));
  const chips = $derived(committed.ok ? committed.chips : []);

  const hasDuration = $derived(minDuration !== null || maxDuration !== null);
  const anyActive = $derived(
    service !== null ||
      status !== null ||
      operation !== null ||
      hasDuration ||
      attr.trim() !== '',
  );

  function durationText(): string {
    if (minDuration !== null && maxDuration !== null) {
      return `Duration ${formatDuration(minDuration)} to ${formatDuration(maxDuration)}`;
    }
    if (minDuration !== null) return `Duration over ${formatDuration(minDuration)}`;
    return `Duration up to ${formatDuration(maxDuration ?? 0)}`;
  }

  function commitAttr() {
    if (!validation.ok) return;
    const next = attrDraft.trim();
    if (next === attr.trim()) return;
    onChange({ attr: next });
  }

  function onAttrKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitAttr();
    }
  }

  function jump() {
    const id = traceIdDraft.trim();
    if (!id) return;
    onJumpToTrace(id);
  }

  function onTraceKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      jump();
    }
  }

  function clearAll() {
    onChange({
      service: null,
      status: null,
      minDuration: null,
      maxDuration: null,
      attr: '',
      operation: null,
    });
  }

  const selectClass =
    'h-9 w-auto max-md:h-11 max-md:w-full';
  const chipClass =
    'inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground';
</script>

<div class="space-y-3">
  <div
    class={showFields
      ? 'grid grid-cols-1 gap-3 md:flex md:flex-wrap md:items-start md:gap-2'
      : 'hidden'}
  >
    <div class="grid gap-1 md:contents">
    <span class="text-xs font-medium text-muted-foreground md:sr-only" aria-hidden="true">Service</span>
    <SelectField
      class={selectClass}
      aria-label="Service"
      value={service ?? ''}
      onValueChange={(v) => onChange({ service: v || null })}
      options={[{ value: '', label: 'All services' }, ...services.map((s) => ({ value: s, label: s }))]}
    />

    </div>
    <div class="grid gap-1 md:contents">
    <span class="text-xs font-medium text-muted-foreground md:sr-only" aria-hidden="true">Status</span>
    <SelectField
      class={selectClass}
      aria-label="Status"
      value={status ?? ''}
      onValueChange={(v) => onChange({ status: (v || null) as 'errors' | 'ok' | null })}
      options={[
        { value: '', label: 'All statuses' },
        { value: 'errors', label: 'Errors only' },
        { value: 'ok', label: 'Success only' },
      ]}
    />

    </div>
    <div class="grid gap-1 md:min-w-[16rem] md:flex-1">
      <span class="text-xs font-medium text-muted-foreground md:sr-only" aria-hidden="true">Attribute filter</span>
      <Input
        type="text"
        class="h-9 max-md:h-11 font-mono text-xs"
        placeholder="http.method:GET -http.status_code:500"
        aria-label="Attribute filter"
        aria-invalid={!validation.ok}
        aria-describedby={validation.ok ? undefined : 'trace-attr-error'}
        bind:value={attrDraft}
        onkeydown={onAttrKeydown}
        onblur={commitAttr}
      />
      {#if !validation.ok}
        <p id="trace-attr-error" class="mt-1 text-xs text-destructive-text" role="alert">
          {validation.error} (character {validation.position + 1})
        </p>
      {/if}
    </div>

    <div class="grid gap-1 md:flex md:items-center md:gap-2">
      <span class="text-xs font-medium text-muted-foreground md:sr-only" aria-hidden="true">Trace id</span>
      <Input
        id="trace-id-input"
        type="text"
        class="h-9 font-mono text-xs max-md:h-11 max-md:w-full md:w-56"
        placeholder="Trace id"
        aria-label="Trace id"
        bind:value={traceIdDraft}
        onkeydown={onTraceKeydown}
      />
      <Button variant="outline" size="sm" class="max-md:h-11 max-md:w-full" onclick={jump}>Go to trace</Button>
    </div>
  </div>

  {#if anyActive}
    <div class="flex flex-wrap items-center gap-2">
      {#if operation !== null}
        <span class={chipClass}>
          Operation {operation}
          <button
            type="button"
            class="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove operation filter"
            onclick={() => onChange({ operation: null })}
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </span>
      {/if}
      {#if hasDuration}
        <span class={chipClass}>
          {durationText()}
          <button
            type="button"
            class="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove duration filter"
            onclick={() => onChange({ minDuration: null, maxDuration: null })}
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </span>
      {/if}
      {#each chips as chip (chip.start)}
        <span class="{chipClass} font-mono">
          {chip.text}
          <button
            type="button"
            class="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove attribute filter {chip.text}"
            onclick={() => onChange({ attr: removeAttrChip(attr, chip) })}
          >
            <X class="size-3" aria-hidden="true" />
          </button>
        </span>
      {/each}
      <Button variant="ghost" size="sm" onclick={clearAll}>Clear all</Button>
    </div>
  {/if}
</div>
