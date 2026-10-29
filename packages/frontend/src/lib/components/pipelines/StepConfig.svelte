<script lang="ts">
  import type { PipelineStep } from '$lib/api/log-pipeline';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '$lib/components/ui/select';

  interface Props {
    step: PipelineStep;
    onUpdate: (s: PipelineStep) => void;
  }
  let { step, onUpdate }: Props = $props();
</script>

<div class="space-y-3">
  {#if step.type === 'parser'}
    <div class="space-y-1.5">
      <Label>Parser format</Label>
      <Select
        type="single"
        value={step.parser ?? 'nginx'}
        onValueChange={(v) => { if (v) onUpdate({ ...step, parser: v as PipelineStep['parser'] }); }}
      >
        <SelectTrigger>
          <SelectValue>{step.parser ?? 'nginx'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="nginx">nginx</SelectItem>
          <SelectItem value="apache">apache</SelectItem>
          <SelectItem value="syslog">syslog</SelectItem>
          <SelectItem value="logfmt">logfmt</SelectItem>
          <SelectItem value="json">json</SelectItem>
        </SelectContent>
      </Select>
    </div>

  {:else if step.type === 'grok'}
    <div class="space-y-1.5">
      <Label for="grok-pattern">Grok pattern</Label>
      <Input
        id="grok-pattern"
        type="text"
        placeholder={'%{IP:client_ip} %{WORD:method} %{URIPATH:path}'}
        value={step.pattern ?? ''}
        oninput={(e) => onUpdate({ ...step, pattern: (e.currentTarget as HTMLInputElement).value })}
        class="font-mono text-sm"
      />
    </div>
    <div class="space-y-1.5">
      <Label for="grok-source">Source field <span class="text-muted-foreground text-xs">(optional, defaults to message)</span></Label>
      <Input
        id="grok-source"
        type="text"
        placeholder="message"
        value={step.source ?? ''}
        oninput={(e) => onUpdate({ ...step, source: (e.currentTarget as HTMLInputElement).value || undefined })}
      />
    </div>

  {:else if step.type === 'geoip'}
    <div class="space-y-1.5">
      <Label for="geoip-field">Source IP field</Label>
      <Input
        id="geoip-field"
        type="text"
        placeholder="client_ip"
        value={step.field ?? ''}
        oninput={(e) => onUpdate({ ...step, field: (e.currentTarget as HTMLInputElement).value })}
      />
    </div>
    <div class="space-y-1.5">
      <Label for="geoip-target">Target field</Label>
      <Input
        id="geoip-target"
        type="text"
        placeholder="geo"
        value={step.target ?? ''}
        oninput={(e) => onUpdate({ ...step, target: (e.currentTarget as HTMLInputElement).value })}
      />
    </div>
  {/if}
</div>
