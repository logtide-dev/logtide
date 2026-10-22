<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import type { IgnoreOptions } from './error-status';

  interface Props {
    open: boolean;
    busy?: boolean;
    onConfirm: (options: IgnoreOptions) => void | Promise<void>;
  }

  let { open = $bindable(false), busy = false, onConfirm }: Props = $props();

  type Mode = 'forever' | 'date' | 'count';

  const MAX_COUNT = 1_000_000;
  const PRESETS = [
    { label: '1 hour', ms: 60 * 60 * 1000 },
    { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
    { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
    { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  ];

  let mode = $state<Mode>('forever');
  let untilMs = $state<number | null>(null);
  let countText = $state('');
  let submitting = $state(false);

  const uid = $props.id();
  const dateId = `ignore-date-${uid}`;
  const countId = `ignore-count-${uid}`;

  const working = $derived(busy || submitting);

  const count = $derived.by(() => {
    const t = countText.trim();
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= MAX_COUNT ? n : null;
  });

  const valid = $derived(
    mode === 'forever' ||
      (mode === 'date' && untilMs !== null && untilMs > Date.now()) ||
      (mode === 'count' && count !== null)
  );

  // Reopening always starts from the default choice.
  $effect(() => {
    if (open) {
      mode = 'forever';
      untilMs = null;
      countText = '';
    }
  });

  function pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  /** Value for a datetime-local input, in the browser zone. */
  function toLocalInput(ms: number | null): string {
    if (ms === null) return '';
    const d = new Date(ms);
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  function applyPreset(ms: number) {
    mode = 'date';
    untilMs = Date.now() + ms;
  }

  function onDateInput(e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    const parsed = value ? new Date(value).getTime() : NaN;
    untilMs = Number.isNaN(parsed) ? null : parsed;
  }

  function onCountInput(e: Event) {
    countText = (e.currentTarget as HTMLInputElement).value;
  }

  function setOpen(next: boolean) {
    // Escape and overlay clicks must not dismiss an in-flight action.
    if (!next && working) return;
    open = next;
  }

  async function confirm() {
    if (working || !valid) return;
    const options: IgnoreOptions = {};
    if (mode === 'date' && untilMs !== null) options.ignoredUntil = new Date(untilMs).toISOString();
    if (mode === 'count' && count !== null) options.ignoreUntilCount = count;

    submitting = true;
    try {
      await onConfirm(options);
      open = false;
    } catch (err) {
      // Callers own user-facing error toasts; the dialog just stays open.
      console.error('Ignore failed', err);
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog bind:open={() => open, setOpen}>
  <DialogContent class="sm:max-w-[460px]">
    <DialogHeader>
      <DialogTitle>Ignore error</DialogTitle>
      <DialogDescription>
        Ignored errors stop notifying. They reopen automatically when the limit you choose is reached.
      </DialogDescription>
    </DialogHeader>

    <div class="space-y-4 py-2" role="radiogroup" aria-label="Ignore duration">
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" name="ignore-mode-{uid}" value="forever" bind:group={mode} disabled={working} />
        Forever
      </label>

      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="ignore-mode-{uid}" value="date" bind:group={mode} disabled={working} />
          Until a date
        </label>
        {#if mode === 'date'}
          <div class="ml-6 space-y-2">
            <div class="flex flex-wrap gap-2">
              {#each PRESETS as preset (preset.label)}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={working}
                  onclick={() => applyPreset(preset.ms)}
                >
                  {preset.label}
                </Button>
              {/each}
            </div>
            <Label for={dateId} class="sr-only">Ignore until</Label>
            <Input
              id={dateId}
              type="datetime-local"
              value={toLocalInput(untilMs)}
              oninput={onDateInput}
              disabled={working}
            />
            {#if untilMs !== null && untilMs <= Date.now()}
              <p class="text-xs text-destructive-text">Pick a date in the future.</p>
            {/if}
          </div>
        {/if}
      </div>

      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="ignore-mode-{uid}" value="count" bind:group={mode} disabled={working} />
          Until N more events
        </label>
        {#if mode === 'count'}
          <div class="ml-6 space-y-1">
            <Label for={countId} class="sr-only">Number of events</Label>
            <Input
              id={countId}
              type="number"
              min="1"
              max={MAX_COUNT}
              step="1"
              placeholder="Number of events"
              value={countText}
              oninput={onCountInput}
              disabled={working}
            />
            {#if countText.trim() !== '' && count === null}
              <p class="text-xs text-destructive-text">
                Enter a whole number from 1 to {MAX_COUNT.toLocaleString('en-US')}.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <DialogFooter>
      <Button type="button" variant="outline" disabled={working} onclick={() => setOpen(false)}>Cancel</Button>
      <Button type="button" disabled={working || !valid} onclick={confirm}>
        {#if working}
          <LoaderCircle class="animate-spin" aria-hidden="true" />
        {/if}
        Ignore
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
