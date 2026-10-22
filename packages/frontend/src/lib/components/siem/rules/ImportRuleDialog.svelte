<script lang="ts">
  import { MAX_RULE_YAML_BYTES } from '@logtide/shared';
  import { sigmaAPI } from '$lib/api/sigma';
  import { toastStore } from '$lib/stores/toast';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import Spinner from '$lib/components/Spinner.svelte';
  import { ChannelSelector } from '$lib/components/notification-channels';
  import WillNotify from '$lib/components/notification-channels/WillNotify.svelte';

  interface Props {
    open: boolean;
    organizationId: string;
    onImported: (ruleId: string) => void;
  }

  type Validation = {
    valid: boolean;
    errors: string[];
    warnings: string[];
    summary?: { title: string; level?: string; status?: string; tags: string[] };
  };

  let { open = $bindable(false), organizationId, onImported }: Props = $props();

  const VALIDATE_DEBOUNCE_MS = 500;

  let yaml = $state('');
  let channelIds = $state<string[]>([]);
  let validation = $state<Validation | null>(null);
  let validating = $state(false);
  let submitting = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  const tooLarge = $derived(new TextEncoder().encode(yaml).length > MAX_RULE_YAML_BYTES);
  const canSubmit = $derived(
    yaml.trim().length > 0 && !tooLarge && !validating && !submitting && validation?.valid === true,
  );

  // Reopening starts from a clean form.
  $effect(() => {
    if (open) {
      yaml = '';
      channelIds = [];
      validation = null;
    }
  });

  let sequence = 0;

  $effect(() => {
    const text = yaml;
    const orgId = organizationId;
    if (!open) return;
    if (text.trim() === '') {
      validation = null;
      validating = false;
      return;
    }
    if (tooLarge) {
      validation = { valid: false, errors: ['Rule YAML is larger than 64 KiB'], warnings: [] };
      validating = false;
      return;
    }
    validating = true;
    const current = ++sequence;
    const timer = setTimeout(async () => {
      try {
        const result = await sigmaAPI.validateYaml(orgId, text);
        if (current !== sequence) return;
        validation = result;
      } catch (e) {
        if (current !== sequence) return;
        validation = {
          valid: false,
          errors: [e instanceof Error ? e.message : 'Could not validate the rule'],
          warnings: [],
        };
      } finally {
        if (current === sequence) validating = false;
      }
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      yaml = await file.text();
    } catch {
      toastStore.error('Could not read the file');
    }
    input.value = '';
  }

  async function submit() {
    if (!canSubmit) return;
    submitting = true;
    try {
      const res = await sigmaAPI.importRule({
        yaml,
        organizationId,
        channelIds: channelIds.length > 0 ? channelIds : undefined,
      });
      toastStore.success('Rule imported');
      open = false;
      onImported(res.sigmaRule.id);
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to import rule');
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Import rule</Dialog.Title>
      <Dialog.Description>
        Paste a Sigma rule or upload a YAML file. The rule is checked as you type.
      </Dialog.Description>
    </Dialog.Header>

    <div data-dialog-scroll-body class="max-h-[60vh] space-y-4 overflow-y-auto py-2">
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label for="import-rule-yaml">Rule YAML</Label>
          <Button variant="outline" size="sm" onclick={() => fileInput?.click()}>Upload file</Button>
          <input
            bind:this={fileInput}
            type="file"
            accept=".yml,.yaml"
            class="hidden"
            aria-label="Upload rule file"
            data-testid="rule-file-input"
            onchange={onFile}
          />
        </div>
        <Textarea
          id="import-rule-yaml"
          bind:value={yaml}
          rows={12}
          class="font-mono text-xs"
          placeholder={'title: Suspicious login\nlogsource:\n  category: application\ndetection:\n  selection:\n    message|contains: failed\n  condition: selection'}
          spellcheck={false}
        />
      </div>

      <div aria-live="polite" class="space-y-1 text-sm">
        {#if validating}
          <p class="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" /> Checking rule
          </p>
        {:else if validation}
          {#if validation.valid}
            <p class="text-success-text">
              {#if validation.summary}
                Valid rule: {validation.summary.title}{validation.summary.level
                  ? `, ${validation.summary.level}`
                  : ''}
              {:else}
                Valid rule
              {/if}
            </p>
          {/if}
          {#each validation.errors as err (err)}
            <p class="text-destructive-text">{err}</p>
          {/each}
          {#each validation.warnings as warn (warn)}
            <p class="text-warning-text">{warn}</p>
          {/each}
        {/if}
      </div>

      <div class="space-y-2">
        <Label>Notification channels</Label>
        <ChannelSelector
          selectedIds={channelIds}
          onSelectionChange={(ids) => (channelIds = ids)}
          disabled={submitting}
          placeholder="Select channels"
        />
        <WillNotify eventType="sigma" {channelIds} />
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)} disabled={submitting}>Cancel</Button>
      <Button onclick={submit} disabled={!canSubmit}>
        {#if submitting}<Spinner size="sm" class="mr-2" />{/if}
        Import rule
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
