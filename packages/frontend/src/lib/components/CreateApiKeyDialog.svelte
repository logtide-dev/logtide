<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Spinner from './Spinner.svelte';
  import * as Alert from '$lib/components/ui/alert';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { checklistStore } from '$lib/stores/checklist';

  interface Props {
    onSubmit: (data: { name: string }) => Promise<{ apiKey: string; message: string }>;
    open?: boolean;
  }

  let { onSubmit, open = $bindable(false) }: Props = $props();
  let name = $state('');
  let submitting = $state(false);
  let error = $state('');
  let generatedApiKey = $state<string | null>(null);
  let copied = $state(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    submitting = true;
    try {
      const result = await onSubmit({
        name: name.trim(),
      });

      generatedApiKey = result.apiKey;

      // Mark checklist item as complete
      checklistStore.completeItem('create-api-key');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create API key';
    } finally {
      submitting = false;
    }
  }

  async function handleCopy() {
    if (!generatedApiKey) return;

    try {
      await navigator.clipboard.writeText(generatedApiKey);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  function handleClose() {
    name = '';
    generatedApiKey = null;
    error = '';
    copied = false;
    open = false;
  }

  $effect(() => {
    if (!open) {
      name = '';
      generatedApiKey = null;
      error = '';
      copied = false;
    }
  });
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
    {#if !generatedApiKey}
      <DialogHeader>
        <DialogTitle>Create API Key</DialogTitle>
        <DialogDescription>
          Create a new API key for this project. You'll be able to use it to send logs programmatically.
        </DialogDescription>
      </DialogHeader>

      <form onsubmit={handleSubmit} class="space-y-4 py-4">
        <div class="space-y-2">
          <Label for="api-key-name">API Key Name</Label>
          <Input
            id="api-key-name"
            type="text"
            placeholder="Production API Key"
            bind:value={name}
            disabled={submitting}
            required
            autofocus
          />
          <p class="text-xs text-muted-foreground">
            Choose a descriptive name to identify this key later.
          </p>
        </div>

        {#if error}
          <div class="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        {/if}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onclick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting || !name.trim()}
            class="gap-2"
          >
            {#if submitting}
              <Spinner size="sm" />
              Creating...
            {:else}
              <Plus class="w-4 h-4" />
              Create API Key
            {/if}
          </Button>
        </DialogFooter>
      </form>
    {:else}
      <DialogHeader>
        <DialogTitle>API Key Created</DialogTitle>
        <DialogDescription>
          Your API key has been created successfully.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <Alert.Root variant="destructive">
          <Alert.Title>Important: Save this key now</Alert.Title>
          <Alert.Description>
            This is the only time you'll see this key. Copy it and store it securely.
            If you lose it, you'll need to create a new one.
          </Alert.Description>
        </Alert.Root>

        <div class="space-y-2">
          <Label>Your API Key</Label>
          <div class="flex gap-2 items-start">
            <div class="flex-1 min-w-0">
              <div class="relative">
                <div class="font-mono text-sm bg-muted border border-input rounded-md px-3 py-2 break-all select-all cursor-text overflow-x-auto">
                  {generatedApiKey}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              onclick={handleCopy}
              class="gap-2 shrink-0"
            >
              {#if copied}
                <Check class="w-4 h-4" />
                Copied
              {:else}
                <Copy class="w-4 h-4" />
                Copy
              {/if}
            </Button>
          </div>
        </div>

        <div class="bg-muted p-3 rounded-md space-y-1">
          <p class="text-xs font-medium">Usage Example:</p>
          <pre class="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all"><code>curl -X POST https://api.logtide.dev/api/v1/ingest \
  -H "X-API-Key: {generatedApiKey}" \
  -d '{`{"logs": [...]}`}'</code></pre>
        </div>
      </div>

      <DialogFooter>
        <Button onclick={handleClose} class="gap-2">
          Done
        </Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
