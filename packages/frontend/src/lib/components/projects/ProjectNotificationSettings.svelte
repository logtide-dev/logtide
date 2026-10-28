<script lang="ts">
  import {
    PROJECT_HEALTH_SILENT_DEFAULT_MINUTES,
    PROJECT_HEALTH_SILENT_MAX_MINUTES,
    PROJECT_HEALTH_SILENT_MIN_MINUTES,
  } from '@logtide/shared';
  import { projectHealthAPI } from '$lib/api/project-health';
  import { notificationChannelsAPI, type NotificationChannel } from '$lib/api/notification-channels';
  import { notificationRoutingAPI, type NotificationRoutingPreview } from '$lib/api/notification-routing';
  import { toastStore } from '$lib/stores/toast';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import Spinner from '$lib/components/Spinner.svelte';

  interface Props {
    projectId: string;
    organizationId: string;
    /** Org owner/admin. Members see the controls disabled. */
    canManage: boolean;
  }

  let { projectId, organizationId, canManage }: Props = $props();

  let channels = $state<NotificationChannel[]>([]);
  let selected = $state<string[]>([]);
  let minutes = $state<string>(String(PROJECT_HEALTH_SILENT_DEFAULT_MINUTES));
  let loading = $state(true);
  let loadError = $state('');
  let saving = $state(false);
  let preview = $state<NotificationRoutingPreview | null>(null);

  $effect(() => {
    const pid = projectId;
    const orgId = organizationId;
    let active = true;
    loading = true;
    loadError = '';
    (async () => {
      try {
        const [health, list] = await Promise.all([
          projectHealthAPI.getProjectHealth(pid),
          notificationChannelsAPI.list(orgId, { enabledOnly: true }),
        ]);
        if (!active) return;
        channels = list;
        selected = [...health.settings.healthChannelIds];
        minutes = String(health.settings.silentMinutes);
      } catch (e) {
        if (active) loadError = e instanceof Error ? e.message : 'Failed to load notification settings';
      } finally {
        if (active) loading = false;
      }
    })();
    return () => {
      active = false;
    };
  });

  // Org defaults only matter while no explicit channel is chosen.
  $effect(() => {
    const pid = projectId;
    const orgId = organizationId;
    if (selected.length > 0) {
      preview = null;
      return;
    }
    let active = true;
    notificationRoutingAPI
      .preview({ organizationId: orgId, eventType: 'project_health', projectId: pid })
      .then((r) => {
        if (active) preview = r;
      })
      .catch(() => {
        if (active) preview = null;
      });
    return () => {
      active = false;
    };
  });

  const defaultsText = $derived.by(() => {
    if (!preview) return '';
    const names = preview.destinations.map((d) => `${d.name} (${d.type})`);
    if (preview.fallback) names.push('organization owners and admins by email');
    return names.length > 0 ? names.join(', ') : 'nobody (no channel is configured)';
  });

  const parsedMinutes = $derived(Number(minutes));
  const minutesValid = $derived(
    String(minutes).trim() !== '' &&
      Number.isInteger(parsedMinutes) &&
      parsedMinutes >= PROJECT_HEALTH_SILENT_MIN_MINUTES &&
      parsedMinutes <= PROJECT_HEALTH_SILENT_MAX_MINUTES,
  );

  function toggle(id: string, on: boolean) {
    selected = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
  }

  async function save() {
    if (!canManage || !minutesValid) return;
    saving = true;
    try {
      const res = await projectHealthAPI.updateSettings(projectId, {
        healthChannelIds: selected,
        silentMinutes: parsedMinutes,
      });
      selected = [...res.healthChannelIds];
      minutes = String(res.silentMinutes);
      toastStore.success('Notification settings saved');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to save notification settings');
    } finally {
      saving = false;
    }
  }
</script>

{#if loading}
  <div class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
    <Spinner size="sm" /> Loading notification settings...
  </div>
{:else if loadError}
  <p class="text-sm text-destructive-text" role="alert">{loadError}</p>
{:else}
  <div class="space-y-6" data-testid="project-notification-settings">
    {#if !canManage}
      <p class="text-sm text-muted-foreground" data-testid="notifications-readonly-hint">
        Only owners and admins can change this
      </p>
    {/if}

    <fieldset class="space-y-3" disabled={!canManage}>
      <legend class="text-sm font-medium">Health notification channels</legend>
      {#if channels.length === 0}
        <p class="text-sm text-muted-foreground">
          No enabled channels yet.
          <a href="/dashboard/settings/channels" class="text-primary hover:underline">Add a channel</a>
        </p>
      {:else}
        <ul class="grid gap-2 sm:grid-cols-2">
          {#each channels as channel (channel.id)}
            <li class="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
              <Checkbox
                id="health-channel-{channel.id}"
                checked={selected.includes(channel.id)}
                disabled={!canManage}
                onCheckedChange={(v) => toggle(channel.id, v === true)}
              />
              <Label for="health-channel-{channel.id}" class="min-w-0 flex-1 cursor-pointer truncate font-normal">
                {channel.name}
                <span class="text-xs text-muted-foreground">({channel.type})</span>
              </Label>
            </li>
          {/each}
        </ul>
      {/if}
      {#if selected.length === 0 && preview}
        <p class="text-sm text-muted-foreground" data-testid="org-defaults">
          Using organization defaults: <span class="text-foreground">{defaultsText}</span>.
          <a href="/dashboard/settings/notifications/routing" class="text-primary hover:underline">Edit routing</a>
        </p>
      {/if}
    </fieldset>

    <div class="max-w-xs space-y-2">
      <Label for="silent-minutes">Silent threshold (minutes)</Label>
      <Input
        id="silent-minutes"
        type="number"
        min={PROJECT_HEALTH_SILENT_MIN_MINUTES}
        max={PROJECT_HEALTH_SILENT_MAX_MINUTES}
        step="1"
        bind:value={minutes}
        disabled={!canManage}
        aria-invalid={!minutesValid}
      />
      {#if minutesValid}
        <p class="text-xs text-muted-foreground">
          Alert when the project sends nothing for this long (default {PROJECT_HEALTH_SILENT_DEFAULT_MINUTES}).
        </p>
      {:else}
        <p class="text-xs text-destructive-text" role="alert">
          Enter a whole number between {PROJECT_HEALTH_SILENT_MIN_MINUTES} and {PROJECT_HEALTH_SILENT_MAX_MINUTES.toLocaleString('en-US')} minutes.
        </p>
      {/if}
    </div>

    <div class="flex justify-end">
      <Button onclick={save} disabled={!canManage || !minutesValid || saving} class="gap-2">
        {#if saving}<Spinner size="sm" />{/if}
        Save
      </Button>
    </div>
  </div>
{/if}
