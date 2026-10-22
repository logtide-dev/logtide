<script lang="ts">
  import { MITRE_TACTICS, SIGMA_LEVELS } from '@logtide/shared';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import type { RuleFilterValue } from './rule-filters';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    value: RuleFilterValue;
    onChange: (value: RuleFilterValue) => void;
  }

  let { value, onChange }: Props = $props();

  const DEBOUNCE_MS = 300;

  const SEVERITY_LABELS: Record<string, string> = {
    informational: 'Info',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
  };
  const SOURCES = [
    { value: 'custom', label: 'Custom' },
    { value: 'sigmahq', label: 'SigmaHQ' },
    { value: 'pack', label: 'Packs' },
  ];
  const ENABLED = [
    { value: 'all', label: 'All' },
    { value: 'true', label: 'Enabled' },
    { value: 'false', label: 'Disabled' },
  ] as const;
  const TACTICS = Object.entries(MITRE_TACTICS).map(([key, t]) => ({ key, name: t.name }));

  // The text box keeps its own copy so typing is not fought by URL round trips.
  let text = $state('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastEmitted = '';

  $effect(() => {
    // Follow external changes (Clear filters, back button) but not our own echo.
    if (value.q !== lastEmitted) {
      text = value.q;
      lastEmitted = value.q;
    }
  });

  $effect(() => () => clearTimeout(timer));

  function onInput(next: string) {
    text = next;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastEmitted = next;
      onChange({ ...value, q: next });
    }, DEBOUNCE_MS);
  }

  function toggle(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  }

  function emit(patch: Partial<RuleFilterValue>) {
    clearTimeout(timer);
    lastEmitted = text;
    onChange({ ...value, q: text, ...patch });
  }

  const active = $derived(
    value.q !== '' ||
      value.severity.length > 0 ||
      value.tactic.length > 0 ||
      value.source.length > 0 ||
      value.enabled !== 'all',
  );

  const chip =
    'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const chipOn = 'border-primary bg-primary/10 text-foreground';
  const chipOff = 'border-border text-muted-foreground hover:text-foreground';
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-3">
    <Input
      type="search"
      class="max-w-xs"
      placeholder="Search rules"
      aria-label="Search rules"
      value={text}
      oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
    />
    <select
      aria-label="MITRE tactic"
      class="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={value.tactic[0] ?? ''}
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        emit({ tactic: v ? [v] : [] });
      }}
    >
      <option value="">All tactics</option>
      {#each TACTICS as t (t.key)}
        <option value={t.key}>{t.name}</option>
      {/each}
    </select>
    {#if active}
      <Button
        variant="ghost"
        size="sm"
        onclick={() => {
          clearTimeout(timer);
          text = '';
          lastEmitted = '';
          onChange({ q: '', severity: [], tactic: [], source: [], enabled: 'all' });
        }}
      >
        <X aria-hidden="true" />
        Clear filters
      </Button>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Severity">
      {#each SIGMA_LEVELS as level (level)}
        <button
          type="button"
          class="{chip} {value.severity.includes(level) ? chipOn : chipOff}"
          aria-pressed={value.severity.includes(level)}
          onclick={() => emit({ severity: toggle(value.severity, level) })}
        >
          {SEVERITY_LABELS[level]}
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Source">
      {#each SOURCES as s (s.value)}
        <button
          type="button"
          class="{chip} {value.source.includes(s.value) ? chipOn : chipOff}"
          aria-pressed={value.source.includes(s.value)}
          onclick={() => emit({ source: toggle(value.source, s.value) })}
        >
          {s.label}
        </button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status">
      {#each ENABLED as e (e.value)}
        <button
          type="button"
          class="{chip} {value.enabled === e.value ? chipOn : chipOff}"
          aria-pressed={value.enabled === e.value}
          onclick={() => emit({ enabled: e.value })}
        >
          {e.label}
        </button>
      {/each}
    </div>
  </div>
</div>
