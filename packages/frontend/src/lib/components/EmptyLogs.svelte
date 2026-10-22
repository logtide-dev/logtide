<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card';
  import { ConnectSnippets } from '$lib/components/connect';
  import SearchIcon from '@lucide/svelte/icons/search';
  import Key from '@lucide/svelte/icons/key';
  import Book from '@lucide/svelte/icons/book';
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import Terminal from '@lucide/svelte/icons/terminal';
  import Radio from '@lucide/svelte/icons/radio';
  import Filter from '@lucide/svelte/icons/filter';
</script>

<div class="space-y-6 py-8">
  <!-- Empty State Hero -->
  <div class="text-center">
    <div class="w-20 h-20 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
      <SearchIcon class="w-10 h-10 text-primary" />
    </div>
    <h2 class="text-2xl font-bold mb-2">No logs yet</h2>
    <p class="text-muted-foreground max-w-md mx-auto">
      Start sending logs from your applications to search and analyze them here.
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
    <a href="https://logtide.dev/docs/getting-started" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Book class="w-8 h-8 mx-auto text-primary mb-2" />
          <h3 class="font-medium">Read docs</h3>
          <p class="text-sm text-muted-foreground">Integration guides</p>
        </CardContent>
      </Card>
    </a>
    <a href="https://logtide.dev/docs/sdks" target="_blank" rel="noopener noreferrer" class="block">
      <Card class="h-full hover:border-primary/50 transition-all cursor-pointer text-center">
        <CardContent class="pt-6">
          <Terminal class="w-8 h-8 mx-auto text-primary mb-2" />
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
        <CardTitle class="text-lg">Quick start</CardTitle>
      </div>
      <CardDescription>
        Send your first log with one of these examples
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ConnectSnippets apiKey={null} />
    </CardContent>
  </Card>

  <!-- Features Preview -->
  <div class="max-w-3xl mx-auto">
    <Card class="bg-muted/30">
      <CardContent class="pt-6">
        <h3 class="font-medium mb-3">Once logs arrive, you can:</h3>
        <ul class="grid gap-2 sm:grid-cols-2 text-sm text-muted-foreground">
          <li class="flex items-center gap-2">
            <Filter class="w-4 h-4 text-primary" />
            Filter by service, level, and time
          </li>
          <li class="flex items-center gap-2">
            <SearchIcon class="w-4 h-4 text-primary" />
            Search messages and metadata with the query language
          </li>
          <li class="flex items-center gap-2">
            <Radio class="w-4 h-4 text-primary" />
            Watch new logs arrive with live tail
          </li>
          <li class="flex items-center gap-2">
            <FolderKanban class="w-4 h-4 text-primary" />
            Export to JSON or CSV
          </li>
        </ul>
      </CardContent>
    </Card>
  </div>
</div>
