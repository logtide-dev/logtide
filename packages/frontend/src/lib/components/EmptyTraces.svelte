<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { getApiUrl } from '$lib/config';
  import { toastStore } from '$lib/stores/toast';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import Network from '@lucide/svelte/icons/network';
  import Copy from '@lucide/svelte/icons/copy';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Timer from '@lucide/svelte/icons/timer';
  import Layers from '@lucide/svelte/icons/layers';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';

  let selectedTab = $state('nodejs');
  let apiUrlValue = $state('http://localhost:8080');

  $effect(() => {
    apiUrlValue = getApiUrl();
  });

  let codeExamples: Record<string, string> = $derived({
    nodejs: `// Node.js with OpenTelemetry
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: '${apiUrlValue}/api/v1/otlp/traces',
    headers: { 'X-API-Key': 'YOUR_API_KEY' }
  }),
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();`,

    python: `# Python with OpenTelemetry
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
exporter = OTLPSpanExporter(
    endpoint="${apiUrlValue}/api/v1/otlp/traces",
    headers={"X-API-Key": "YOUR_API_KEY"}
)
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("my-service")
with tracer.start_as_current_span("my-operation"):
    # Your code here
    pass`,

    go: `// Go with OpenTelemetry
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/trace"
)

exporter, _ := otlptracehttp.New(ctx,
    otlptracehttp.WithEndpoint("${apiUrlValue.replace('https://', '').replace('http://', '')}"),
    otlptracehttp.WithURLPath("/api/v1/otlp/traces"),
    otlptracehttp.WithHeaders(map[string]string{
        "X-API-Key": "YOUR_API_KEY",
    }),
)

tp := trace.NewTracerProvider(
    trace.WithBatcher(exporter),
)
otel.SetTracerProvider(tp)`
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toastStore.success('Code copied!');
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }
</script>

<div class="space-y-6 py-8">
  <!-- Empty State Hero -->
  <div class="text-center">
    <div class="w-20 h-20 mx-auto bg-cyan-500/10 rounded-2xl flex items-center justify-center mb-4">
      <GitBranch class="w-10 h-10 text-cyan-500" />
    </div>
    <h2 class="text-2xl font-bold mb-2">No Traces Yet</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Send distributed traces using OpenTelemetry to visualize request flows across your services.
    </p>
  </div>

  <!-- Quick Actions -->
  <div class="grid gap-4 md:grid-cols-3 max-w-3xl mx-auto">
    <a href="/projects" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Key class="w-8 h-8 mx-auto text-green-500 mb-2" />
          <h3 class="font-medium">Get API Key</h3>
          <p class="text-sm text-muted-foreground">Generate credentials</p>
        </CardContent>
      </Card>
    </a>
    <a href="/docs/getting-started" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Book class="w-8 h-8 mx-auto text-purple-500 mb-2" />
          <h3 class="font-medium">OTLP Docs</h3>
          <p class="text-sm text-muted-foreground">Setup guide</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://opentelemetry.io/docs/" target="_blank" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Network class="w-8 h-8 mx-auto text-blue-500 mb-2" />
          <h3 class="font-medium">OpenTelemetry</h3>
          <p class="text-sm text-muted-foreground">Official docs</p>
        </CardContent>
      </Card>
    </a>
  </div>

  <!-- Code Examples -->
  <Card class="max-w-3xl mx-auto">
    <CardHeader>
      <div class="flex items-center gap-2">
        <Terminal class="w-5 h-5 text-muted-foreground" />
        <CardTitle class="text-lg">Send Traces with OpenTelemetry</CardTitle>
      </div>
      <CardDescription>
        Configure your application to send traces to LogWard
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Tabs.Root bind:value={selectedTab}>
        <Tabs.List class="grid grid-cols-3 mb-4">
          <Tabs.Trigger value="nodejs">Node.js</Tabs.Trigger>
          <Tabs.Trigger value="python">Python</Tabs.Trigger>
          <Tabs.Trigger value="go">Go</Tabs.Trigger>
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

  <!-- Features Preview -->
  <div class="max-w-3xl mx-auto">
    <Card class="bg-muted/30">
      <CardContent class="pt-6">
        <h3 class="font-medium mb-3">Once traces arrive, you can:</h3>
        <ul class="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
          <li class="flex items-center gap-2">
            <GitBranch class="w-4 h-4 text-cyan-500" />
            View trace timeline and spans
          </li>
          <li class="flex items-center gap-2">
            <Network class="w-4 h-4 text-blue-500" />
            Visualize service dependencies
          </li>
          <li class="flex items-center gap-2">
            <Timer class="w-4 h-4 text-green-500" />
            Analyze latency and performance
          </li>
          <li class="flex items-center gap-2">
            <AlertCircle class="w-4 h-4 text-red-500" />
            Identify errors and bottlenecks
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</div>
