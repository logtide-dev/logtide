<script lang="ts">
  import type { ExceptionCondition, ExceptionOperator, SigmaException } from '@logtide/shared';
  import { sigmaAPI } from '$lib/api/sigma';
  import { toastStore } from '$lib/stores/toast';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import Spinner from '$lib/components/Spinner.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    open: boolean;
    organizationId: string;
    ruleId: string;
    ruleTitle?: string;
    prefill?: { conditions: ExceptionCondition[]; reason?: string };
    onCreated?: (e: SigmaException) => void;
  }

  type Row = { field: string; operator: ExceptionOperator; value: string };

  let {
    open = $bindable(false),
    organizationId,
    ruleId,
    ruleTitle,
    prefill,
    onCreated,
  }: Props = $props();

  const MAX_CONDITIONS = 5;
  const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
  const COMMON_FIELDS = ['service', 'level', 'message', 'hostname', 'trace_id'];
  const uid = $props.id();

  let rows = $state<Row[]>([{ field: '', operator: 'equals', value: '' }]);
  let reason = $state('');
  let expiresAt = $state('');
  let submitting = $state(false);
  let errorText = $state('');

  function toRow(c: ExceptionCondition): Row {
    return { field: c.field, operator: c.operator, value: c.values.join(', ') };
  }

  // Each opening starts from the prefill (or an empty row).
  $effect(() => {
    if (!open) return;
    rows =
      prefill && prefill.conditions.length > 0
        ? prefill.conditions.slice(0, MAX_CONDITIONS).map(toRow)
        : [{ field: '', operator: 'equals', value: '' }];
    reason = prefill?.reason ?? '';
    expiresAt = '';
    errorText = '';
  });

  function valuesOf(row: Row): string[] {
    if (row.operator === 'in') {
      return row.value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    const v = row.value.trim();
    return v ? [v] : [];
  }

  const conditions = $derived<ExceptionCondition[]>(
    rows.map((r) => ({ field: r.field.trim(), operator: r.operator, values: valuesOf(r) })),
  );
  const valid = $derived(
    conditions.length > 0 &&
      conditions.every(
        (c) => FIELD_PATTERN.test(c.field) && c.values.length >= 1 && c.values.length <= 50,
      ),
  );

  function addRow() {
    if (rows.length >= MAX_CONDITIONS) return;
    rows = [...rows, { field: '', operator: 'equals', value: '' }];
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return;
    rows = rows.filter((_, i) => i !== index);
  }

  function pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  function preset(days: number | null) {
    if (days === null) {
      expiresAt = '';
      return;
    }
    const d = new Date(Date.now() + days * 86_400_000);
    // datetime-local wants local wall time without a zone.
    expiresAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function submit() {
    if (!valid || submitting) return;
    submitting = true;
    errorText = '';
    try {
      const body: { conditions: ExceptionCondition[]; reason?: string; expiresAt?: string } = {
        conditions,
      };
      if (reason.trim()) body.reason = reason.trim();
      if (expiresAt) body.expiresAt = new Date(expiresAt).toISOString();
      const res = await sigmaAPI.createException(ruleId, organizationId, body);
      toastStore.success('Exception added');
      open = false;
      onCreated?.(res.exception);
    } catch (e) {
      errorText = e instanceof Error ? e.message : 'Failed to add exception';
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Add exception</Dialog.Title>
      <Dialog.Description>
        {#if ruleTitle}
          Matches of "{ruleTitle}" that fit all conditions below are skipped, so they create no
          detection and no notification.
        {:else}
          Matches that fit all conditions below are skipped, so they create no detection and no
          notification.
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <div data-dialog-scroll-body class="max-h-[60vh] space-y-4 overflow-y-auto py-2">
      <datalist id="{uid}-fields">
        {#each COMMON_FIELDS as f (f)}<option value={f}></option>{/each}
      </datalist>

      <div class="space-y-3">
        {#each rows as row, i (i)}
          <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-[9rem] flex-1 space-y-1">
              {#if i === 0}<Label for="{uid}-field-{i}">Field</Label>{/if}
              <Input
                id="{uid}-field-{i}"
                list="{uid}-fields"
                aria-label="Field {i + 1}"
                placeholder="service"
                bind:value={row.field}
              />
            </div>
            <div class="space-y-1">
              {#if i === 0}<Label for="{uid}-op-{i}">Operator</Label>{/if}
              <select
                id="{uid}-op-{i}"
                aria-label="Operator {i + 1}"
                class="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                bind:value={row.operator}
              >
                <option value="equals">equals</option>
                <option value="contains">contains</option>
                <option value="in">is one of</option>
              </select>
            </div>
            <div class="min-w-[10rem] flex-[2] space-y-1">
              {#if i === 0}<Label for="{uid}-value-{i}">Value</Label>{/if}
              <Input
                id="{uid}-value-{i}"
                aria-label="Value {i + 1}"
                placeholder={row.operator === 'in' ? 'a, b, c' : 'value'}
                bind:value={row.value}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove condition {i + 1}"
              disabled={rows.length <= 1}
              onclick={() => removeRow(i)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        {/each}
        {#if rows.length < MAX_CONDITIONS}
          <Button variant="outline" size="sm" onclick={addRow}>
            <Plus aria-hidden="true" />
            Add condition
          </Button>
        {/if}
      </div>

      <div class="space-y-1">
        <Label for="{uid}-reason">Reason</Label>
        <Textarea id="{uid}-reason" rows={2} maxlength={500} bind:value={reason} placeholder="Why is this safe to ignore?" />
      </div>

      <div class="space-y-2">
        <Label for="{uid}-expires">Expires</Label>
        <div class="flex flex-wrap items-center gap-2">
          <Input id="{uid}-expires" type="datetime-local" class="w-auto" bind:value={expiresAt} />
          <Button variant="outline" size="sm" onclick={() => preset(null)}>None</Button>
          <Button variant="outline" size="sm" onclick={() => preset(7)}>7 days</Button>
          <Button variant="outline" size="sm" onclick={() => preset(30)}>30 days</Button>
        </div>
      </div>

      {#if errorText}
        <p role="alert" class="text-sm text-destructive-text">{errorText}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
      <Button onclick={submit} disabled={!valid || submitting}>
        {#if submitting}<Spinner size="sm" class="mr-2" />{/if}
        Add exception
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
