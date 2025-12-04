<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import { getApiUrl } from '$lib/config';
  import { toastStore } from '$lib/stores/toast';
  import SearchIcon from '@lucide/svelte/icons/search';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import Copy from '@lucide/svelte/icons/copy';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Radio from '@lucide/svelte/icons/radio';
  import Filter from '@lucide/svelte/icons/filter';

  let selectedTab = $state('curl');
  let apiUrlValue = $state('http://localhost:8080');

  $effect(() => {
    apiUrlValue = getApiUrl();
  });

  let codeExamples: Record<string, string> = $derived({
    curl: `curl -X POST ${apiUrlValue}/v1/ingest \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "logs": [{
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

await logger.info('Hello from LogWard!');
await logger.error('Something went wrong', { userId: 123 });`,

    python: `from logward import LogWard

logger = LogWard(
    api_key="YOUR_API_KEY",
    service="my-app"
)

logger.info("Hello from LogWard!")
logger.error("Something went wrong", metadata={"user_id": 123})`
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
    <div class="w-20 h-20 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
      <SearchIcon class="w-10 h-10 text-primary" />
    </div>
    <h2 class="text-2xl font-bold mb-2">No Logs Yet</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Start sending logs from your applications to search and analyze them here.
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
          <h3 class="font-medium">Read Docs</h3>
          <p class="text-sm text-muted-foreground">Integration guides</p>
        </CardContent>
      </Card>
    </a>
    <a href="/docs/sdks" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Terminal class="w-8 h-8 mx-auto text-blue-500 mb-2" />
          <h3 class="font-medium">View SDKs</h3>
          <p class="text-sm text-muted-foreground">Node.js, Python, more</p>
        </CardContent>
      </Card>
    </a>
  </div>

  <!-- Code Examples -->
  <Card class="max-w-3xl mx-auto">
    <CardHeader>
      <div class="flex items-center gap-2">
        <Terminal class="w-5 h-5 text-muted-foreground" />
        <CardTitle class="text-lg">Quick Start</CardTitle>
      </div>
      <CardDescription>
        Send your first log with one of these examples
      </CardDescription>
    </CardHeader>
    <CardContent>
      <Tabs.Root bind:value={selectedTab}>
        <Tabs.List class="grid grid-cols-3 mb-4">
          <Tabs.Trigger value="curl">cURL</Tabs.Trigger>
          <Tabs.Trigger value="nodejs">Node.js</Tabs.Trigger>
          <Tabs.Trigger value="python">Python</Tabs.Trigger>
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
        <h3 class="font-medium mb-3">Once logs arrive, you can:</h3>
        <ul class="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
          <li class="flex items-center gap-2">
            <Filter class="w-4 h-4 text-blue-500" />
            Filter by service, level, and time
          </li>
          <li class="flex items-center gap-2">
            <SearchIcon class="w-4 h-4 text-purple-500" />
            Full-text search in messages
          </li>
          <li class="flex items-center gap-2">
            <Radio class="w-4 h-4 text-green-500" />
            Watch logs in real-time with Live Tail
          </li>
          <li class="flex items-center gap-2">
            <FolderKanban class="w-4 h-4 text-orange-500" />
            Export to JSON or CSV
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</div>
