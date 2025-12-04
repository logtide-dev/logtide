<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { onboardingStore } from '$lib/stores/onboarding';
  import { authStore } from '$lib/stores/auth';
  import { LogsAPI } from '$lib/api/logs';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import Spinner from '$lib/components/Spinner.svelte';
  import { fly, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import Radio from '@lucide/svelte/icons/radio';
  import CheckCircle from '@lucide/svelte/icons/check-circle-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import PartyPopper from '@lucide/svelte/icons/party-popper';
  import confetti from 'canvas-confetti';
  import { getApiUrl } from '$lib/config';

  let isPolling = $state(true);
  let apiUrlValue = $state('http://localhost:8080');

  $effect(() => {
    apiUrlValue = getApiUrl();
  });
  let logReceived = $state(false);
  let receivedLog = $state<any>(null);
  let pollCount = $state(0);
  let token = $state<string | null>(null);
  let logsAPI = $derived(new LogsAPI(() => token));

  authStore.subscribe((state) => {
    token = state.token;
  });

  let onboardingState = $state<{ projectId: string | null; apiKey: string | null }>({
    projectId: null,
    apiKey: null
  });
  onboardingStore.subscribe((state) => {
    onboardingState = {
      projectId: state.projectId,
      apiKey: state.apiKey
    };
  });

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function checkForLogs() {
    if (!onboardingState.projectId) return;

    try {
      pollCount++;
      const response = await logsAPI.getLogs({
        projectId: onboardingState.projectId,
        limit: 1
      });

      if (response.logs && response.logs.length > 0) {
        logReceived = true;
        receivedLog = response.logs[0];
        isPolling = false;
        onboardingStore.markFirstLogReceived();

        // Stop polling
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }

        // Celebrate!
        triggerConfetti();
      }
    } catch (error) {
      console.error('Error checking for logs:', error);
    }
  }

  function triggerConfetti() {
    // Multiple bursts for a better effect
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      zIndex: 10001
    };

    function fire(particleRatio: number, opts: confetti.Options) {
      confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio)
      });
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55,
    });
    fire(0.2, {
      spread: 60,
    });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 45,
    });
  }

  function startPolling() {
    isPolling = true;
    pollCount = 0;
    checkForLogs();
    pollInterval = setInterval(checkForLogs, 2000);
  }

  function handleContinue() {
    onboardingStore.completeStep('first-log');
  }

  function handleSkipWaiting() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isPolling = false;
    onboardingStore.completeStep('first-log');
  }

  onMount(() => {
    startPolling();
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });
</script>

<div class="space-y-6" in:fly={{ y: 20, duration: 400 }}>
  <div class="text-center space-y-2">
    <div
      class="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center transition-colors duration-500
        {logReceived ? 'bg-green-500/20' : 'bg-primary/10'}"
    >
      {#if logReceived}
        <span in:scale={{ duration: 300 }}>
          <PartyPopper class="w-8 h-8 text-green-500" />
        </span>
      {:else}
        <Radio class="w-8 h-8 text-primary animate-pulse" />
      {/if}
    </div>
    <h2 class="text-2xl font-bold">
      {logReceived ? 'First Log Received!' : 'Waiting for Your First Log'}
    </h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      {#if logReceived}
        Congratulations! Your application is now sending logs to LogWard.
      {:else}
        Use the code from the previous step to send a test log. We'll detect it automatically.
      {/if}
    </p>
  </div>

  {#if !logReceived}
    <!-- Waiting state -->
    <Card>
      <CardContent class="pt-6">
        <div class="text-center space-y-4">
          <div class="flex items-center justify-center gap-2">
            <Spinner size="sm" />
            <span class="text-sm text-muted-foreground">
              Listening for logs... (checked {pollCount} times)
            </span>
          </div>

          <div class="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p class="font-medium mb-2">Quick test with cURL:</p>
            <pre class="bg-background rounded p-2 overflow-x-auto text-xs"><code>curl -X POST {apiUrlValue}/api/v1/ingest \
  -H "X-API-Key: {onboardingState.apiKey || 'YOUR_API_KEY'}" \
  -H "Content-Type: application/json" \
  -d '{`{"logs":[{"level":"info","service":"test","message":"Hello!","time":"${new Date().toISOString()}"}]}`}'</code></pre>
          </div>

          <div class="flex flex-col sm:flex-row gap-2 justify-center">
            <Button variant="outline" onclick={startPolling} disabled={isPolling} class="gap-2">
              <RefreshCw class="w-4 h-4" />
              Refresh
            </Button>
            <Button variant="ghost" onclick={handleSkipWaiting} class="text-muted-foreground">
              Skip for now
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  {:else}
    <!-- Success state -->
    <Card class="border-green-500/50 bg-green-500/5">
      <CardHeader>
        <div class="flex items-center gap-2">
          <CheckCircle class="w-5 h-5 text-green-500" />
          <CardTitle class="text-lg text-green-600 dark:text-green-400">Log Received!</CardTitle>
        </div>
        <CardDescription>Here's the log we received from your application</CardDescription>
      </CardHeader>
      <CardContent>
        {#if receivedLog}
          <div class="bg-background rounded-lg p-4 space-y-2 text-sm font-mono">
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground">Time:</span>
              <span>{new Date(receivedLog.time).toLocaleString()}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground">Level:</span>
              <span class="px-2 py-0.5 rounded text-xs font-medium
                {receivedLog.level === 'error' ? 'bg-red-500/20 text-red-600' :
                 receivedLog.level === 'warn' ? 'bg-yellow-500/20 text-yellow-600' :
                 'bg-blue-500/20 text-blue-600'}">
                {receivedLog.level}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground">Service:</span>
              <span>{receivedLog.service}</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-muted-foreground">Message:</span>
              <span class="break-all">{receivedLog.message}</span>
            </div>
          </div>
        {/if}
      </CardContent>
    </Card>

    <Button onclick={handleContinue} class="w-full gap-2">
      Continue to Feature Tour
      <ChevronRight class="w-4 h-4" />
    </Button>
  {/if}
</div>
