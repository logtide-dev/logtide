<script lang="ts">
  import { onMount } from 'svelte';
  import type { LogTableConfig, LogLevelKey, BuiltinLogColumn, Project } from '@logtide/shared';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { ProjectsAPI } from '$lib/api/projects';
  import { authStore } from '$lib/stores/auth';
  import { organizationStore } from '$lib/stores/organization';
  import { get } from 'svelte/store';

  interface Props {
    config: LogTableConfig;
    onChange: (updated: LogTableConfig) => void;
  }

  let { config, onChange }: Props = $props();

  const allLevels: LogLevelKey[] = ['debug', 'info', 'warn', 'error', 'critical'];
  const allBuiltins: BuiltinLogColumn[] = ['time', 'level', 'service', 'message'];
  const timeRanges: Array<LogTableConfig['timeRange']> = ['15m', '1h', '6h', '24h', '7d'];

  const BUILTIN_LABELS: Record<BuiltinLogColumn, string> = {
    time: 'Time',
    level: 'Level',
    service: 'Service',
    message: 'Message',
  };

  const modeOptions: Array<{ value: LogTableConfig['mode']; label: string }> = [
    { value: 'snapshot', label: 'Snapshot (auto-refresh)' },
    { value: 'live', label: 'Live (WebSocket)' },
  ];

  let projects = $state<Project[]>([]);
  let newColumn = $state('');

  onMount(async () => {
    // Best-effort project list; the form stays usable org-wide on failure.
    try {
      const token = get(authStore).token;
      const orgId = get(organizationStore).currentOrganization?.id;
      if (!token || !orgId) return;
      const api = new ProjectsAPI(() => token);
      const response = await api.getProjects(orgId);
      projects = response.projects;
    } catch {
      projects = [];
    }
  });

  function update<K extends keyof LogTableConfig>(key: K, value: LogTableConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  function toggleLevel(level: LogLevelKey) {
    const next = config.levels.includes(level)
      ? config.levels.filter((l) => l !== level)
      : [...config.levels, level];
    update('levels', next);
  }

  function toggleBuiltin(col: BuiltinLogColumn) {
    const next = config.builtinColumns.includes(col)
      ? config.builtinColumns.filter((c) => c !== col)
      : [...allBuiltins.filter((c) => c === col || config.builtinColumns.includes(c))];
    update('builtinColumns', next);
  }

  function addColumn() {
    const value = newColumn.trim();
    if (!value || config.columns.length >= 10) return;
    update('columns', [...config.columns, value]);
    newColumn = '';
  }

  function removeColumn(index: number) {
    update(
      'columns',
      config.columns.filter((_, i) => i !== index)
    );
  }

  function moveColumn(index: number, delta: number) {
    const next = [...config.columns];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update('columns', next);
  }

  const selectedProjectLabel = $derived(
    config.projectId === null
      ? 'All projects'
      : (projects.find((p) => p.id === config.projectId)?.name ?? 'Selected project')
  );
</script>

<div class="space-y-4">
  <div class="space-y-1.5">
    <Label for="lt-title">Title</Label>
    <Input
      id="lt-title"
      type="text"
      value={config.title}
      oninput={(e) => update('title', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Project</Label>
    <Select
      type="single"
      value={config.projectId ?? '__all__'}
      onValueChange={(v) => v && update('projectId', v === '__all__' ? null : v)}
    >
      <SelectTrigger>
        <SelectValue>{selectedProjectLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All projects</SelectItem>
        {#each projects as project (project.id)}
          <SelectItem value={project.id}>{project.name}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
  </div>

  <div class="space-y-1.5">
    <Label>Mode</Label>
    <Select
      type="single"
      value={config.mode}
      onValueChange={(v) => v && update('mode', v as LogTableConfig['mode'])}
    >
      <SelectTrigger>
        <SelectValue>{modeOptions.find((o) => o.value === config.mode)?.label ?? config.mode}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {#each modeOptions as option (option.value)}
          <SelectItem value={option.value}>{option.label}</SelectItem>
        {/each}
      </SelectContent>
    </Select>
    {#if config.mode === 'live' && config.projectId === null}
      <p class="text-sm text-destructive">Live mode requires a specific project</p>
    {/if}
  </div>

  {#if config.mode === 'snapshot'}
    <div class="space-y-1.5">
      <Label>Time window</Label>
      <Select
        type="single"
        value={config.timeRange}
        onValueChange={(v) => v && update('timeRange', v as LogTableConfig['timeRange'])}
      >
        <SelectTrigger>
          <SelectValue>{config.timeRange}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {#each timeRanges as range (range)}
            <SelectItem value={range}>{range}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
  {/if}

  <div class="space-y-1.5">
    <Label>Levels (none selected = all)</Label>
    <div class="flex flex-wrap gap-2">
      {#each allLevels as level (level)}
        <button
          type="button"
          class="rounded-md border px-2 py-1 text-xs {config.levels.includes(level)
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground'}"
          onclick={() => toggleLevel(level)}
        >
          {level}
        </button>
      {/each}
    </div>
  </div>

  <div class="space-y-1.5">
    <Label for="lt-service">Service (optional)</Label>
    <Input
      id="lt-service"
      type="text"
      placeholder="Leave empty for all services"
      value={config.service ?? ''}
      oninput={(e) => {
        const val = (e.currentTarget as HTMLInputElement).value;
        update('service', val.length > 0 ? val : null);
      }}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="lt-maxrows">Max rows</Label>
    <Input
      id="lt-maxrows"
      type="number"
      min="10"
      max="100"
      value={config.maxRows}
      oninput={(e) => {
        const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        if (!Number.isNaN(v)) update('maxRows', Math.min(100, Math.max(10, v)));
      }}
    />
  </div>

  <div class="space-y-1.5">
    <Label>Built-in columns</Label>
    <div class="flex flex-wrap gap-2">
      {#each allBuiltins as col (col)}
        <button
          type="button"
          aria-label={`Toggle ${BUILTIN_LABELS[col]} column`}
          class="rounded-md border px-2 py-1 text-xs {config.builtinColumns.includes(col)
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground'}"
          onclick={() => toggleBuiltin(col)}
        >
          {BUILTIN_LABELS[col]}
        </button>
      {/each}
    </div>
  </div>

  <div class="space-y-1.5">
    <Label for="lt-col-input">Metadata columns (max 10)</Label>
    {#if config.columns.length > 0}
      <ul class="space-y-1">
        {#each config.columns as col, i (col + i)}
          <li class="flex items-center gap-1">
            <span class="flex-1 truncate font-mono text-xs">{col}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${col} up`}
              disabled={i === 0}
              onclick={() => moveColumn(i, -1)}>&uarr;</Button
            >
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Move ${col} down`}
              disabled={i === config.columns.length - 1}
              onclick={() => moveColumn(i, 1)}>&darr;</Button
            >
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${col}`}
              onclick={() => removeColumn(i)}>&times;</Button
            >
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex gap-2">
      <Input id="lt-col-input" placeholder="e.g. http_host or geo.city" bind:value={newColumn} />
      <Button
        aria-label="Add column"
        variant="secondary"
        disabled={newColumn.trim().length === 0 || config.columns.length >= 10}
        onclick={addColumn}>Add column</Button
      >
    </div>
    <p class="text-xs text-muted-foreground">
      Exact metadata key first, then dot path into nested objects, same as Log Search columns.
    </p>
  </div>

  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={config.wrapCells}
      onchange={(e) => update('wrapCells', (e.currentTarget as HTMLInputElement).checked)}
    />
    Wrap cell content instead of truncating
  </label>
</div>
