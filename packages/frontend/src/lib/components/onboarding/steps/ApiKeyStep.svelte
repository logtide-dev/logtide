<script lang="ts">
  import { onboardingStore } from '$lib/stores/onboarding';
  import { authStore } from '$lib/stores/auth';
  import { ApiKeysAPI } from '$lib/api/api-keys';
  import { toastStore } from '$lib/stores/toast';
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import Spinner from '$lib/components/Spinner.svelte';
  import { fly } from 'svelte/transition';
  import Key from '@lucide/svelte/icons/key';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import { getApiUrl } from '$lib/config';
  import { onMount } from 'svelte';

  let isLoading = $state(false);
  let apiUrlValue = $state('http://localhost:8080');

  onMount(() => {
    apiUrlValue = getApiUrl();
  });
  let apiKey = $state<string | null>(null);
  let copied = $state(false);
  let selectedTab = $state('curl');
  let token = $state<string | null>(null);
  let apiKeysAPI = $derived(new ApiKeysAPI(() => token));

  authStore.subscribe((state) => {
    token = state.token;
  });

  let onboardingState = $state<{ projectId: string | null }>({ projectId: null });
  onboardingStore.subscribe((state) => {
    onboardingState = { projectId: state.projectId };
  });

  async function generateApiKey() {
    if (!onboardingState.projectId) {
      toastStore.error('No project selected');
      return;
    }

    isLoading = true;

    try {
      const response = await apiKeysAPI.create(onboardingState.projectId, {
        name: 'Onboarding API Key'
      });

      apiKey = response.apiKey;
      onboardingStore.setApiKey(response.apiKey);
      toastStore.success('API key generated!');
    } catch (error: any) {
      console.error('Failed to create API key:', error);
      toastStore.error(error.message || 'Failed to create API key');
    } finally {
      isLoading = false;
    }
  }

  async function copyApiKey() {
    if (!apiKey) return;

    try {
      await navigator.clipboard.writeText(apiKey);
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toastStore.success('Code copied!');
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  function handleContinue() {
    onboardingStore.completeStep('api-key');
  }

  let codeExamples = $derived({
    curl: `curl -X POST ${apiUrlValue}/api/v1/ingest \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}" \\
  -d '{
    "logs": [{
      "time": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
      "level": "info",
      "service": "my-app",
      "message": "Hello from LogWard!"
    }]
  }'`,

    nodejs: `import { LogWard } from '@logward/sdk';

const logger = new LogWard({
  apiKey: '${apiKey || 'YOUR_API_KEY'}',
  service: 'my-app'
});

// Send your first log!
await logger.info('Hello from LogWard!');`,

    python: `from logward import LogWard

logger = LogWard(
    api_key="${apiKey || 'YOUR_API_KEY'}",
    service="my-app"
)

# Send your first log!
logger.info("Hello from LogWard!")`,

    docker: `# docker-compose.yml
services:
  fluent-bit:
    image: fluent/fluent-bit:4.2.2  # For ARM64: cr.fluentbit.io/fluent/fluent-bit:4.2.2
    volumes:
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf
      - /var/log:/var/log:ro
    environment:
      - LOGWARD_API_KEY=${apiKey || 'YOUR_API_KEY'}

# fluent-bit.conf
[OUTPUT]
    Name  http
    Match *
    Host  ${apiUrlValue.replace('https://', '').replace('http://', '')}
    Port  443
    URI   /api/v1/ingest
    Format json
    Header X-API-Key \${LOGWARD_API_KEY}
    Header Content-Type application/json
    tls On`,

    otel: `// Node.js with OpenTelemetry
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';

const logExporter = new OTLPLogExporter({
  url: '${apiUrlValue}/api/v1/otlp/logs',
  headers: {
    'X-API-Key': '${apiKey || 'YOUR_API_KEY'}'
  }
});

const loggerProvider = new LoggerProvider({
  resource: new Resource({ 'service.name': 'my-app' })
});
loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(logExporter));

const logger = loggerProvider.getLogger('my-logger');
logger.emit({ body: 'Hello from OpenTelemetry!' });

# -------------------------------------------
# Python with OpenTelemetry
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import SimpleLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

exporter = OTLPLogExporter(
    endpoint="${apiUrlValue}/api/v1/otlp/logs",
    headers={"X-API-Key": "${apiKey || 'YOUR_API_KEY'}"}
)

logger_provider = LoggerProvider()
logger_provider.add_log_record_processor(SimpleLogRecordProcessor(exporter))

import logging
handler = LoggingHandler(logger_provider=logger_provider)
logging.getLogger().addHandler(handler)
logging.info("Hello from OpenTelemetry!")`
  });
</script>

<div class="space-y-6" in:fly={{ y: 20, duration: 400 }}>
  <div class="text-center space-y-2">
    <div class="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center">
      <Key class="w-8 h-8 text-primary" />
    </div>
    <h2 class="text-2xl font-bold">Generate Your API Key</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      API keys authenticate your applications to send logs. Keep them secure and never share them publicly.
    </p>
  </div>

  {#if !apiKey}
    <Card>
      <CardContent class="pt-6">
        <div class="text-center space-y-4">
          <p class="text-sm text-muted-foreground">
            Click the button below to generate your first API key
          </p>
          <Button onclick={generateApiKey} disabled={isLoading} class="gap-2">
            {#if isLoading}
              <Spinner size="sm" />
              Generating...
            {:else}
              <Key class="w-4 h-4" />
              Generate API Key
            {/if}
          </Button>
        </div>
      </CardContent>
    </Card>
  {:else}
    <!-- API Key Display -->
    <Card class="border-amber-500/50 bg-amber-500/5">
      <CardContent class="pt-4">
        <div class="flex items-start gap-2 mb-3">
          <AlertTriangle class="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p class="text-sm text-amber-600 dark:text-amber-400">
            <strong>Save this key now!</strong> You won't be able to see it again.
          </p>
        </div>
        <div class="flex gap-2">
          <div class="flex-1 min-w-0">
            <div class="font-mono text-sm bg-background border rounded-md px-3 py-2 break-all select-all">
              {apiKey}
            </div>
          </div>
          <Button variant="outline" onclick={copyApiKey} class="gap-2 shrink-0">
            {#if copied}
              <Check class="w-4 h-4" />
              Copied
            {:else}
              <Copy class="w-4 h-4" />
              Copy
            {/if}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Code Examples -->
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">Send Your First Log</CardTitle>
        <CardDescription>Choose your preferred method to send a test log</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs.Root bind:value={selectedTab}>
          <Tabs.List class="grid grid-cols-5 mb-4">
            <Tabs.Trigger value="curl">cURL</Tabs.Trigger>
            <Tabs.Trigger value="nodejs">Node.js</Tabs.Trigger>
            <Tabs.Trigger value="python">Python</Tabs.Trigger>
            <Tabs.Trigger value="otel">OpenTelemetry</Tabs.Trigger>
            <Tabs.Trigger value="docker">Docker</Tabs.Trigger>
          </Tabs.List>

          {#each Object.entries(codeExamples) as [key, code]}
            <Tabs.Content value={key}>
              <div class="relative">
                <pre class="bg-muted rounded-lg p-4 overflow-x-auto text-sm"><code>{code}</code></pre>
                <Button
                  variant="ghost"
                  size="sm"
                  class="absolute top-2 right-2"
                  onclick={() => copyCode(code)}
                >
                  <Copy class="w-4 h-4" />
                </Button>
              </div>
            </Tabs.Content>
          {/each}
        </Tabs.Root>
      </CardContent>
    </Card>

    <Button onclick={handleContinue} class="w-full gap-2">
      I've Saved My API Key
      <ChevronRight class="w-4 h-4" />
    </Button>
  {/if}
</div>
