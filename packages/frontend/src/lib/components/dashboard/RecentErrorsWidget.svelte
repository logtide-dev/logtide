<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
  import Timestamp from '$lib/components/app/Timestamp.svelte';
  import { levelTone } from '$lib/utils/severity';

  interface LogError {
    time: string;
    service: string;
    level: 'error' | 'critical';
    message: string;
    projectId: string;
    traceId?: string;
  }

  interface Props {
    errors: LogError[];
    onErrorClick?: (error: LogError) => void;
  }

  let { errors, onErrorClick }: Props = $props();
</script>

<Card>
  <CardHeader>
    <CardTitle>Recent errors</CardTitle>
  </CardHeader>
  <CardContent>
    <div class="space-y-3">
      {#if errors.length === 0}
        <p class="text-sm text-muted-foreground text-center py-4">No recent errors</p>
      {/if}
      {#each errors as error, index (`${error.time}-${error.service}-${index}`)}
        <button
          type="button"
          class="flex w-full gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent/50 cursor-pointer overflow-hidden"
          onclick={() => onErrorClick?.(error)}
          title="Click to view related logs"
        >
          <div class="flex-shrink-0">
            {#if error.level === 'critical'}
              <AlertCircle class="h-5 w-5 {levelTone('critical').text}" />
            {:else}
              <AlertTriangle class="h-5 w-5 {levelTone('error').text}" />
            {/if}
          </div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-medium truncate">{error.service}</p>
              <p class="text-xs text-muted-foreground flex-shrink-0"><Timestamp value={error.time} relative /></p>
            </div>
            <p class="text-xs text-muted-foreground line-clamp-2 break-all">{error.message}</p>
            <Badge variant={error.level === 'critical' ? 'destructive' : 'secondary'} class="text-xs">
              {error.level}
            </Badge>
          </div>
        </button>
      {/each}
    </div>
  </CardContent>
</Card>
