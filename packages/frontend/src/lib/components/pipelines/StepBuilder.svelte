<script lang="ts">
  import type { PipelineStep } from '$lib/api/log-pipeline';
  import StepConfig from './StepConfig.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '$lib/components/ui/select';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Plus from '@lucide/svelte/icons/plus';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  interface Props {
    steps: PipelineStep[];
    onChange: (steps: PipelineStep[]) => void;
  }
  let { steps, onChange }: Props = $props();

  let newStepType = $state<PipelineStep['type']>('parser');

  const stepTypeLabels: Record<PipelineStep['type'], string> = {
    parser: 'Parser',
    grok: 'Grok',
    geoip: 'GeoIP',
  };

  function addStep(type: PipelineStep['type']) {
    const defaults: Record<string, PipelineStep> = {
      parser: { type: 'parser', parser: 'nginx' },
      grok: { type: 'grok', pattern: '' },
      geoip: { type: 'geoip', field: 'client_ip', target: 'geo' },
    };
    onChange([...steps, defaults[type]]);
  }

  function removeStep(i: number) {
    onChange(steps.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, updated: PipelineStep) {
    onChange(steps.map((s, idx) => (idx === i ? updated : s)));
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...steps];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  }

  function moveDown(i: number) {
    if (i === steps.length - 1) return;
    const next = [...steps];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    onChange(next);
  }
</script>

<div class="space-y-3">
  {#if steps.length === 0}
    <p class="text-sm text-muted-foreground py-4 text-center">No steps yet. Add a step below.</p>
  {:else}
    {#each steps as step, i}
      <div class="border rounded-lg p-4 space-y-3 bg-muted/20">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">
            Step {i + 1} - {stepTypeLabels[step.type]}
          </span>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              onclick={() => moveUp(i)}
              disabled={i === 0}
              title="Move up"
              aria-label="Move step up"
            >
              <ChevronUp class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              onclick={() => moveDown(i)}
              disabled={i === steps.length - 1}
              title="Move down"
              aria-label="Move step down"
            >
              <ChevronDown class="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-destructive hover:text-destructive"
              onclick={() => removeStep(i)}
              title="Remove step"
              aria-label="Remove step"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <StepConfig {step} onUpdate={(updated) => updateStep(i, updated)} />
      </div>
    {/each}
  {/if}

  <!-- Add step row -->
  <div class="flex items-center gap-2 pt-2">
    <Select
      type="single"
      value={newStepType}
      onValueChange={(v) => { if (v) newStepType = v as PipelineStep['type']; }}
    >
      <SelectTrigger class="w-[140px]">
        <SelectValue>{stepTypeLabels[newStepType]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="parser">Parser</SelectItem>
        <SelectItem value="grok">Grok</SelectItem>
        <SelectItem value="geoip">GeoIP</SelectItem>
      </SelectContent>
    </Select>
    <Button variant="outline" class="gap-2" onclick={() => addStep(newStepType)}>
      <Plus class="w-4 h-4" />
      Add step
    </Button>
  </div>
</div>
