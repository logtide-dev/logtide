<script lang="ts">
  // Fallback for a metric_chart / metric_stat panel that reached the client
  // without being migrated (the backend migrates them on read).
  import type { PanelConfig } from '@logtide/shared';

  interface Props {
    config: PanelConfig;
    data: unknown;
    loading: boolean;
    error: string | null;
  }

  let { config }: Props = $props();
</script>

<div
  class="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground"
  data-legacy-type={config.type}
>
  Legacy panel, open and save to upgrade.
</div>
