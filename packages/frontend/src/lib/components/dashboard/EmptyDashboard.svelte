<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import Button from '$lib/components/ui/button/button.svelte';
  import { ConnectSnippets } from '$lib/components/connect';
  import Rocket from '@lucide/svelte/icons/rocket';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Terminal from '@lucide/svelte/icons/terminal';

  const quickActions = [
    {
      icon: FolderKanban,
      title: 'Create a project',
      description: 'Set up a project to organize your logs',
      href: '/dashboard/projects',
      color: 'bg-info/10 text-info-text'
    },
    {
      icon: Key,
      title: 'Generate API key',
      description: 'Get credentials to send logs',
      href: '/dashboard/projects',
      color: 'bg-success/10 text-success-text'
    },
    {
      icon: Book,
      title: 'Read the docs',
      description: 'Learn how to integrate LogTide',
      href: 'https://logtide.dev/docs/getting-started',
      external: true,
      color: 'bg-critical/10 text-critical-text'
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
          <h2 class="text-2xl font-bold mb-2">Welcome to LogTide!</h2>
          <p class="text-muted-foreground max-w-lg">
            Your dashboard is ready. Start sending logs to see real-time stats, charts, and insights about your applications.
          </p>
        </div>
        <div class="flex gap-2">
          <a href="https://logtide.dev/docs/getting-started" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" class="gap-2">
              <Book class="w-4 h-4" />
              View Docs
            </Button>
          </a>
          <Button href="/dashboard/projects" class="gap-2">
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
      <a href={action.href} class="block" target={action.external ? '_blank' : undefined} rel={action.external ? 'noopener noreferrer' : undefined}>
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
      <ConnectSnippets apiKey={null} />
    </CardContent>
  </Card>

  <!-- What happens next -->
  <Card class="bg-muted/30">
    <CardContent class="pt-6">
      <h3 class="font-medium mb-3">Once you start sending logs, you'll see:</h3>
      <ul class="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-info rounded-full"></span>
          Real-time log volume and trends
        </li>
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-destructive rounded-full"></span>
          Error rates and recent errors
        </li>
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-success rounded-full"></span>
          Active services reporting logs
        </li>
        <li class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 bg-critical rounded-full"></span>
          Throughput metrics
        </li>
      </ul>
    </CardContent>
  </Card>
</div>
