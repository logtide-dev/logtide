<script lang="ts">
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import { getApiUrl } from '$lib/config';
  import { resolveEndpoints } from '$lib/components/connect/endpoints';
  import Cpu from '@lucide/svelte/icons/cpu';
  import { buildAgentRunCommand, HARDWARE_DOCS_URL } from './hardware-meta';

  interface Props {
    projectId?: string;
    /** Override for tests; defaults to getApiUrl(). */
    apiUrl?: string;
    /** Override for tests; defaults to window.location.origin. */
    origin?: string;
  }

  let { projectId, apiUrl, origin }: Props = $props();

  const endpoints = $derived(
    resolveEndpoints(
      apiUrl ?? getApiUrl(),
      origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    )
  );
  const command = $derived(buildAgentRunCommand(endpoints.apiUrl));
</script>

<div class="space-y-4 rounded-lg border border-dashed border-border bg-card p-6" data-testid="hardware-setup">
  <div class="flex items-start gap-3">
    <Cpu class="mt-0.5 size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div class="space-y-1">
      <h3 class="text-base font-semibold">No hosts reporting yet</h3>
      <p class="max-w-2xl text-sm text-muted-foreground">
        Hardware Health watches disks (SMART), memory (ECC), temperatures, fans, power supplies and network
        links on your servers. Run the LogTide hardware agent on each host. It sends metrics and kernel
        events to this project, and a host shows up here within a few minutes.
      </p>
    </div>
  </div>

  <div class="space-y-1.5">
    <p class="text-sm font-medium">Run the agent with Docker</p>
    <div class="relative rounded-md border border-border bg-muted/50">
      <div class="absolute right-1 top-1">
        <CopyButton value={command} ariaLabel="Copy docker command" />
      </div>
      <pre class="overflow-x-auto p-4 pr-12 text-xs leading-relaxed" data-language="bash"><code>{command}</code></pre>
    </div>
    <p class="text-xs text-muted-foreground">
      Replace <code class="rounded bg-muted px-1">YOUR_API_KEY</code> with an API key of this project.
      {#if projectId}
        You can create one in the
        <a class="text-primary-text hover:underline" href="/dashboard/projects/{projectId}/settings">project settings</a>.
      {/if}
    </p>
  </div>

  <p class="text-sm">
    <a
      class="text-primary-text hover:underline"
      href={HARDWARE_DOCS_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      Read the Hardware Health docs
    </a>
    for systemd installs, permissions and limits.
  </p>
</div>
