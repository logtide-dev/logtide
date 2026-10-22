<script lang="ts">
  import type { Project } from '@logtide/shared';
  import { writeScopeToUrl } from '$lib/stores/scope-url';
  import { buttonVariants } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { formatDateShort } from '$lib/utils/datetime';
  import FileText from '@lucide/svelte/icons/file-text';
  import Plug from '@lucide/svelte/icons/plug';
  import type { LastEventStatus } from './last-event';

  interface Props {
    project: Project;
    status: LastEventStatus;
  }

  let { project, status }: Props = $props();

  // Canonical scope param, never the legacy projectId.
  let logsHref = $derived.by(() => {
    const url = writeScopeToUrl(new URL('/dashboard/logs', 'http://local'), { projectIds: [project.id] });
    return url.pathname + url.search;
  });
</script>

<Card class="hover:border-primary/50 transition-colors" data-testid="project-card">
  <CardHeader>
    <CardTitle class="text-lg truncate">{project.name}</CardTitle>
    {#if project.description}
      <CardDescription class="mt-1.5">{project.description}</CardDescription>
    {/if}
  </CardHeader>
  <CardContent>
    <div class="space-y-4">
      <div class="space-y-0.5 text-xs text-muted-foreground">
        <p data-testid="last-event" data-kind={status.kind}>{status.text}</p>
        <p>Created {formatDateShort(project.createdAt)}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <a
          href="/dashboard/projects/{project.id}/overview"
          class="{buttonVariants({ variant: 'outline', size: 'sm' })} flex-1"
        >
          View project
        </a>
        <a href={logsHref} class="{buttonVariants({ variant: 'outline', size: 'sm' })} gap-1">
          <FileText class="w-4 h-4" />
          Logs
        </a>
        {#if status.kind === 'waiting'}
          <a
            href="/dashboard/projects/{project.id}/settings#connect"
            class="{buttonVariants({ variant: 'default', size: 'sm' })} gap-1"
          >
            <Plug class="w-4 h-4" />
            Connect
          </a>
        {/if}
      </div>
    </div>
  </CardContent>
</Card>
