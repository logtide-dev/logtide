<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import * as Tabs from '$lib/components/ui/tabs';
  import { getApiUrl } from '$lib/config';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import Network from '@lucide/svelte/icons/network';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Timer from '@lucide/svelte/icons/timer';
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
    url: '${apiUrlValue}/v1/otlp/traces',
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
    endpoint="${apiUrlValue}/v1/otlp/traces",
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
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/trace"
)

exporter, _ := otlptracehttp.New(context.Background(),
    otlptracehttp.WithEndpoint("${apiUrlValue.replace('https://', '').replace('http://', '')}"),
    otlptracehttp.WithURLPath("/v1/otlp/traces"),
    otlptracehttp.WithInsecure(), // remove for HTTPS
    otlptracehttp.WithHeaders(map[string]string{
        "X-API-Key": "YOUR_API_KEY",
    }),
)

tp := trace.NewTracerProvider(
    trace.WithBatcher(exporter),
)
otel.SetTracerProvider(tp)`
  });
</script>

<div class="space-y-6 py-8">
  <!-- W13 seam: replace snippets with <ConnectSnippets> in Wave D -->
  <EmptyState
    variant="setup"
    icon={GitBranch}
    title="No traces yet"
    description="Send distributed traces using OpenTelemetry to visualize request flows across your services."
  />

  <div class="mx-auto grid max-w-3xl gap-4 md:grid-cols-3">
    <a href="/dashboard/projects" class="block">
      <Card class="h-full cursor-pointer text-center transition-all hover:border-primary/50">
        <CardContent class="pt-6">
          <Key class="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden="true" />
          <h3 class="font-medium">Get an API key</h3>
          <p class="text-sm text-muted-foreground">Generate credentials</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://logtide.dev/docs/opentelemetry" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full cursor-pointer text-center transition-all hover:border-primary/50">
        <CardContent class="pt-6">
          <Book class="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden="true" />
          <h3 class="font-medium">OTLP docs</h3>
          <p class="text-sm text-muted-foreground">Setup guide</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://opentelemetry.io/docs/" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full cursor-pointer text-center transition-all hover:border-primary/50">
        <CardContent class="pt-6">
          <Network class="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden="true" />
          <h3 class="font-medium">OpenTelemetry</h3>
          <p class="text-sm text-muted-foreground">Official docs</p>
        </CardContent>
      </Card>
    </a>
  </div>

  <Card class="mx-auto max-w-3xl">
    <CardHeader>
      <div class="flex items-center gap-2">
        <Terminal class="size-5 text-muted-foreground" aria-hidden="true" />
        <CardTitle class="text-lg">Send traces with OpenTelemetry</CardTitle>
      </div>
      <CardDescription>Configure your application to send traces to LogTide</CardDescription>
    </CardHeader>
    <CardContent>
      <Tabs.Root bind:value={selectedTab}>
        <Tabs.List class="mb-4 grid grid-cols-3">
          <Tabs.Trigger value="nodejs">Node.js</Tabs.Trigger>
          <Tabs.Trigger value="python">Python</Tabs.Trigger>
          <Tabs.Trigger value="go">Go</Tabs.Trigger>
        </Tabs.List>

        {#each Object.entries(codeExamples) as [key, code] (key)}
          <Tabs.Content value={key}>
            <div class="relative">
              <pre class="overflow-x-auto rounded-lg bg-muted p-4 text-sm"><code>{code}</code></pre>
              <div class="absolute right-2 top-2">
                <CopyButton value={code} ariaLabel="Copy code" />
              </div>
            </div>
          </Tabs.Content>
        {/each}
      </Tabs.Root>
    </CardContent>
  </Card>

  <div class="mx-auto max-w-3xl">
    <Card class="bg-muted/30">
      <CardContent class="pt-6">
        <h3 class="mb-3 font-medium">Once traces arrive, you can:</h3>
        <ul class="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li class="flex items-center gap-2">
            <GitBranch class="size-4" aria-hidden="true" />
            View trace timeline and spans
          </li>
          <li class="flex items-center gap-2">
            <Network class="size-4" aria-hidden="true" />
            Visualize service dependencies
          </li>
          <li class="flex items-center gap-2">
            <Timer class="size-4" aria-hidden="true" />
            Analyze latency and performance
          </li>
          <li class="flex items-center gap-2">
            <AlertCircle class="size-4" aria-hidden="true" />
            Identify errors and bottlenecks
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</div>
