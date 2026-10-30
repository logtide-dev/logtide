<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import { ConnectSnippets } from '$lib/components/connect';
  import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import Network from '@lucide/svelte/icons/network';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Gauge from '@lucide/svelte/icons/gauge';
  import Activity from '@lucide/svelte/icons/activity';
  import TrendingUp from '@lucide/svelte/icons/trending-up';
</script>

<div class="space-y-6 py-8">
  <!-- Empty State Hero -->
  <div class="text-center">
    <div class="w-20 h-20 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
      <BarChart3 class="w-10 h-10 text-primary" />
    </div>
    <h2 class="text-2xl font-bold mb-2">No metrics yet</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Send OTLP metrics from your application to explore counters, gauges and histograms here.
    </p>
  </div>

  <!-- Quick Actions -->
  <div class="grid gap-4 md:grid-cols-3 max-w-3xl mx-auto">
    <a href="/dashboard/projects" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Key class="w-8 h-8 mx-auto text-primary mb-2" />
          <h3 class="font-medium">Get API key</h3>
          <p class="text-sm text-muted-foreground">Generate credentials</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://logtide.dev/docs/opentelemetry" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Book class="w-8 h-8 mx-auto text-primary mb-2" />
          <h3 class="font-medium">OTLP docs</h3>
          <p class="text-sm text-muted-foreground">Setup guide</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://opentelemetry.io/docs/" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Network class="w-8 h-8 mx-auto text-primary mb-2" />
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
        <CardTitle class="text-lg">Send metrics with OpenTelemetry</CardTitle>
      </div>
      <CardDescription>
        Configure your application to export OTLP metrics to LogTide
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ConnectSnippets apiKey={null} platform="otlp" service="my-service" />
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
            <Gauge class="w-4 h-4 text-primary" />
            Track golden signals at a glance
          </li>
          <li class="flex items-center gap-2">
            <Activity class="w-4 h-4 text-primary" />
            Visualize time series over any range
          </li>
          <li class="flex items-center gap-2">
            <TrendingUp class="w-4 h-4 text-primary" />
            Spot trends and anomalies early
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</div>
