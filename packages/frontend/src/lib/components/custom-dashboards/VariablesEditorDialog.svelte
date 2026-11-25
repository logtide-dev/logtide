<!--
  Edit the dashboard variables (edit mode): add, remove, rename, label,
  attribute scope + key (with autocomplete), optional metric and default.
  Saving hands the new list to onSave; the dashboard is saved with its panels.
-->
<script lang="ts">
  import {
    DASHBOARD_MAX_VARIABLES,
    type DashboardVariable,
    type MetricAttrScope,
  } from '@logtide/shared';
  import * as Dialog from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { SelectField } from '$lib/components/ui/select';
  import AutocompleteInput from '$lib/components/metrics/v2/AutocompleteInput.svelte';
  import { metricsV2API, type MetricsV2API } from '$lib/api/metrics-v2';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { validateVariables } from './variables-editor';

  type LookupApi = Pick<MetricsV2API, 'getAttributes'>;

  interface Props {
    open: boolean;
    variables: DashboardVariable[];
    organizationId: string;
    projectId?: string | null;
    onSave: (variables: DashboardVariable[]) => void;
    onOpenChange: (open: boolean) => void;
    api?: LookupApi;
  }

  let {
    open = $bindable(),
    variables,
    organizationId,
    projectId = null,
    onSave,
    onOpenChange,
    api = metricsV2API,
  }: Props = $props();

  const SCOPES = [
    { value: 'resource', label: 'Resource attribute' },
    { value: 'metric', label: 'Metric attribute' },
  ];

  let draft = $state<DashboardVariable[]>([]);
  let keyOptions = $state<Record<string, string[]>>({});

  // Fresh copy each time the dialog opens, so Cancel discards edits.
  $effect(() => {
    if (open) {
      draft = JSON.parse(JSON.stringify(variables));
      keyOptions = {};
    }
  });

  const errors = $derived(validateVariables(draft));
  const canSave = $derived(errors.every((e) => e === null));

  function add() {
    if (draft.length >= DASHBOARD_MAX_VARIABLES) return;
    const taken = new Set(draft.map((v) => v.name));
    let n = 1;
    while (taken.has(`var${n}`)) n++;
    draft = [
      ...draft,
      { name: `var${n}`, label: '', attr: { scope: 'resource', key: '' }, metricName: null, default: null },
    ];
  }

  function remove(index: number) {
    draft = draft.filter((_, i) => i !== index);
  }

  function patch(index: number, change: Partial<DashboardVariable>) {
    draft = draft.map((v, i) => (i === index ? { ...v, ...change } : v));
  }

  async function loadKeys(index: number) {
    const v = draft[index];
    if (!v) return;
    try {
      const keys = await api.getAttributes({
        organizationId,
        projectIds: projectId ? [projectId] : null,
        scope: v.attr.scope,
        metricName: v.metricName ?? undefined,
      });
      keyOptions = { ...keyOptions, [v.name + ':' + index]: keys };
    } catch {
      keyOptions = { ...keyOptions, [v.name + ':' + index]: [] };
    }
  }

  function handleSave() {
    if (!canSave) return;
    onSave(
      draft.map((v) => ({
        name: v.name,
        label: v.label.trim() || v.name,
        attr: { scope: v.attr.scope, key: v.attr.key.trim() },
        metricName: v.metricName && v.metricName.trim() ? v.metricName.trim() : null,
        default: v.default && v.default.trim() ? v.default.trim() : null,
      }))
    );
    onOpenChange(false);
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => onOpenChange(o)}>
  <Dialog.Content class="max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Dashboard variables</Dialog.Title>
      <Dialog.Description>
        Variables add selectors above the panels. Use them in a metrics panel filter as $name.
      </Dialog.Description>
    </Dialog.Header>

    <div data-dialog-scroll-body class="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
      {#if draft.length === 0}
        <p class="text-sm text-muted-foreground">No variables yet.</p>
      {/if}
      {#each draft as v, i (i)}
        <div class="rounded-lg border p-3 space-y-3" data-testid="variable-row">
          <div class="flex items-start gap-2">
            <div class="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-2">
              <label class="space-y-1 text-xs text-muted-foreground">
                Name
                <Input
                  aria-label="Variable name"
                  value={v.name}
                  oninput={(e) => patch(i, { name: (e.currentTarget as HTMLInputElement).value })}
                />
              </label>
              <label class="space-y-1 text-xs text-muted-foreground">
                Label
                <Input
                  aria-label="Variable label"
                  value={v.label}
                  placeholder={v.name}
                  oninput={(e) => patch(i, { label: (e.currentTarget as HTMLInputElement).value })}
                />
              </label>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove variable {v.name}"
              onclick={() => remove(i)}
            >
              <Trash2 class="w-4 h-4" />
            </Button>
          </div>
          {#if errors[i]}
            <p class="text-xs text-destructive" role="alert">{errors[i]}</p>
          {/if}

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">Attribute scope</span>
              <SelectField
                size="sm"
                aria-label="Attribute scope"
                value={v.attr.scope}
                options={SCOPES}
                onValueChange={(s) => patch(i, { attr: { ...v.attr, scope: s as MetricAttrScope } })}
              />
            </div>
            <div class="space-y-1">
              <span class="text-xs text-muted-foreground">Attribute key</span>
              <AutocompleteInput
                class="w-full"
                ariaLabel="Attribute key"
                placeholder="host.name"
                value={v.attr.key}
                options={(keyOptions[v.name + ':' + i] ?? []).map((k) => ({ value: k }))}
                onOpen={() => loadKeys(i)}
                onCommit={(k) => patch(i, { attr: { ...v.attr, key: k } })}
              />
            </div>
            <label class="space-y-1 text-xs text-muted-foreground">
              Metric (optional)
              <Input
                aria-label="Variable metric"
                value={v.metricName ?? ''}
                placeholder="Read values from every metric"
                oninput={(e) => patch(i, { metricName: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
            <label class="space-y-1 text-xs text-muted-foreground">
              Default (optional)
              <Input
                aria-label="Variable default"
                value={v.default ?? ''}
                placeholder="All"
                oninput={(e) => patch(i, { default: (e.currentTarget as HTMLInputElement).value })}
              />
            </label>
          </div>
        </div>
      {/each}

      <Button
        variant="outline"
        class="gap-2"
        onclick={add}
        disabled={draft.length >= DASHBOARD_MAX_VARIABLES}
      >
        <Plus class="w-4 h-4" />
        Add variable
      </Button>
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => onOpenChange(false)}>Cancel</Button>
      <Button onclick={handleSave} disabled={!canSave}>Apply</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
