<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Badge } from '$lib/components/ui/badge';

  interface ServiceStat {
    name: string;
    count: number;
    percentage: number;
  }

  interface Props {
    services: ServiceStat[];
    onServiceClick?: (service: ServiceStat) => void;
  }

  let { services, onServiceClick }: Props = $props();
</script>

<Card>
  <CardHeader>
    <CardTitle>Top Services by Volume</CardTitle>
  </CardHeader>
  <CardContent>
    <div class="space-y-4">
      {#each services as service, index (`${service.name}-${index}`)}
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg p-2 -m-2 text-left transition-colors hover:bg-accent cursor-pointer"
          onclick={() => onServiceClick?.(service)}
          title="Click to view logs for {service.name}"
        >
          <div class="flex items-center gap-3">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
              {index + 1}
            </div>
            <div>
              <p class="text-sm font-medium">{service.name}</p>
              <p class="text-xs text-muted-foreground">{service.count.toLocaleString()} logs</p>
            </div>
          </div>
          <Badge variant="secondary">{service.percentage.toFixed(2)}%</Badge>
        </button>
        {#if index < services.length - 1}
          <div class="h-px bg-border"></div>
        {/if}
      {/each}
    </div>
  </CardContent>
</Card>
