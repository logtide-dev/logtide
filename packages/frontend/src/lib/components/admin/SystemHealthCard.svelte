<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

  interface Props {
    title: string;
    icon?: Component;
    /** True only until the first response; background refreshes keep this false. */
    loading: boolean;
    /** Error from the latest attempt. */
    error?: string | null;
    /** Whether there is data from an earlier attempt to keep showing. */
    hasData: boolean;
    onRetry: () => void;
    skeletonRows?: number;
    headerExtra?: Snippet;
    children: Snippet;
  }

  let {
    title,
    icon: Icon,
    loading,
    error = null,
    hasData,
    onRetry,
    skeletonRows = 3,
    headerExtra,
    children,
  }: Props = $props();
</script>

<Card>
  <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-3">
    <div class="flex items-center gap-2">
      {#if Icon}<Icon class="size-4 text-muted-foreground" aria-hidden="true" />{/if}
      <CardTitle class="text-sm font-medium">{title}</CardTitle>
    </div>
    {@render headerExtra?.()}
  </CardHeader>
  <CardContent>
    {#if loading && !hasData}
      <div class="space-y-2" aria-busy="true" data-testid="health-card-skeleton">
        {#each Array(skeletonRows) as _, i (i)}
          <Skeleton class="h-5 w-full" />
        {/each}
      </div>
    {:else if error && !hasData}
      <div role="alert" class="flex flex-wrap items-center gap-3 text-sm">
        <TriangleAlert class="size-4 shrink-0 text-destructive-text" aria-hidden="true" />
        <span class="text-muted-foreground">Could not load {title.toLowerCase()}: {error}</span>
        <Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
      </div>
    {:else}
      {#if error}
        <p role="status" class="mb-3 text-xs text-warning-text">
          Refresh failed, showing the last data. {error}
        </p>
      {/if}
      {@render children()}
    {/if}
  </CardContent>
</Card>
