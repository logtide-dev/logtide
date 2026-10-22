<script lang="ts">
  import { untrack } from 'svelte';
  import { monitoringStore } from '$lib/stores/monitoring';
  import { toastStore } from '$lib/stores/toast';
  import {
    getMonitorChannels,
    setMonitorChannels,
    type Monitor,
    type MonitorType,
    type UpdateMonitorInput,
  } from '$lib/api/monitoring';
  import { logsAPI } from '$lib/api/logs';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import ChannelSelector from '$lib/components/notification-channels/ChannelSelector.svelte';
  import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';
  import MonitorTypeFields from './MonitorTypeFields.svelte';
  import { MONITOR_TYPE_OPTIONS } from './monitor-meta';
  import {
    SEVERITY_OPTIONS,
    buildPayload,
    defaultValues,
    hasProbeFields,
    validateMonitorForm,
    valuesFromMonitor,
    type MonitorFormValues,
  } from './monitor-form-state';

  interface Props {
    open: boolean;
    mode: 'create' | 'edit' | 'duplicate';
    monitor?: Monitor | null;
    orgId: string;
    projectId: string;
    projects: { id: string; name: string }[];
    onSaved: (m: Monitor) => void;
  }

  let {
    open = $bindable(false),
    mode,
    monitor = null,
    orgId,
    projectId,
    projects,
    onSaved,
  }: Props = $props();

  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  const editing = $derived(mode === 'edit');

  let values = $state<MonitorFormValues>(defaultValues('http'));
  let errors = $state<Record<string, string>>({});
  let channelIds = $state<string[]>([]);
  // Destinations are only written back after they loaded, so a failed or slow load cannot wipe them.
  let channelsState = $state<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  let selectedProjectId = $state('');
  let submitting = $state(false);
  let availableServices = $state<string[]>([]);
  // Numeric fields the user has edited: a type change keeps those and swaps the rest.
  const touched = new Set<string>();

  // Initialise whenever the dialog opens.
  $effect(() => {
    if (!open) return;
    const currentMode = mode;
    const source = monitor;
    untrack(() => {
      touched.clear();
      errors = {};
      selectedProjectId = source && currentMode !== 'create' ? source.projectId : projectId;
      values =
        source && currentMode !== 'create'
          ? valuesFromMonitor(source, currentMode === 'edit' ? 'edit' : 'duplicate')
          : defaultValues('http');
      channelIds = [];
      channelsState = source && currentMode !== 'create' ? 'loading' : 'idle';
      if (source && currentMode !== 'create') {
        const wanted = source.id;
        getMonitorChannels(wanted, orgId)
          .then((res) => {
            if (!open || monitor?.id !== wanted) return;
            channelIds = res.channels.map((c) => c.id);
            channelsState = 'loaded';
          })
          .catch(() => {
            if (!open || monitor?.id !== wanted) return;
            channelsState = 'failed';
          });
      }
    });
  });

  // Service suggestions for log heartbeat monitors.
  $effect(() => {
    if (!open || values.type !== 'log_heartbeat' || !selectedProjectId) return;
    const pid = selectedProjectId;
    let cancelled = false;
    logsAPI
      .getServices({ projectId: pid })
      .then((services) => {
        if (!cancelled) availableServices = services;
      })
      .catch(() => {
        if (!cancelled) availableServices = [];
      });
    return () => {
      cancelled = true;
    };
  });

  function changeType(next: MonitorType) {
    const d = defaultValues(next);
    const merged: MonitorFormValues = { ...values, type: next, target: '' };
    for (const key of ['intervalSeconds', 'timeoutSeconds', 'failureThreshold'] as const) {
      if (!touched.has(key)) merged[key] = d[key];
    }
    values = merged;
    errors = {};
  }

  function touch(key: string) {
    touched.add(key);
  }

  const title = $derived(
    mode === 'edit' ? 'Edit monitor' : mode === 'duplicate' ? 'Duplicate monitor' : 'New monitor'
  );

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    if (editing && channelsState === 'loading') return;
    const found = validateMonitorForm(values, editing);
    errors = found;
    if (Object.keys(found).length > 0) return;

    submitting = true;
    try {
      const payload = buildPayload(values, { organizationId: orgId, projectId: selectedProjectId });
      let saved: Monitor;
      if (editing && monitor) {
        const { organizationId: _o, projectId: _p, type: _t, ...patch } = payload;
        saved = await monitoringStore.update(monitor.id, orgId, patch as UpdateMonitorInput);
      } else {
        saved = await monitoringStore.create(payload);
      }

      if ((editing && channelsState === 'loaded') || (!editing && channelIds.length > 0)) {
        try {
          await setMonitorChannels(saved.id, orgId, channelIds);
        } catch (err) {
          toastStore.error(
            err instanceof Error
              ? `Monitor saved, but destinations were not updated: ${err.message}`
              : 'Monitor saved, but destinations were not updated'
          );
        }
      }

      toastStore.success(editing ? 'Monitor updated' : 'Monitor created');
      open = false;
      onSaved(saved);
    } catch (err) {
      toastStore.error(err instanceof Error ? err.message : 'Could not save the monitor');
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>

    <form onsubmit={handleSubmit} class="grid grid-cols-1 gap-4 sm:grid-cols-2" novalidate>
      <div class="space-y-1.5 sm:col-span-2">
        <Label for={id('name')}>Name</Label>
        <Input
          id={id('name')}
          bind:value={values.name}
          maxlength={255}
          placeholder="Production API"
          aria-invalid={errors.name ? 'true' : undefined}
        />
        {#if errors.name}<p class="text-xs text-destructive-text">{errors.name}</p>{/if}
      </div>

      {#if !editing}
        <div class="space-y-1.5">
          <Label for={id('project')}>Project</Label>
          <select id={id('project')} class={selectClass} bind:value={selectedProjectId}>
            {#each projects as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </div>
        <div class="space-y-1.5">
          <Label for={id('type')}>Type</Label>
          <select
            id={id('type')}
            class={selectClass}
            value={values.type}
            onchange={(e) => changeType(e.currentTarget.value as MonitorType)}
          >
            {#each MONITOR_TYPE_OPTIONS as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
      {/if}

      <MonitorTypeFields bind:values {errors} {availableServices} idPrefix={uid} />

      <div class="space-y-1.5">
        <Label for={id('interval')}>Check interval (seconds)</Label>
        <Input
          id={id('interval')}
          inputmode="numeric"
          bind:value={values.intervalSeconds}
          oninput={() => touch('intervalSeconds')}
          aria-invalid={errors.intervalSeconds ? 'true' : undefined}
        />
        {#if errors.intervalSeconds}
          <p class="text-xs text-destructive-text">{errors.intervalSeconds}</p>
        {/if}
      </div>

      {#if hasProbeFields(values.type)}
        <div class="space-y-1.5">
          <Label for={id('timeout')}>Timeout (seconds)</Label>
          <Input
            id={id('timeout')}
            inputmode="numeric"
            bind:value={values.timeoutSeconds}
            oninput={() => touch('timeoutSeconds')}
            aria-invalid={errors.timeoutSeconds ? 'true' : undefined}
          />
          {#if errors.timeoutSeconds}
            <p class="text-xs text-destructive-text">{errors.timeoutSeconds}</p>
          {/if}
        </div>
      {/if}

      <div class="space-y-1.5">
        <Label for={id('threshold')}>Failure threshold</Label>
        <Input
          id={id('threshold')}
          inputmode="numeric"
          bind:value={values.failureThreshold}
          oninput={() => touch('failureThreshold')}
          aria-invalid={errors.failureThreshold ? 'true' : undefined}
        />
        {#if errors.failureThreshold}
          <p class="text-xs text-destructive-text">{errors.failureThreshold}</p>
        {:else}
          <p class="text-xs text-muted-foreground">Consecutive failures before the monitor goes down.</p>
        {/if}
      </div>

      <fieldset class="space-y-3 border-t pt-4 sm:col-span-2">
        <legend class="pr-2 text-sm font-medium">Alerting</legend>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for={id('severity')}>Severity</Label>
            <select id={id('severity')} class={selectClass} bind:value={values.severity}>
              {#each SEVERITY_OPTIONS as sev (sev)}
                <option value={sev}>{sev.charAt(0).toUpperCase() + sev.slice(1)}</option>
              {/each}
            </select>
          </div>
          <div class="flex flex-col justify-end gap-2">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={values.autoResolve} class="rounded" />
              Resolve the incident automatically on recovery
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={values.enabled} class="rounded" />
              Enabled
            </label>
          </div>
        </div>
        <div class="space-y-1.5">
          <Label>Notification channels</Label>
          <ChannelSelector
            selectedIds={channelIds}
            onSelectionChange={(ids) => (channelIds = ids)}
            placeholder="Use the organization defaults"
          />
          {#if channelsState === 'failed'}
            <p class="text-xs text-destructive-text" role="alert">
              Could not load the current destinations. They will stay unchanged when you save.
            </p>
          {/if}
          <WillNotify eventType="monitoring" projectId={selectedProjectId} {channelIds} />
        </div>
      </fieldset>

      <fieldset class="space-y-3 border-t pt-4 sm:col-span-2">
        <legend class="pr-2 text-sm font-medium">Status page</legend>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for={id('display-name')}>Public display name</Label>
            <Input
              id={id('display-name')}
              bind:value={values.displayName}
              maxlength={255}
              placeholder="Same as the name"
              aria-invalid={errors.displayName ? 'true' : undefined}
            />
            {#if errors.displayName}
              <p class="text-xs text-destructive-text">{errors.displayName}</p>
            {/if}
          </div>
          <div class="space-y-1.5">
            <Label for={id('group')}>Group</Label>
            <Input
              id={id('group')}
              bind:value={values.groupName}
              maxlength={100}
              placeholder="Ungrouped"
              aria-invalid={errors.groupName ? 'true' : undefined}
            />
            {#if errors.groupName}
              <p class="text-xs text-destructive-text">{errors.groupName}</p>
            {/if}
          </div>
        </div>
      </fieldset>

      <div class="flex justify-end gap-2 pt-2 sm:col-span-2">
        <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" disabled={submitting || (editing && channelsState === 'loading')}>
          {submitting ? 'Saving...' : editing ? 'Save changes' : 'Create monitor'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
