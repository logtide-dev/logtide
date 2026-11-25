<script lang="ts">
  import type { PanelConfig } from '@logtide/shared';

  interface Props {
    config: PanelConfig;
    onChange: (updated: PanelConfig) => void;
  }

  let { config }: Props = $props();
</script>

<p class="text-sm text-muted-foreground" data-legacy-type={config.type}>
  This panel uses a legacy type. Save the dashboard to upgrade it to a metrics panel, then configure it.
</p>
