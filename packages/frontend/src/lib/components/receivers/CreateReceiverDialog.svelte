<script lang="ts">
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import * as Alert from '$lib/components/ui/alert';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { getApiUrl } from '$lib/config';
  import type { CreateReceiverResponse, ReceiverAdapterType, ReceiverFieldMapping } from '$lib/api/receivers';

  interface Props {
    onSubmit: (data: {
      name: string;
      adapterType: ReceiverAdapterType;
      fieldMapping?: ReceiverFieldMapping | null;
    }) => Promise<CreateReceiverResponse>;
    open?: boolean;
  }

  let { onSubmit, open = $bindable(false) }: Props = $props();

  const ADAPTER_OPTIONS: { value: ReceiverAdapterType; label: string; description: string }[] = [
    {
      value: 'github',
      label: 'GitHub',
      description: 'Workflow runs and deployment status events from GitHub webhooks.'
    },
    {
      value: 'uptime',
      label: 'Uptime',
      description: 'Downtime and recovery alerts from Uptime Robot or Better Stack.'
    },
    {
      value: 'generic',
      label: 'Generic JSON',
      description: 'Any JSON payload, with optional field mapping to log fields.'
    }
  ];

  let name = $state('');
  let adapterType = $state<ReceiverAdapterType>('generic');
  let mapMessage = $state('');
  let mapLevel = $state('');
  let mapService = $state('');
  let mapTimestamp = $state('');
  let submitting = $state(false);
  let error = $state('');
  let created = $state<CreateReceiverResponse | null>(null);
  let copied = $state(false);
  let apiUrlValue = $state('http://localhost:8080');

  $effect(() => {
    apiUrlValue = getApiUrl() || window.location.origin;
  });

  let ingestUrl = $derived(created ? `${apiUrlValue}${created.ingestPath}` : '');

  function buildFieldMapping(): ReceiverFieldMapping | null {
    if (adapterType !== 'generic') return null;
    const mapping: ReceiverFieldMapping = {};
    if (mapMessage.trim()) mapping.message = mapMessage.trim();
    if (mapLevel.trim()) mapping.level = mapLevel.trim();
    if (mapService.trim()) mapping.service = mapService.trim();
    if (mapTimestamp.trim()) mapping.timestamp = mapTimestamp.trim();
    return Object.keys(mapping).length > 0 ? mapping : null;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = '';

    submitting = true;
    try {
      created = await onSubmit({
        name: name.trim(),
        adapterType,
        fieldMapping: buildFieldMapping()
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create receiver';
    } finally {
      submitting = false;
    }
  }

  async function handleCopy() {
    if (!ingestUrl) return;

    const success = await copyToClipboard(ingestUrl);

    if (success) {
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } else {
      error = 'Could not copy to clipboard. Please select the URL and copy manually (Ctrl+C / Cmd+C).';
    }
  }

  function reset() {
    name = '';
    adapterType = 'generic';
    mapMessage = '';
    mapLevel = '';
    mapService = '';
    mapTimestamp = '';
    error = '';
    created = null;
    copied = false;
  }

  function handleClose() {
    reset();
    open = false;
  }

  $effect(() => {
    if (!open) {
      reset();
    }
  });
</script>

<Dialog bind:open>
  <DialogContent class="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
    {#if !created}
      <DialogHeader>
        <DialogTitle>Create Webhook Receiver</DialogTitle>
        <DialogDescription>
          Receive events from an external system and store them as log entries in this project.
        </DialogDescription>
      </DialogHeader>

      <form onsubmit={handleSubmit} class="space-y-4 py-4">
        <div class="space-y-2">
          <Label for="receiver-name">Receiver Name</Label>
          <Input
            id="receiver-name"
            type="text"
            placeholder="GitHub Actions - my-repo"
            bind:value={name}
            disabled={submitting}
            required
            autofocus
          />
          <p class="text-xs text-muted-foreground">
            Used as the default service name for generic events.
          </p>
        </div>

        <div class="space-y-2">
          <Label>Source Type</Label>
          <div class="grid grid-cols-3 gap-3">
            {#each ADAPTER_OPTIONS as option (option.value)}
              <button
                type="button"
                class="rounded-md border p-3 text-left transition-colors {adapterType === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:border-primary/50'}"
                onclick={() => (adapterType = option.value)}
              >
                <div class="font-medium text-sm">{option.label}</div>
                <div class="text-xs text-muted-foreground mt-1">{option.description}</div>
              </button>
            {/each}
          </div>
        </div>

        {#if adapterType === 'generic'}
          <div class="space-y-2">
            <Label>
              Field Mapping
              <span class="text-muted-foreground font-normal">(optional, dot paths into the payload)</span>
            </Label>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <Label for="map-message" class="text-xs font-normal text-muted-foreground">Message path</Label>
                <Input id="map-message" type="text" placeholder="error.message" bind:value={mapMessage} disabled={submitting} />
              </div>
              <div class="space-y-1">
                <Label for="map-level" class="text-xs font-normal text-muted-foreground">Level path</Label>
                <Input id="map-level" type="text" placeholder="severity" bind:value={mapLevel} disabled={submitting} />
              </div>
              <div class="space-y-1">
                <Label for="map-service" class="text-xs font-normal text-muted-foreground">Service path</Label>
                <Input id="map-service" type="text" placeholder="source.app" bind:value={mapService} disabled={submitting} />
              </div>
              <div class="space-y-1">
                <Label for="map-timestamp" class="text-xs font-normal text-muted-foreground">Timestamp path</Label>
                <Input id="map-timestamp" type="text" placeholder="ts" bind:value={mapTimestamp} disabled={submitting} />
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              Unmapped fields fall back to sensible defaults; the full payload is always kept in metadata.
            </p>
          </div>
        {/if}

        {#if error}
          <div class="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
            {error}
          </div>
        {/if}

        <DialogFooter>
          <Button type="button" variant="outline" onclick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !name.trim()} class="gap-2">
            {#if submitting}
              <Spinner size="sm" />
              Creating...
            {:else}
              <Plus class="w-4 h-4" />
              Create Receiver
            {/if}
          </Button>
        </DialogFooter>
      </form>
    {:else}
      <DialogHeader>
        <DialogTitle>Receiver Created</DialogTitle>
        <DialogDescription>Point the external system at this URL to start receiving events.</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <Alert.Root variant="destructive">
          <Alert.Title>Important: Save this URL now</Alert.Title>
          <Alert.Description>
            The URL contains the receiver token and is the only credential the external system needs.
            This is the only time it will be shown. If you lose it, delete the receiver and create a new one.
          </Alert.Description>
        </Alert.Root>

        <div class="space-y-2">
          <Label>Webhook URL</Label>
          <div class="flex gap-2 items-start">
            <div class="flex-1 min-w-0">
              <div class="font-mono text-xs bg-muted border border-input rounded-md px-3 py-2 break-all select-all cursor-text overflow-x-auto">
                {ingestUrl}
              </div>
            </div>
            <Button variant="outline" onclick={handleCopy} class="gap-2 shrink-0">
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
          <pre class="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all"><code>curl -X POST {ingestUrl} \
  -H "Content-Type: application/json" \
  -d '{`{"message": "deploy finished"}`}'</code></pre>
        </div>
      </div>

      <DialogFooter>
        <Button onclick={handleClose} class="gap-2">Done</Button>
      </DialogFooter>
    {/if}
  </DialogContent>
</Dialog>
