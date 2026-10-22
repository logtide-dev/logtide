<script lang="ts">
  import { MAX_RULE_YAML_BYTES } from '@logtide/shared';
  import { sigmaAPI } from '$lib/api/sigma';
  import { toastStore } from '$lib/stores/toast';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import ConfirmDialog from '$lib/components/app/ConfirmDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import Spinner from '$lib/components/Spinner.svelte';

  interface Props {
    yaml: string;
    reconstructed: boolean;
    editable: boolean;
    organizationId: string;
    ruleId: string;
    onSaved: () => void;
    /** Edit mode, bindable so the page header can open it. */
    editing?: boolean;
    /** Text of the unsaved edit, or null when not editing. Feeds the preview. */
    draft?: string | null;
  }

  let {
    yaml,
    reconstructed,
    editable,
    organizationId,
    ruleId,
    onSaved,
    editing = $bindable(false),
    draft = $bindable(null),
  }: Props = $props();

  const VALIDATE_DEBOUNCE_MS = 500;

  let text = $state('');
  let errors = $state<string[]>([]);
  let warnings = $state<string[]>([]);
  let validating = $state(false);
  let saving = $state(false);
  let discardOpen = $state(false);

  const dirty = $derived(editing && text !== yaml);
  const tooLarge = $derived(new TextEncoder().encode(text).length > MAX_RULE_YAML_BYTES);
  const canSave = $derived(
    editing && dirty && !validating && !saving && errors.length === 0 && text.trim() !== '' && !tooLarge,
  );

  // Entering edit mode starts from the stored text.
  let wasEditing = false;
  $effect(() => {
    if (editing && !wasEditing) {
      text = yaml;
      errors = [];
      warnings = [];
    }
    wasEditing = editing;
  });

  $effect(() => {
    draft = editing ? text : null;
  });

  let sequence = 0;

  $effect(() => {
    if (!editing) return;
    const current = text;
    const orgId = organizationId;
    if (current === yaml) {
      errors = [];
      warnings = [];
      validating = false;
      return;
    }
    if (tooLarge) {
      errors = ['Rule YAML is larger than 64 KiB'];
      validating = false;
      return;
    }
    validating = true;
    const seq = ++sequence;
    const timer = setTimeout(async () => {
      try {
        const res = await sigmaAPI.validateYaml(orgId, current);
        if (seq !== sequence) return;
        errors = res.errors ?? [];
        warnings = res.warnings ?? [];
      } catch (e) {
        if (seq !== sequence) return;
        errors = [e instanceof Error ? e.message : 'Could not validate the rule'];
        warnings = [];
      } finally {
        if (seq === sequence) validating = false;
      }
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  function cancel() {
    if (dirty) {
      discardOpen = true;
      return;
    }
    editing = false;
  }

  async function save() {
    if (!canSave) return;
    saving = true;
    try {
      await sigmaAPI.updateRuleYaml(ruleId, organizationId, text);
      toastStore.success('Rule updated');
      editing = false;
      onSaved();
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to update rule');
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-3">
  {#if reconstructed}
    <p class="text-sm text-muted-foreground">
      Reconstructed from the stored rule (the original text was not saved)
    </p>
  {/if}

  {#if editing}
    <Textarea
      bind:value={text}
      rows={18}
      class="font-mono text-xs"
      aria-label="Rule YAML"
      spellcheck={false}
    />
    <div aria-live="polite" class="space-y-1 text-sm">
      {#if validating}
        <p class="flex items-center gap-2 text-muted-foreground"><Spinner size="sm" /> Checking rule</p>
      {/if}
      {#each errors as err (err)}
        <p class="text-destructive-text">{err}</p>
      {/each}
      {#each warnings as warn (warn)}
        <p class="text-warning-text">{warn}</p>
      {/each}
    </div>
    <div class="flex items-center gap-2">
      <Button onclick={save} disabled={!canSave}>
        {#if saving}<Spinner size="sm" class="mr-2" />{/if}
        Save
      </Button>
      <Button variant="outline" onclick={cancel} disabled={saving}>Cancel</Button>
    </div>
  {:else}
    <div class="relative rounded-md border border-border bg-muted/40">
      <div class="absolute right-1 top-1">
        <CopyButton value={yaml} ariaLabel="Copy YAML" />
      </div>
      <pre class="max-h-[28rem] overflow-auto p-4 pr-12 font-mono text-xs leading-relaxed">{yaml}</pre>
    </div>
    {#if editable}
      <Button variant="outline" onclick={() => (editing = true)}>Edit YAML</Button>
    {/if}
  {/if}
</div>

<ConfirmDialog
  bind:open={discardOpen}
  title="Discard changes?"
  description="Your edits to this rule have not been saved."
  confirmLabel="Discard changes"
  onConfirm={() => {
    editing = false;
  }}
/>
