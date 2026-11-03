<script lang="ts">
  import { SelectField } from '$lib/components/ui/select';
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
    <SelectField
      id="sessions-filter-errors"
      class="w-44"
      value={errors}
      onValueChange={(v) => onChange({ errors: v as '' | '0' | '1' })}
      options={[
        { value: '', label: 'All sessions' },
        { value: '1', label: 'With errors' },
        { value: '0', label: 'Without errors' },
      ]}
    />
  </div>
</div>
