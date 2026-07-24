<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { organizationStore } from '$lib/stores/organization';
  import { toastStore } from '$lib/stores/toast';
  import {
    digestsAPI,
    type DigestConfig,
    type DigestRecipient,
    type DigestFrequency,
  } from '$lib/api/digests';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Switch } from '$lib/components/ui/switch';
  import { Badge } from '$lib/components/ui/badge';
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';
  import { canManageMembers } from '@logtide/shared';
  import type { OrganizationWithRole } from '@logtide/shared';
  import Save from '@lucide/svelte/icons/save';
  import Mail from '@lucide/svelte/icons/mail';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Plus from '@lucide/svelte/icons/plus';

  let currentOrg = $state<OrganizationWithRole | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let addingRecipient = $state(false);

  let config = $state<DigestConfig | null>(null);
  let recipients = $state<DigestRecipient[]>([]);

  // Form state
  let enabled = $state(false);
  let frequency = $state<DigestFrequency>('daily');
  let deliveryHour = $state(8);
  let deliveryDayOfWeek = $state(1);
  let newRecipientEmail = $state('');

  let canManage = $derived(currentOrg ? canManageMembers(currentOrg.role) : false);

  const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  function hourLabel(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00 UTC`;
  }

  const unsubOrgStore = organizationStore.subscribe((state) => {
    const previous = currentOrg?.id;
    currentOrg = state.currentOrganization;
    if (currentOrg && currentOrg.id !== previous) {
      loadSettings();
    }
  });

  onDestroy(() => {
    unsubOrgStore();
  });

  onMount(() => {
    if (currentOrg) {
      loadSettings();
    }
  });

  async function loadSettings() {
    if (!currentOrg) return;
    loading = true;
    try {
      const data = await digestsAPI.getConfig(currentOrg.id);
      config = data.config;
      recipients = data.recipients;
      if (config) {
        enabled = config.enabled;
        frequency = config.frequency;
        deliveryHour = config.delivery_hour;
        deliveryDayOfWeek = config.delivery_day_of_week ?? 1;
      }
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to load digest settings');
    } finally {
      loading = false;
    }
  }

  async function saveConfig() {
    if (!currentOrg) return;
    saving = true;
    try {
      config = await digestsAPI.saveConfig(currentOrg.id, {
        frequency,
        deliveryHour,
        deliveryDayOfWeek: frequency === 'weekly' ? deliveryDayOfWeek : null,
        enabled,
      });
      toastStore.success('Digest settings saved');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to save digest settings');
    } finally {
      saving = false;
    }
  }

  async function addRecipient() {
    if (!currentOrg || !newRecipientEmail.trim()) return;
    addingRecipient = true;
    try {
      const recipient = await digestsAPI.addRecipient(currentOrg.id, newRecipientEmail.trim());
      recipients = [...recipients, recipient];
      newRecipientEmail = '';
      toastStore.success('Recipient added');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to add recipient');
    } finally {
      addingRecipient = false;
    }
  }

  async function removeRecipient(recipient: DigestRecipient) {
    if (!currentOrg) return;
    try {
      await digestsAPI.removeRecipient(currentOrg.id, recipient.id);
      recipients = recipients.filter((r) => r.id !== recipient.id);
      toastStore.success('Recipient removed');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to remove recipient');
    }
  }

  async function resubscribeRecipient(recipient: DigestRecipient) {
    if (!currentOrg) return;
    try {
      const updated = await digestsAPI.resubscribeRecipient(currentOrg.id, recipient.id);
      recipients = recipients.map((r) => (r.id === updated.id ? updated : r));
      toastStore.success('Recipient resubscribed');
    } catch (e) {
      toastStore.error(e instanceof Error ? e.message : 'Failed to resubscribe recipient');
    }
  }
</script>

<svelte:head>
  <title>Email Digests - Settings - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <h2 class="text-2xl font-bold tracking-tight">Email Digests</h2>
    <p class="text-muted-foreground">
      Periodic email summaries of log activity, errors, security detections and uptime.
    </p>
  </div>

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading digest settings...</p>
  {:else}
    <Card>
      <CardHeader>
        <CardTitle>Schedule</CardTitle>
        <CardDescription>
          When the digest report is generated and sent. Times are in UTC.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            saveConfig();
          }}
          class="space-y-4"
        >
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label>Enable digest emails</Label>
              <p class="text-sm text-muted-foreground">
                Subscribed recipients receive the report on the schedule below.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={(v) => (enabled = v)} disabled={!canManage || saving} />
          </div>

          <Separator />

          <div class="grid gap-4 sm:grid-cols-3">
            <div class="space-y-2">
              <Label>Frequency</Label>
              <Select
                type="single"
                value={frequency}
                onValueChange={(v) => (frequency = v as DigestFrequency)}
                disabled={!canManage || saving}
              >
                <SelectTrigger>
                  <SelectValue>{frequency === 'daily' ? 'Daily' : 'Weekly'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label>Delivery time</Label>
              <Select
                type="single"
                value={String(deliveryHour)}
                onValueChange={(v) => (deliveryHour = Number(v))}
                disabled={!canManage || saving}
              >
                <SelectTrigger>
                  <SelectValue>{hourLabel(deliveryHour)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {#each hours as hour (hour)}
                    <SelectItem value={String(hour)}>{hourLabel(hour)}</SelectItem>
                  {/each}
                </SelectContent>
              </Select>
            </div>

            {#if frequency === 'weekly'}
              <div class="space-y-2">
                <Label>Day of week</Label>
                <Select
                  type="single"
                  value={String(deliveryDayOfWeek)}
                  onValueChange={(v) => (deliveryDayOfWeek = Number(v))}
                  disabled={!canManage || saving}
                >
                  <SelectTrigger>
                    <SelectValue>{dayLabels[deliveryDayOfWeek]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {#each dayLabels as day, index (day)}
                      <SelectItem value={String(index)}>{day}</SelectItem>
                    {/each}
                  </SelectContent>
                </Select>
              </div>
            {/if}
          </div>

          {#if config?.last_sent_at}
            <p class="text-xs text-muted-foreground">
              Last sent: {new Date(config.last_sent_at).toLocaleString()}
            </p>
          {/if}

          <Button type="submit" disabled={!canManage || saving} class="gap-2">
            <Save class="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Schedule'}
          </Button>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Recipients</CardTitle>
        <CardDescription>
          Who receives the digest. Each email includes its own one-click unsubscribe link.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if !config}
          <p class="text-sm text-muted-foreground">
            Save the schedule first, then add recipients.
          </p>
        {:else}
          {#if canManage}
            <form
              onsubmit={(e) => {
                e.preventDefault();
                addRecipient();
              }}
              class="flex gap-2"
            >
              <Input
                type="email"
                placeholder="teammate@example.com"
                bind:value={newRecipientEmail}
                disabled={addingRecipient}
                class="max-w-sm"
                required
              />
              <Button type="submit" disabled={addingRecipient || !newRecipientEmail.trim()} class="gap-2">
                <Plus class="w-4 h-4" />
                Add
              </Button>
            </form>
          {/if}

          {#if recipients.length === 0}
            <p class="text-sm text-muted-foreground">No recipients yet.</p>
          {:else}
            <div class="divide-y rounded-md border">
              {#each recipients as recipient (recipient.id)}
                <div class="flex items-center justify-between gap-3 px-4 py-3">
                  <div class="flex items-center gap-3 min-w-0">
                    <Mail class="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span class="truncate text-sm">{recipient.email}</span>
                    {#if recipient.subscribed}
                      <Badge variant="secondary">Subscribed</Badge>
                    {:else}
                      <Badge variant="outline">Unsubscribed</Badge>
                    {/if}
                  </div>
                  {#if canManage}
                    <div class="flex items-center gap-1">
                      {#if !recipient.subscribed}
                        <Button
                          variant="ghost"
                          size="sm"
                          class="gap-1"
                          onclick={() => resubscribeRecipient(recipient)}
                        >
                          <RotateCcw class="w-4 h-4" />
                          Resubscribe
                        </Button>
                      {/if}
                      <Button
                        variant="ghost"
                        size="sm"
                        class="text-destructive"
                        onclick={() => removeRecipient(recipient)}
                      >
                        <Trash2 class="w-4 h-4" />
                      </Button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
