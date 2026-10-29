<script lang="ts">
  import { onMount } from 'svelte';
  import confetti from 'canvas-confetti';
  import { onboardingStore } from '$lib/stores/onboarding';
  import { apiKeysAPI } from '$lib/api/api-keys';
  import type { FirstSignal } from '$lib/api/first-signal';
  import ConnectSnippets from '$lib/components/connect/ConnectSnippets.svelte';
  import FirstSignalWaiter from '$lib/components/connect/FirstSignalWaiter.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Alert, AlertDescription } from '$lib/components/ui/alert';
  import Spinner from '$lib/components/Spinner.svelte';
  import Plug from '@lucide/svelte/icons/plug';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  const KEY_NAME = 'Onboarding key';

  const projectId = $derived($onboardingStore.projectId);
  const apiKey = $derived($onboardingStore.apiKey);
  const service = $derived(
    ($onboardingStore.projectName ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-app'
  );

  let loadingKeys = $state(true);
  let hasExistingKeys = $state(false);
  let creating = $state(false);
  let keyError = $state('');
  let detected = $state(false);
  let started = false;

  onMount(() => {
    void init();
  });

  async function init() {
    // The effect-free guard keeps a double mount from creating two keys.
    if (started) return;
    started = true;

    const id = projectId;
    if (!id) {
      await onboardingStore.goToStep('workspace');
      return;
    }

    try {
      const { apiKeys } = await apiKeysAPI.list(id);
      const active = apiKeys.filter((k) => !k.revoked);
      hasExistingKeys = active.length > 0;
      loadingKeys = false;
      if (active.length === 0 && !apiKey) {
        await createKey();
      }
    } catch (e) {
      loadingKeys = false;
      keyError = e instanceof Error ? e.message : 'Could not load the API keys';
    }
  }

  async function createKey() {
    const id = projectId;
    if (!id || creating) return;
    creating = true;
    keyError = '';
    try {
      const response = await apiKeysAPI.create(id, { name: KEY_NAME, type: 'write' });
      onboardingStore.setApiKey(response.apiKey);
    } catch (e) {
      keyError = e instanceof Error ? e.message : 'Could not create the API key';
    } finally {
      creating = false;
    }
  }

  function celebrate() {
    try {
      confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, zIndex: 10001 });
    } catch {
      // purely cosmetic
    }
  }

  function handleDetected(_signal: FirstSignal) {
    detected = true;
    celebrate();
  }

  function next() {
    void onboardingStore.goToStep('done');
  }
</script>

<div class="space-y-6">
  <div class="space-y-2 text-center">
    <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
      <Plug class="h-8 w-8 text-primary-text" aria-hidden="true" />
    </div>
    <h2 class="text-2xl font-bold">Connect your first app</h2>
    <p class="mx-auto max-w-md text-muted-foreground">
      Pick your platform, paste the snippet, and send a first log, trace or metric.
    </p>
  </div>

  {#if keyError}
    <Alert variant="destructive">
      <TriangleAlert class="h-4 w-4" aria-hidden="true" />
      <AlertDescription>
        <p>{keyError}</p>
        {#if projectId}
          <p class="mt-1">
            You can skip this step and create a key later in
            <a
              href="/dashboard/projects/{projectId}/settings#api-keys"
              class="underline"
              data-sveltekit-reload>project settings</a
            >.
          </p>
        {/if}
      </AlertDescription>
    </Alert>
  {/if}

  {#if loadingKeys || creating}
    <div class="flex justify-center py-4"><Spinner size="md" /></div>
  {:else if apiKey}
    <div class="space-y-2 rounded-lg border bg-card p-4">
      <p class="text-sm font-medium">Your API key</p>
      <div class="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
        <code class="flex-1 break-all text-xs" data-testid="api-key-value">{apiKey}</code>
        <CopyButton value={apiKey} label="Copy key" />
      </div>
      <p class="text-xs text-muted-foreground">
        This key is shown once. Copy it now: after you leave this page it cannot be displayed again.
      </p>
    </div>
  {:else if hasExistingKeys}
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
      <p class="text-sm text-muted-foreground">
        This project already has API keys. Existing keys cannot be shown again.
      </p>
      <Button variant="outline" onclick={createKey}>Create a new key</Button>
    </div>
  {/if}

  <ConnectSnippets {apiKey} {service} />

  {#if projectId}
    <FirstSignalWaiter {projectId} onDetected={handleDetected} onSkip={next} />
  {/if}

  <div class="flex justify-end">
    <Button onclick={next} disabled={!detected}>Continue</Button>
  </div>
</div>
