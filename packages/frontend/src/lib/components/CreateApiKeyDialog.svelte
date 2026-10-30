<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import Spinner from './Spinner.svelte';
  import * as Alert from '$lib/components/ui/alert';
  import Plus from '@lucide/svelte/icons/plus';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import { checklistStore } from '$lib/stores/checklist';
  import { getApiUrl } from '$lib/config';
  import { buildDsn, resolveEndpoints } from '$lib/components/connect/endpoints';
  import { buildSnippets } from '$lib/components/connect/snippets';
  import type { ApiKeyType } from '$lib/api/api-keys';

  interface Props {
    onSubmit: (data: { name: string; type: ApiKeyType; allowedOrigins: string[] | null }) => Promise<{ apiKey: string; keyPrefix: string; type: ApiKeyType; message: string }>;
    open?: boolean;
  }

  let { onSubmit, open = $bindable(false) }: Props = $props();
  let name = $state('');
  let keyType = $state<ApiKeyType>('write');
  let originsRaw = $state('');
  let submitting = $state(false);
  let error = $state('');
  let generatedApiKey = $state<string | null>(null);
  let generatedKeyPrefix = $state('');
  let generatedKeyType = $state<ApiKeyType>('write');

  // One source for the DSN and the example request: the same endpoint
  // resolution the Connect snippets use (handles http, ports, base paths,
  // IPv6 and relative API URLs behind a reverse proxy).
  let endpoints = $derived(resolveEndpoints(getApiUrl(), window.location.origin));
  let dsn = $derived(generatedApiKey ? buildDsn(endpoints, generatedApiKey) : '');
  let curlExample = $derived(
    generatedApiKey
      ? (buildSnippets('curl', { endpoints, apiKey: generatedApiKey, service: 'my-app' })[0]?.code ?? '')
      : '',
  );

  function parseOrigins(raw: string): string[] | null {
    const list = raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? list : null;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    submitting = true;
    try {
      const result = await onSubmit({
        name: name.trim(),
        type: keyType,
        allowedOrigins: parseOrigins(originsRaw),
      });

      generatedApiKey = result.apiKey;
      generatedKeyPrefix = result.keyPrefix || result.apiKey.slice(0, 9);
      generatedKeyType = result.type;

      // Mark checklist item as complete
      checklistStore.completeItem('create-api-key');
    } catch (e) {
      // A capability limit (apikeys.max) arrives here with its own message and
      // stays on screen so the user can act on it.
      error = e instanceof Error ? e.message : 'Could not create the API key. Try again.';
    } finally {
      submitting = false;
    }
  }

  function reset() {
    name = '';
    keyType = 'write';
    originsRaw = '';
    generatedApiKey = null;
    generatedKeyPrefix = '';
    generatedKeyType = 'write';
    error = '';
  }

  function handleClose() {
    reset();
    open = false;
  }

  $effect(() => {
    if (!open) reset();
  });
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
    {#if !generatedApiKey}
      <DialogHeader>
        <DialogTitle>Create API key</DialogTitle>
        <DialogDescription>
          Create a new API key for this project. Use it to send logs, traces and metrics programmatically.
        </DialogDescription>
      </DialogHeader>

      <form onsubmit={handleSubmit} class="space-y-4 py-4">
        <div class="space-y-2">
          <Label for="api-key-name">API key name</Label>
          <Input
            id="api-key-name"
            type="text"
            placeholder="Production API key"
            bind:value={name}
            disabled={submitting}
            required
            autofocus
          />
          <p class="text-xs text-muted-foreground">
            Choose a descriptive name to identify this key later.
          </p>
        </div>

        <div class="space-y-2">
          <Label>Key type</Label>
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              class="rounded-md border p-3 text-left transition-colors {keyType === 'write'
                ? 'border-primary bg-primary/5'
                : 'border-input hover:border-primary/50'}"
              onclick={() => (keyType = 'write')}
            >
              <div class="font-medium text-sm">Write-only</div>
              <div class="text-xs text-muted-foreground mt-1">
                Can only send data. Safe for client-side use.
              </div>
            </button>
            <button
              type="button"
              class="rounded-md border p-3 text-left transition-colors {keyType === 'full'
                ? 'border-primary bg-primary/5'
                : 'border-input hover:border-primary/50'}"
              onclick={() => (keyType = 'full')}
            >
              <div class="font-medium text-sm">Full access</div>
              <div class="text-xs text-muted-foreground mt-1">
                Can send and query data. Server-side only.
              </div>
            </button>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="allowed-origins">
            Allowed origins and IPs
            <span class="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="allowed-origins"
            placeholder={"https://app.example.com\n192.168.1.0\n*.mycompany.com"}
            bind:value={originsRaw}
            disabled={submitting}
            rows={3}
          />
          <p class="text-xs text-muted-foreground">
            One per line or comma-separated. Leave empty for no restriction.
            Matches Origin header (browsers) or request IP (servers).
          </p>
        </div>

        {#if error}
          <div class="text-sm text-destructive bg-destructive/10 p-3 rounded-md" role="alert">
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
              Create API key
            {/if}
          </Button>
        </DialogFooter>
      </form>
    {:else}
      <DialogHeader>
        <DialogTitle>API key created</DialogTitle>
        <DialogDescription>
          Your API key was created.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <Alert.Root variant="destructive">
          <Alert.Title>Save this key now</Alert.Title>
          <Alert.Description>
            This is the only time you'll see this key. Copy it and store it securely.
            If you lose it, you'll need to create a new one.
          </Alert.Description>
        </Alert.Root>

        <div class="space-y-2">
          <Label>Your API key</Label>
          <div class="flex gap-2 items-start">
            <div class="flex-1 min-w-0">
              <div class="font-mono text-sm bg-muted border border-input rounded-md px-3 py-2 break-all select-all cursor-text overflow-x-auto">
                {generatedApiKey}
              </div>
            </div>
            <CopyButton value={generatedApiKey} ariaLabel="Copy API key" />
          </div>
        </div>

        <div class="space-y-2">
          <Label>DSN <span class="text-muted-foreground font-normal text-xs">(for @logtide/core SDK)</span></Label>
          <div class="flex gap-2 items-start">
            <div class="flex-1 min-w-0">
              <div class="font-mono text-xs bg-muted border border-input rounded-md px-3 py-2 break-all select-all cursor-text overflow-x-auto">
                {dsn}
              </div>
            </div>
            <CopyButton value={dsn} ariaLabel="Copy DSN" />
          </div>
        </div>

        <div class="space-y-1 text-sm text-muted-foreground">
          <div>
            Key prefix: <code class="font-mono text-foreground">{generatedKeyPrefix}</code>
          </div>
          <div>
            Key type: <span class="font-medium text-foreground">
              {generatedKeyType === 'write' ? 'Write-only' : 'Full access'}
            </span>
          </div>
        </div>

        <div class="bg-muted p-3 rounded-md space-y-1">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium">Usage example</p>
            <CopyButton value={curlExample} ariaLabel="Copy cURL example" />
          </div>
          <pre class="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all"><code>{curlExample}</code></pre>
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
