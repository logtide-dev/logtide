<script lang="ts">
  import Input from '$lib/components/ui/input/input.svelte';

  interface Props {
    service: string;
    /** '1' sessions with errors, '0' without, '' any. */
    errors: '' | '0' | '1';
    onChange: (patch: { service?: string; errors?: '' | '0' | '1' }) => void;
  }

  let { service, errors, onChange }: Props = $props();

  let draft = $state('');
  $effect(() => {
    draft = service;
  });

  function commitService() {
    const next = draft.trim();
    if (next !== service) onChange({ service: next });
  }
</script>

<div class="flex flex-wrap items-end gap-3">
  <div class="space-y-1">
    <label class="text-xs font-medium text-muted-foreground" for="sessions-filter-service">Service</label>
    <Input
      id="sessions-filter-service"
      type="text"
      placeholder="Any service"
      class="h-9 w-[220px]"
      bind:value={draft}
      onblur={commitService}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Enter') commitService();
      }}
    />
  </div>

  <div class="space-y-1">
    <label class="text-xs font-medium text-muted-foreground" for="sessions-filter-errors">Errors</label>
    <select
      id="sessions-filter-errors"
      class="block h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      value={errors}
      onchange={(e) => onChange({ errors: e.currentTarget.value as '' | '0' | '1' })}
    >
      <option value="">All sessions</option>
      <option value="1">With errors</option>
      <option value="0">Without errors</option>
    </select>
  </div>
</div>
