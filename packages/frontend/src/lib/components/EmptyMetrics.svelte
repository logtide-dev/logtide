<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { getApiUrl } from '$lib/config';
  import { toastStore } from '$lib/stores/toast';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import Network from '@lucide/svelte/icons/network';
  import Copy from '@lucide/svelte/icons/copy';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Activity from '@lucide/svelte/icons/activity';
  import TrendingUp from '@lucide/svelte/icons/trending-up';

  let selectedTab = $state('nodejs');
  let apiUrlValue = $state('http://localhost:8080');

  $effect(() => {
    apiUrlValue = getApiUrl();
  });

  let codeExamples: Record<string, string> = $derived({
    nodejs: `// Node.js with OpenTelemetry Metrics
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

const reader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: '${apiUrlValue}/v1/otlp/metrics',
    headers: { 'X-API-Key': 'YOUR_API_KEY' }
  })
});

const meterProvider = new MeterProvider({ readers: [reader] });
const meter = meterProvider.getMeter('my-service');

const counter = meter.createCounter('requests_total');
counter.add(1, { route: '/checkout' });`,

    python: `# Python with OpenTelemetry Metrics
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

reader = PeriodicExportingMetricReader(
    OTLPMetricExporter(
        endpoint="${apiUrlValue}/v1/otlp/metrics",
        headers={"X-API-Key": "YOUR_API_KEY"},
    )
)
metrics.set_meter_provider(MeterProvider(metric_readers=[reader]))

meter = metrics.get_meter("my-service")
counter = meter.create_counter("requests_total")
counter.add(1, {"route": "/checkout"})`,

    go: `// Go with OpenTelemetry Metrics
import (
    "context"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/sdk/metric"
)

exporter, _ := otlpmetrichttp.New(context.Background(),
    otlpmetrichttp.WithEndpoint("${apiUrlValue.replace('https://', '').replace('http://', '')}"),
    otlpmetrichttp.WithURLPath("/v1/otlp/metrics"),
    otlpmetrichttp.WithInsecure(), // remove for HTTPS
    otlpmetrichttp.WithHeaders(map[string]string{
        "X-API-Key": "YOUR_API_KEY",
    }),
)

provider := metric.NewMeterProvider(
    metric.WithReader(metric.NewPeriodicReader(exporter)),
)
otel.SetMeterProvider(provider)`
  });

  async function copyCode(code: string) {
    const success = await copyToClipboard(code);
    if (success) {
      toastStore.success('Code copied!');
    } else {
      toastStore.error('Could not copy. Please select and copy manually.');
    }
  }
</script>

<div class="space-y-6 py-8">
  <!-- Empty State Hero -->
  <div class="text-center">
    <div class="w-20 h-20 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
      <BarChart3 class="w-10 h-10 text-primary" />
    </div>
    <h2 class="text-2xl font-bold mb-2">No Metrics Yet</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Send OTLP metrics from your application to explore counters, gauges and histograms here.
    </p>
  </div>

  <!-- Quick Actions -->
  <div class="grid gap-4 md:grid-cols-3 max-w-3xl mx-auto">
    <a href="/dashboard/projects" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Key class="w-8 h-8 mx-auto text-green-500 mb-2" />
          <h3 class="font-medium">Get API Key</h3>
          <p class="text-sm text-muted-foreground">Generate credentials</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://logtide.dev/docs/opentelemetry" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Book class="w-8 h-8 mx-auto text-purple-500 mb-2" />
          <h3 class="font-medium">OTLP Docs</h3>
          <p class="text-sm text-muted-foreground">Setup guide</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://opentelemetry.io/docs/" target="_blank" rel="noopener noreferrer" class="block">
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
        <CardTitle class="text-lg">Send Metrics with OpenTelemetry</CardTitle>
      </div>
      <CardDescription>
        Configure your application to export OTLP metrics to LogTide
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
        <h3 class="font-medium mb-3">Once metrics arrive, you can:</h3>
        <ul class="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
          <li class="flex items-center gap-2">
            <BarChart3 class="w-4 h-4 text-primary" />
            Explore metrics by name and service
          </li>
          <li class="flex items-center gap-2">
            <Gauge class="w-4 h-4 text-blue-500" />
            Track golden signals at a glance
          </li>
          <li class="flex items-center gap-2">
            <Activity class="w-4 h-4 text-green-500" />
            Visualize time series over any range
          </li>
          <li class="flex items-center gap-2">
            <TrendingUp class="w-4 h-4 text-red-500" />
            Spot trends and anomalies early
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</div>
