<!--
  Create or edit a metric alert rule (alertType 'metric').

  Props:
    open            bindable
    organizationId
    query           explorer query to alert on (create from the explorer); ignored when `rule` is set
    response        optional current response of `query` (unit and a starting threshold)
    rule            metric rule to edit, or to copy when `mode` is 'create'
    mode            'create' (default) or 'edit'
    onSaved         called with the saved rule

  The rule watches one query or formula of the query (picked here when there
  are several). The preview charts the last hour of the watched item with the
  threshold line.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import {
    METRIC_ALERT_MAX_EVALUATIONS,
    METRIC_ALERT_MIN_EVALUATIONS,
    METRIC_ALERT_WINDOW_LABELS,
    METRIC_ALERT_WINDOWS,
    SEVERITIES,
    type MetricAlertCondition,
    type MetricAlertConfig,
    type MetricAlertWindow,
    type MetricExplorerQuery,
    type MetricQueryResponse,
    type Severity,
  } from '@logtide/shared';
  import { alertsAPI, type AlertRule } from '$lib/api/alerts';
  import { metricsV2API } from '$lib/api/metrics-v2';
  import { toastStore } from '$lib/stores/toast';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { SelectField } from '$lib/components/ui/select';
  import Button from '$lib/components/ui/button/button.svelte';
  import { ChannelSelector } from '$lib/components/notification-channels';
  import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';
  import MetricSeriesView from '$lib/components/metrics/v2/MetricSeriesView.svelte';
  import {
    alertTargetOptions,
    buildMetricAlertQuery,
    defaultAlertTarget,
    suggestThreshold,
    targetUnit,
    thresholdFromDisplay,
    thresholdToDisplay,
    thresholdUnitLabel,
  } from './metric-alert-model';

  interface Props {
    open: boolean;
    organizationId: string;
    query?: MetricExplorerQuery | null;
    response?: MetricQueryResponse | null;
    rule?: AlertRule | null;
    mode?: 'create' | 'edit';
    onSaved?: (rule: AlertRule) => void;
  }

  let {
    open = $bindable(false),
    organizationId,
    query = null,
    response = null,
    rule = null,
    mode = 'create',
    onSaved,
  }: Props = $props();

  const PREVIEW_MS = 60 * 60 * 1000;

  const CONDITION_OPTIONS = [
    { value: 'above', label: 'Above' },
    { value: 'below', label: 'Below' },
  ];
  const WINDOW_OPTIONS = METRIC_ALERT_WINDOWS.map((w) => ({ value: w, label: METRIC_ALERT_WINDOW_LABELS[w] }));
  const SEVERITY_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));
  const RENOTIFY_OPTIONS = [
    { value: '', label: 'Never' },
    { value: '15', label: 'Every 15 minutes' },
    { value: '30', label: 'Every 30 minutes' },
    { value: '60', label: 'Every hour' },
    { value: '240', label: 'Every 4 hours' },
    { value: '1440', label: 'Every day' },
  ];

  // The explorer query the rule is built from (the stored query when editing).
  let source = $state<MetricExplorerQuery | null>(null);
  let targetId = $state('');
  let name = $state('');
  let condition = $state<string>('above');
  let thresholdText = $state('');
  let windowValue = $state<string>('5m');
  let forText = $state('2');
  let severity = $state<string>('high');
  let renotify = $state('');
  let channelIds = $state<string[]>([]);
  let saving = $state(false);
  let submitted = $state(false);

  let preview = $state<MetricQueryResponse | null>(null);
  let previewLoading = $state(false);
  let previewError = $state<string | null>(null);

  const targets = $derived(source ? alertTargetOptions(source) : []);
  const target = $derived(targets.find((t) => t.id === targetId) ?? null);
  const targetOptions = $derived(targets.map((t) => ({ value: t.id, label: t.label })));
  const metricName = $derived(target?.metricName ?? null);
  // Unit saved with the rule (edit), else the one of the data. Fixed per form
  // session so the displayed threshold never changes scale under the user.
  let savedUnit = $state<string | null | undefined>(undefined);
  const unit = $derived(
    savedUnit !== undefined ? savedUnit : (targetUnit(response, targetId) ?? targetUnit(preview, targetId))
  );
  const unitLabel = $derived(thresholdUnitLabel(unit, metricName));
  const builtQuery = $derived(source && targetId ? buildMetricAlertQuery(source, targetId) : null);
  const thresholdDisplay = $derived(thresholdText.trim() === '' ? NaN : Number(thresholdText));
  const thresholdRaw = $derived(
    Number.isFinite(thresholdDisplay) ? thresholdFromDisplay(thresholdDisplay, unit, metricName) : null
  );
  const forEvaluations = $derived(Number(forText));
  const editing = $derived(mode === 'edit' && !!rule);

  const errors = $derived.by(() => {
    const e: Record<string, string> = {};
    if (name.trim() === '') e.name = 'Name is required';
    if (!target) e.target = 'Pick the query or formula to watch';
    if (thresholdRaw === null) e.threshold = 'Enter a number';
    if (
      !Number.isInteger(forEvaluations) ||
      forEvaluations < METRIC_ALERT_MIN_EVALUATIONS ||
      forEvaluations > METRIC_ALERT_MAX_EVALUATIONS
    ) {
      e.forEvaluations = `Between ${METRIC_ALERT_MIN_EVALUATIONS} and ${METRIC_ALERT_MAX_EVALUATIONS}`;
    }
    return e;
  });
  const valid = $derived(Object.keys(errors).length === 0);

  function defaultName(q: MetricExplorerQuery, id: string): string {
    const t = alertTargetOptions(q).find((o) => o.id === id);
    const what = t ? (t.metricName ?? t.label.replace(/^F\d: /, '')) : 'metric';
    return `High ${what}`;
  }

  // Reset the form every time the dialog opens.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      const config = rule?.metricConfig ?? null;
      const q = config ? config.query : query;
      source = q ? (JSON.parse(JSON.stringify(q)) as MetricExplorerQuery) : null;
      targetId = source ? (defaultAlertTarget(source) ?? '') : '';
      submitted = false;
      saving = false;
      preview = null;
      previewError = null;
      savedUnit = config?.unit !== undefined ? config.unit : undefined;
      if (config && rule) {
        name = mode === 'edit' ? rule.name : `${rule.name} (copy)`;
        condition = config.condition;
        windowValue = config.window;
        forText = String(config.forEvaluations);
        severity = config.severity;
        renotify = rule.renotifyMinutes ? String(rule.renotifyMinutes) : '';
        channelIds = [...(rule.channelIds ?? [])];
        // Display units are known once the preview returns the unit.
        thresholdText = String(
          thresholdToDisplay(config.threshold, config.unit ?? null, targetMetricNameOf(source, targetId))
        );
      } else {
        name = source && targetId ? defaultName(source, targetId) : '';
        condition = 'above';
        windowValue = '5m';
        forText = '2';
        severity = 'high';
        renotify = '';
        channelIds = [];
        const suggested = suggestThreshold(response, targetId, 'above', targetMetricNameOf(source, targetId));
        thresholdText = suggested === null ? '' : String(suggested);
      }
    });
  });

  function targetMetricNameOf(q: MetricExplorerQuery | null, id: string): string | null {
    return q ? (alertTargetOptions(q).find((o) => o.id === id)?.metricName ?? null) : null;
  }

  // Preview: the last hour of the watched item.
  let previewSeq = 0;
  $effect(() => {
    const q = builtQuery;
    if (!open || !q) return;
    const mine = ++previewSeq;
    const to = new Date();
    const from = new Date(to.getTime() - PREVIEW_MS);
    previewLoading = true;
    previewError = null;
    metricsV2API
      .query({ ...q, organizationId, from: from.toISOString(), to: to.toISOString() })
      .then((res) => {
        if (mine === previewSeq) preview = res;
      })
      .catch((e: unknown) => {
        if (mine === previewSeq) previewError = e instanceof Error ? e.message : 'Could not load the preview';
      })
      .finally(() => {
        if (mine === previewSeq) previewLoading = false;
      });
  });

  function buildConfig(): MetricAlertConfig | null {
    if (!builtQuery || thresholdRaw === null) return null;
    return {
      query: builtQuery,
      condition: condition as MetricAlertCondition,
      threshold: thresholdRaw,
      window: windowValue as MetricAlertWindow,
      forEvaluations,
      severity: severity as Severity,
      unit: unit ?? null,
    };
  }

  async function save() {
    submitted = true;
    const metricConfig = buildConfig();
    if (!valid || !metricConfig) return;
    saving = true;
    try {
      const renotifyMinutes = renotify === '' ? null : Number(renotify);
      const res =
        editing && rule
          ? await alertsAPI.updateAlertRule(organizationId, rule.id, {
              name: name.trim(),
              metricConfig,
              channelIds,
              renotifyMinutes,
            })
          : await alertsAPI.createAlertRule({
              organizationId,
              name: name.trim(),
              alertType: 'metric',
              metricConfig,
              channelIds,
              renotifyMinutes,
            });
      toastStore.success(editing ? 'Metric alert updated' : 'Metric alert created');
      open = false;
      onSaved?.(res.alertRule);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Could not save the alert');
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{editing ? 'Edit metric alert' : 'Create metric alert'}</Dialog.Title>
      <Dialog.Description>
        Get notified when a metric crosses a threshold. Grouped queries alert per group.
      </Dialog.Description>
    </Dialog.Header>

    {#if !source || targets.length === 0}
      <p class="text-sm text-muted-foreground" role="status">Pick a metric in the explorer first.</p>
    {:else}
      <form
        class="space-y-4"
        data-dialog-scroll-body
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div class="space-y-1">
          <Label for="metric-alert-name">Name</Label>
          <Input id="metric-alert-name" bind:value={name} />
          {#if submitted && errors.name}<p class="text-xs text-destructive-text" role="alert">{errors.name}</p>{/if}
        </div>

        {#if targets.length > 1}
          <div class="space-y-1">
            <Label for="metric-alert-target">Watch</Label>
            <SelectField id="metric-alert-target" class="w-full" bind:value={targetId} options={targetOptions} />
          </div>
        {/if}

        <div class="grid gap-3 sm:grid-cols-3">
          <div class="space-y-1">
            <Label for="metric-alert-condition">Condition</Label>
            <SelectField id="metric-alert-condition" class="w-full" bind:value={condition} options={CONDITION_OPTIONS} />
          </div>
          <div class="space-y-1">
            <Label for="metric-alert-threshold">Threshold</Label>
            <div class="flex items-center gap-2">
              <Input id="metric-alert-threshold" type="number" step="any" bind:value={thresholdText} />
              {#if unitLabel}
                <span class="shrink-0 text-sm text-muted-foreground" data-testid="threshold-unit">{unitLabel}</span>
              {/if}
            </div>
            {#if submitted && errors.threshold}
              <p class="text-xs text-destructive-text" role="alert">{errors.threshold}</p>
            {/if}
          </div>
          <div class="space-y-1">
            <Label for="metric-alert-window">Window</Label>
            <SelectField id="metric-alert-window" class="w-full" bind:value={windowValue} options={WINDOW_OPTIONS} />
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <div class="space-y-1">
            <Label for="metric-alert-for">For (checks in a row)</Label>
            <Input
              id="metric-alert-for"
              type="number"
              min={METRIC_ALERT_MIN_EVALUATIONS}
              max={METRIC_ALERT_MAX_EVALUATIONS}
              bind:value={forText}
            />
            {#if submitted && errors.forEvaluations}
              <p class="text-xs text-destructive-text" role="alert">{errors.forEvaluations}</p>
            {/if}
          </div>
          <div class="space-y-1">
            <Label for="metric-alert-severity">Severity</Label>
            <SelectField id="metric-alert-severity" class="w-full" bind:value={severity} options={SEVERITY_OPTIONS} />
          </div>
          <div class="space-y-1">
            <Label for="metric-alert-renotify">Re-notify while firing</Label>
            <SelectField id="metric-alert-renotify" class="w-full" bind:value={renotify} options={RENOTIFY_OPTIONS} />
          </div>
        </div>
        <p class="text-xs text-muted-foreground">
          The value is the average over the window, checked every minute. The alert fires after the condition holds for
          the given number of checks in a row and resolves on the first check where it does not.
        </p>

        <div class="space-y-1">
          <Label>Notification channels</Label>
          <ChannelSelector
            selectedIds={channelIds}
            onSelectionChange={(ids) => (channelIds = ids)}
            placeholder="Select channels..."
          />
          <WillNotify
            eventType="alert"
            projectId={builtQuery?.projectIds?.length === 1 ? builtQuery.projectIds[0] : null}
            {channelIds}
          />
        </div>

        <div class="space-y-1" data-testid="metric-alert-preview">
          <p class="text-sm font-medium">Last hour</p>
          <MetricSeriesView
            response={preview}
            loading={previewLoading}
            error={previewError}
            display="lines"
            metricNames={metricName ? { [targetId]: metricName } : {}}
            height={200}
            threshold={thresholdRaw}
          />
        </div>
      </form>
    {/if}

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button type="button" disabled={saving || !source || targets.length === 0} onclick={save}>
        {editing ? 'Save changes' : 'Create alert'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
