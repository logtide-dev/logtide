<script lang="ts">
  import { untrack } from 'svelte';
  import { toastStore } from '$lib/stores/toast';
  import type { Monitor } from '$lib/api/monitoring';
  import {
    createStatusUpdate,
    type StatusUpdateItem,
    type StatusUpdateSeverity,
    type StatusUpdateStatus,
  } from '$lib/api/status-page';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import AffectedComponentsPicker from './AffectedComponentsPicker.svelte';
  import { STATUS_UPDATE_SEVERITIES, STATUS_UPDATE_STATUSES } from './monitor-meta';
  import type { StatusUpdatePrefill } from './uptime-url';

  interface Props {
    open: boolean;
    orgId: string;
    projectId: string;
    monitors: Monitor[];
    prefill?: StatusUpdatePrefill | null;
    subscriptionsAvailable?: boolean;
    onSaved: (item: StatusUpdateItem) => void;
  }

  let {
    open = $bindable(false),
    orgId,
    projectId,
    monitors,
    prefill = null,
    subscriptionsAvailable = false,
    onSaved,
  }: Props = $props();

  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;
  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  let title = $state('');
  let severity = $state<StatusUpdateSeverity>('minor');
  let status = $state<StatusUpdateStatus>('investigating');
  let message = $state('');
  let monitorIds = $state<string[]>([]);
  let sourceIncidentId = $state<string | null>(null);
  let titleError = $state<string | null>(null);
  let submitting = $state(false);

  // Prefilled component ids wait here until the monitors list has loaded, so a direct load of
  // the publish link does not drop them while the shell is still fetching monitors.
  let pendingMonitorIds: string[] | null = null;

  // Fill the form every time the dialog opens, from the prefill when there is one.
  $effect(() => {
    if (!open) return;
    const pre = prefill;
    untrack(() => {
      titleError = null;
      title = pre?.title ?? '';
      severity = pre?.severity ?? 'minor';
      status = 'investigating';
      message = pre?.message ?? '';
      monitorIds = [];
      pendingMonitorIds = pre?.monitorIds?.length ? [...pre.monitorIds] : null;
      sourceIncidentId = pre?.sourceIncidentId ?? null;
    });
  });

  $effect(() => {
    if (!open) return;
    const list = monitors;
    if (!pendingMonitorIds || list.length === 0) return;
    const known = new Set(list.map((m) => m.id));
    const wanted = pendingMonitorIds;
    pendingMonitorIds = null;
    untrack(() => {
      monitorIds = wanted.filter((m) => known.has(m));
    });
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim()) {
      titleError = 'Enter a title';
      return;
    }
    titleError = null;
    submitting = true;
    try {
      const res = await createStatusUpdate({
        organizationId: orgId,
        projectId,
        title: title.trim(),
        severity,
        status,
        message: message.trim() || undefined,
        monitorIds,
        sourceIncidentId: sourceIncidentId ?? undefined,
      });
      toastStore.success('Status update published');
      open = false;
      onSaved(res.incident);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not publish the status update');
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>New status update</Dialog.Title>
      <Dialog.Description>
        This is public. Visitors of your status page see it as soon as you publish.
      </Dialog.Description>
    </Dialog.Header>
    <form onsubmit={submit} class="grid grid-cols-1 gap-3 sm:grid-cols-2" novalidate>
      <div class="space-y-1.5 sm:col-span-2">
        <Label for={id('title')}>Title</Label>
        <Input
          id={id('title')}
          bind:value={title}
          maxlength={255}
          placeholder="Investigating elevated API latency"
          aria-invalid={titleError ? 'true' : undefined}
        />
        {#if titleError}<p class="text-xs text-destructive-text">{titleError}</p>{/if}
      </div>
      <div class="space-y-1.5">
        <Label for={id('severity')}>Severity</Label>
        <select id={id('severity')} class={selectClass} bind:value={severity}>
          {#each STATUS_UPDATE_SEVERITIES as s (s.value)}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
      </div>
      <div class="space-y-1.5">
        <Label for={id('status')}>Status</Label>
        <select id={id('status')} class={selectClass} bind:value={status}>
          {#each STATUS_UPDATE_STATUSES as s (s.value)}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
      </div>
      <div class="space-y-1.5 sm:col-span-2">
        <Label for={id('message')}>Message (optional)</Label>
        <textarea
          id={id('message')}
          bind:value={message}
          rows="3"
          maxlength="5000"
          placeholder="We are looking into increased error rates."
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        ></textarea>
      </div>
      <div class="sm:col-span-2">
        <AffectedComponentsPicker {monitors} bind:selected={monitorIds} />
      </div>
      {#if subscriptionsAvailable}
        <p class="text-xs text-muted-foreground sm:col-span-2" data-testid="subscribers-hint">
          Confirmed email subscribers also get an email about this update.
        </p>
      {/if}
      <div class="flex justify-end gap-2 pt-1 sm:col-span-2">
        <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Publishing...' : 'Publish update'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
