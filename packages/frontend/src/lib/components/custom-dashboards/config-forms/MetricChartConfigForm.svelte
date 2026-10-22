<script lang="ts">
  import type { MetricChartConfig, MetricAggregation, MetricInterval } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import ProjectSelect from '../pickers/ProjectSelect.svelte';
  import SuggestInput from '../pickers/SuggestInput.svelte';
  import {
    createServiceOptions,
    keepServiceForProject,
    createMetricNameOptions,
    createLabelKeyOptions,
  } from '../pickers/options-state.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { TIME_RANGE_OPTIONS, timeRangeLabel } from '../time-range-options';

  interface Props {
    config: MetricChartConfig;
    onChange: (updated: MetricChartConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const services = createServiceOptions('metrics', () => config.projectId);
  const metricNames = createMetricNameOptions(() => config.projectId);
  const labelKeys = createLabelKeyOptions(() => config.projectId, () => config.metricName);

  // Keep the selected service when the new project offers it, drop it otherwise.
  async function handleProjectChange(projectId: string | null) {
    onChange({ ...config, projectId });
    if (!(await keepServiceForProject('metrics', projectId, config.serviceName))) {
      onChange({ ...config, projectId, serviceName: null });
    }
  }

  const aggregations: MetricAggregation[] = ['avg', 'sum', 'min', 'max', 'count', 'last', 'p50', 'p95', 'p99'];
  const intervals: MetricInterval[] = ['1m', '5m', '15m', '1h', '6h', '1d'];

  const MAX_GROUP_KEYS = 2;
  const GROUP_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$/;

  let newGroupKey = $state('');
  const groupKeys = $derived(config.groupBy ?? []);
  // Suggestions need a project and a metric; without them it is plain typing.
  const groupSuggestions = $derived(config.projectId && config.metricName.trim() ? labelKeys.list : []);
  const canAddGroupKey = $derived(
    GROUP_KEY_RE.test(newGroupKey.trim()) &&
      !groupKeys.includes(newGroupKey.trim()) &&
      groupKeys.length < MAX_GROUP_KEYS
  );

  /** groupBy is omitted from the config when empty. */
  function setGroupBy(keys: string[]) {
    const { groupBy: _previous, ...rest } = config;
    onChange(keys.length > 0 ? { ...rest, groupBy: keys } : rest);
  }

  function addGroupKey() {
    if (!canAddGroupKey) return;
    setGroupBy([...groupKeys, newGroupKey.trim()]);
    newGroupKey = '';
  }

  function update<K extends keyof MetricChartConfig>(key: K, value: MetricChartConfig[K]) {
    onChange({ ...config, [key]: value });
  }
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="mc-title">Title</Label>
    <Input
      id="mc-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mc-project">Project</Label>
    <ProjectSelect
      id="mc-project"
      value={config.projectId}
      onChange={handleProjectChange}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mc-metric">Metric name</Label>
    <SuggestInput
      id="mc-metric"
      placeholder="e.g. http.server.request.duration"
      value={config.metricName}
      options={metricNames.list}
      loading={metricNames.loading}
      onChange={(v) => update('metricName', v)}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="mc-group-by">Group by (optional, up to 2 labels)</Label>
    {#if groupKeys.length > 0}
      <ul class="flex flex-wrap gap-2">
        {#each groupKeys as key (key)}
          <li class="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono">
            <span>{key}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              aria-label={`Remove group by ${key}`}
              onclick={() => setGroupBy(groupKeys.filter((k) => k !== key))}
            >
              &times;
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if groupKeys.length < MAX_GROUP_KEYS}
      <div class="flex gap-2">
        <div class="flex-1">
          <SuggestInput
            id="mc-group-by"
            placeholder="e.g. host"
            value={newGroupKey}
            options={groupSuggestions}
            loading={labelKeys.loading}
            onChange={(v) => (newGroupKey = v)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-label="Add group by label"
          disabled={!canAddGroupKey}
          onclick={addGroupKey}>Add label</Button
        >
      </div>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="space-y-1.5">
      <Label>Aggregation</Label>
      <Select
        type="single"
        value={config.aggregation}
        onValueChange={(v) => v && update('aggregation', v as MetricAggregation)}
      >
        <SelectTrigger>
          <SelectValue>{config.aggregation}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {#each aggregations as a}
            <SelectItem value={a}>{a}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
    <div class="space-y-1.5">
      <Label>Interval</Label>
      <Select
        type="single"
        value={config.interval}
        onValueChange={(v) => v && update('interval', v as MetricInterval)}
      >
        <SelectTrigger>
          <SelectValue>{config.interval}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {#each intervals as i}
            <SelectItem value={i}>{i}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
  </div>

  <div class="space-y-1.5">
    <Label>Time range</Label>
    <Select
      type="single"
      value={config.timeRange}
      onValueChange={(v) => v && update('timeRange', v as MetricChartConfig['timeRange'])}
    >
      <SelectTrigger>
        <SelectValue>{timeRangeLabel(config.timeRange)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each TIME_RANGE_OPTIONS as option (option.value)}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="space-y-1.5">
    <Label for="mc-service">Service filter (optional)</Label>
    <SuggestInput
      id="mc-service"
      placeholder="Leave empty for all services"
      value={config.serviceName ?? ''}
      options={services.list}
      loading={services.loading}
      onChange={(v) => update('serviceName', v.length > 0 ? v : null)}
    />
  </div>
</div>
