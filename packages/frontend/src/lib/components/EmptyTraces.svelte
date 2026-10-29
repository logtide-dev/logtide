<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import { ConnectSnippets } from '$lib/components/connect';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import Network from '@lucide/svelte/icons/network';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Timer from '@lucide/svelte/icons/timer';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
</script>

<div class="space-y-6 py-8">
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
      <ConnectSnippets apiKey={null} platform="otlp" />
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
