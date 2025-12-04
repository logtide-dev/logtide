<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { getApiUrl } from '$lib/config';
  import Rocket from '@lucide/svelte/icons/rocket';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import Copy from '@lucide/svelte/icons/copy';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Terminal from '@lucide/svelte/icons/terminal';
  import { toastStore } from '$lib/stores/toast';

  let selectedTab = $state('curl');
  let apiUrlValue = $state('http://localhost:8080');

  $effect(() => {
    apiUrlValue = getApiUrl();
  });

  let codeExamples: Record<string, string> = $derived({
    curl: `curl -X POST ${apiUrlValue}/api/v1/ingest \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
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
  apiKey: 'YOUR_API_KEY',
  service: 'my-app'
});

await logger.info('Hello from LogWard!');`,

    python: `from logward import LogWard

logger = LogWard(
    api_key="YOUR_API_KEY",
    service="my-app"
)

logger.info("Hello from LogWard!")`,

    otel: `// OpenTelemetry (Node.js)
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

const exporter = new OTLPLogExporter({
  url: '${apiUrlValue}/api/v1/otlp/logs',
  headers: { 'X-API-Key': 'YOUR_API_KEY' }
});`
  });

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toastStore.success('Code copied!');
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  }

  const quickActions = [
    {
      icon: FolderKanban,
      title: 'Create a Project',
      description: 'Set up a project to organize your logs',
      href: '/projects',
      color: 'bg-blue-500/10 text-blue-500'
    },
    {
      icon: Key,
      title: 'Generate API Key',
      description: 'Get credentials to send logs',
      href: '/projects',
      color: 'bg-green-500/10 text-green-500'
    },
    {
      icon: Book,
      title: 'Read the Docs',
      description: 'Learn how to integrate LogWard',
      href: '/docs/getting-started',
      color: 'bg-purple-500/10 text-purple-500'
    }
  ];
</script>

<div class="space-y-6">
  <!-- Welcome Hero -->
  <Card class="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
    <CardContent class="pt-6">
      <div class="flex flex-col md:flex-row items-center gap-6">
        <div class="w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center flex-shrink-0">
          <Rocket class="w-10 h-10 text-primary" />
        </div>
        <div class="text-center md:text-left flex-1">
          <h2 class="text-2xl font-bold mb-2">Welcome to LogWard!</h2>
          <p class="text-muted-foreground max-w-lg">
            Your dashboard is ready. Start sending logs to see real-time stats, charts, and insights about your applications.
          </p>
        </div>
        <div class="flex gap-2">
          <Button href="/docs/getting-started" variant="outline" class="gap-2">
            <Book class="w-4 h-4" />
            View Docs
          </Button>
          <Button href="/projects" class="gap-2">
            Get Started
            <ChevronRight class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>

  <!-- Quick Actions -->
  <div class="grid gap-4 md:grid-cols-3">
    {#each quickActions as action}
      <a href={action.href} class="block">
        <Card class="h-full hover:border-primary/50 transition-all cursor-pointer">
          <CardContent class="pt-6">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 {action.color}">
                <action.icon class="w-5 h-5" />
              </div>
              <div>
                <h3 class="font-medium">{action.title}</h3>
                <p class="text-sm text-muted-foreground">{action.description}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </a>
    {/each}
  </div>

  <!-- Code Examples -->
  <Card>
    <CardHeader>
      <div class="flex items-center gap-2">
        <Terminal class="w-5 h-5 text-muted-foreground" />
        <CardTitle class="text-lg">Send Your First Log</CardTitle>
      </div>
      <CardDescription>
        Copy one of these examples to start sending logs. Replace <code class="bg-muted px-1 rounded">YOUR_API_KEY</code> with your actual API key.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Tabs.Root bind:value={selectedTab}>
        <Tabs.List class="grid grid-cols-4 mb-4">
          <Tabs.Trigger value="curl">cURL</Tabs.Trigger>
          <Tabs.Trigger value="nodejs">Node.js</Tabs.Trigger>
          <Tabs.Trigger value="python">Python</Tabs.Trigger>
          <Tabs.Trigger value="otel">OpenTelemetry</Tabs.Trigger>
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

  <!-- What happens next -->
  <Card class="bg-muted/30">
    <CardContent class="pt-6">
      <h3 class="font-medium mb-3">Once you start sending logs, you'll see:</h3>
      <ul class="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
          Real-time log volume and trends
        </li>
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
          Error rates and recent errors
        </li>
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
          Active services reporting logs
        </li>
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-purple-500 rounded-full"></span>
          Throughput metrics
        </li>
      </ul>
    </CardContent>
  </Card>
</div>
