<script lang="ts">
  import Building2 from '@lucide/svelte/icons/building-2';
  import Server from '@lucide/svelte/icons/server';
  import Mail from '@lucide/svelte/icons/mail';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import type { AuthProviderConfig, TestConnectionResult } from '$lib/api/admin-auth';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { Label } from '$lib/components/ui/label';
  import CopyButton from '$lib/components/app/CopyButton.svelte';
  import { providerEndpoint } from './auth-provider';

  interface Props {
    provider: AuthProviderConfig;
    redirectUri: string | null;
    busy?: boolean;
    testing?: boolean;
    testResult?: TestConnectionResult | null;
    onToggle: (enabled: boolean) => void;
    onTest: () => void;
    onEdit: () => void;
    onDelete: () => void;
  }

  let { provider, redirectUri, busy = false, testing = false, testResult = null, onToggle, onTest, onEdit, onDelete }: Props =
    $props();

  const Icon = $derived(provider.type === 'local' ? Mail : provider.type === 'oidc' ? Building2 : Server);
  const endpoint = $derived(providerEndpoint(provider));
  const external = $derived(provider.type !== 'local');
  const switchId = $derived(`provider-enabled-${provider.id}`);
</script>

<article
  class="rounded-lg border border-border bg-card p-4 sm:p-5"
  aria-label={`${provider.name} provider`}
  data-testid="auth-provider-card"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-3">
      <div class="rounded-lg bg-muted p-2"><Icon class="size-5" aria-hidden="true" /></div>
      <div class="min-w-0 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-medium">{provider.name}</h3>
          <span class="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium uppercase">
            {provider.type}
          </span>
          {#if !external}
            <span class="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Built-in</span>
          {/if}
        </div>
        <p class="text-sm text-muted-foreground">
          Slug <span class="font-mono">{provider.slug}</span>
        </p>
      </div>
    </div>

    {#if external}
      <div class="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={provider.enabled}
          disabled={busy}
          onCheckedChange={(v) => onToggle(v)}
        />
        <Label for={switchId} class="text-sm">{provider.enabled ? 'Enabled' : 'Disabled'}</Label>
      </div>
    {:else}
      <span class="text-sm text-muted-foreground">{provider.enabled ? 'Enabled' : 'Disabled'}</span>
    {/if}
  </div>

  {#if endpoint || redirectUri}
    <dl class="mt-4 space-y-2 text-sm">
      {#if endpoint}
        <div class="flex flex-wrap items-center gap-x-3">
          <dt class="w-28 shrink-0 text-muted-foreground">{endpoint.label}</dt>
          <dd class="min-w-0 break-all font-mono text-xs">{endpoint.value}</dd>
        </div>
      {/if}
      {#if redirectUri}
        <div class="flex flex-wrap items-center gap-x-3">
          <dt class="w-28 shrink-0 text-muted-foreground">Redirect URI</dt>
          <dd class="flex min-w-0 items-center gap-1">
            <span class="break-all font-mono text-xs">{redirectUri}</span>
            <CopyButton value={redirectUri} ariaLabel="Copy redirect URI" />
          </dd>
        </div>
      {/if}
    </dl>
  {/if}

  {#if external}
    <div class="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
      <Button variant="outline" size="sm" onclick={onTest} disabled={testing}>
        {#if testing}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}
        Test connection
      </Button>
      <Button variant="ghost" size="sm" onclick={onEdit}>
        <Pencil aria-hidden="true" />
        Edit
      </Button>
      <Button variant="ghost" size="sm" class="text-destructive-text" onclick={onDelete}>
        <Trash2 aria-hidden="true" />
        Delete
      </Button>
      {#if testResult}
        <p
          role="status"
          class="text-sm {testResult.success ? 'text-success-text' : 'text-destructive-text'}"
        >
          {testResult.success ? 'Connection works' : 'Connection failed'}: {testResult.message}
        </p>
      {/if}
    </div>
    <p class="mt-2 text-xs text-muted-foreground">The test uses the saved configuration.</p>
  {/if}
</article>
