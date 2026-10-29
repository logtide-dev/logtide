<script lang="ts">
  import { adminAPI } from '$lib/api/admin';
  import {
    buildEntitlementRows,
    formatEntitlementValue,
    planEntitlementSave,
    resetEntitlementRow,
    type EntitlementRow,
  } from '$lib/utils/entitlements-form';
  import { toastStore } from '$lib/stores/toast';
  import { formatBytes, formatCount } from '$lib/utils/format-number';
  import { Switch } from '$lib/components/ui/switch';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import EmptyState from '$lib/components/app/EmptyState.svelte';
  import Save from '@lucide/svelte/icons/save';
  import { entitlementMeta, entitlementUnitText, groupEntitlementRows } from './admin-labels';
  import { createLatestGuard } from './latest-request';

  interface Props {
    orgId: string;
  }

  let { orgId }: Props = $props();

  let rows = $state<EntitlementRow[]>([]);
  let loadedRows = $state<EntitlementRow[]>([]);
  let loading = $state(true);
  let loadError = $state('');
  let saveError = $state('');
  let saving = $state(false);

  const guard = createLatestGuard();

  const plan = $derived(planEntitlementSave(loadedRows, rows));
  const dirty = $derived(plan.updates.length > 0 || plan.resets.length > 0 || plan.errors.length > 0);
  const groups = $derived(groupEntitlementRows(rows));

  async function load() {
    const ticket = guard.begin();
    loading = true;
    loadError = '';
    try {
      const res = await adminAPI.getOrganizationEntitlements(orgId);
      if (!guard.isCurrent(ticket)) return;
      const built = buildEntitlementRows(res);
      loadedRows = built.map((r) => ({ ...r }));
      rows = built;
    } catch (err) {
      if (!guard.isCurrent(ticket)) return;
      loadError = err instanceof Error ? err.message : 'Failed to load entitlements';
      toastStore.error(loadError);
    } finally {
      if (guard.isCurrent(ticket)) loading = false;
    }
  }

  $effect(() => {
    // Reload when the page switches to another organization.
    void orgId;
    void load();
  });

  function updateRow(cap: string, patch: Partial<EntitlementRow>) {
    // Any edit cancels a pending reset: the new value becomes the override.
    rows = rows.map((r) => (r.capability === cap ? { ...r, ...patch, reset: false } : r));
  }

  function resetRow(cap: string) {
    rows = rows.map((r) => (r.capability === cap ? resetEntitlementRow(r) : r));
  }

  async function save() {
    const current = planEntitlementSave(loadedRows, rows);
    if (current.errors.length > 0) {
      saveError = current.errors.join('; ');
      return;
    }
    if (current.updates.length === 0 && current.resets.length === 0) return;

    saving = true;
    saveError = '';
    try {
      for (const cap of current.resets) {
        await adminAPI.resetOrganizationEntitlement(orgId, cap);
      }
      if (current.updates.length > 0) {
        await adminAPI.updateOrganizationEntitlements(orgId, current.updates);
      }
      toastStore.success('Entitlements saved');
      await load();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Failed to save entitlements';
      toastStore.error(saveError);
    } finally {
      saving = false;
    }
  }

  /** Readable size next to a raw byte input, e.g. "5.0 GB". */
  function bytesHint(row: EntitlementRow): string {
    if (row.unlimited) return '';
    const n = Number(row.limitText);
    return row.limitText.trim() !== '' && Number.isFinite(n) && n >= 0 ? formatBytes(n) : '';
  }

  function defaultText(row: EntitlementRow): string {
    const v = row.defaultValue;
    if (v && v.kind !== 'boolean' && v.limit !== null) {
      const unit = entitlementUnitText(entitlementMeta(row.capability, row.kind).unit);
      return `${formatCount(v.limit)}${unit ? ' ' + unit : ''}`;
    }
    return formatEntitlementValue(v);
  }
</script>

{#snippet stateBadge(row: EntitlementRow)}
  {#if row.reset}
    <Badge variant="outline">reset on save</Badge>
  {:else if row.isOverride}
    <Badge variant="secondary">override</Badge>
  {:else}
    <Badge variant="outline">default</Badge>
  {/if}
{/snippet}

{#snippet rowMeta(row: EntitlementRow)}
  <span class="text-xs text-muted-foreground">Default: {defaultText(row)}</span>
  {#if row.isOverride && !row.reset}
    <Button variant="ghost" size="sm" onclick={() => resetRow(row.capability)} disabled={saving}>
      Reset to default
    </Button>
  {/if}
{/snippet}

<SettingsSection
  title="Entitlements"
  description="Feature gates and usage caps for this organization. Only changed values are saved as overrides; reset a key to inherit the instance default again."
>
  {#if loading && rows.length === 0}
    <div class="space-y-3" aria-busy="true">
      <Skeleton class="h-8 w-full" />
      <Skeleton class="h-8 w-full" />
      <Skeleton class="h-8 w-full" />
    </div>
  {:else if loadError && rows.length === 0}
    <EmptyState variant="error" title="Could not load entitlements" description={loadError}>
      {#snippet actions()}
        <Button onclick={load}>Retry</Button>
      {/snippet}
    </EmptyState>
  {:else if rows.length === 0}
    <p class="text-sm text-muted-foreground">No entitlements are defined for this instance.</p>
  {:else}
    <div class="space-y-8">
      {#each groups as group (group.id)}
        <div class="space-y-3" data-testid="entitlement-group-{group.id}">
          <h3 class="text-sm font-semibold">{group.label}</h3>
          <div class="divide-y divide-border rounded-md border border-border">
            {#each group.rows as row (row.capability)}
              {@const meta = entitlementMeta(row.capability, row.kind)}
              {@const unit = entitlementUnitText(meta.unit)}
              <div class="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div class="min-w-0 space-y-0.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <Label for={`ent-${row.capability}`} class="text-sm font-medium">{meta.label}</Label>
                    {@render stateBadge(row)}
                  </div>
                  {#if meta.label !== row.capability}
                    <p class="font-mono text-xs text-muted-foreground">{row.capability}</p>
                  {/if}
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  {@render rowMeta(row)}
                  {#if row.kind === 'boolean'}
                    <Switch
                      id={`ent-${row.capability}`}
                      checked={row.enabled}
                      onCheckedChange={(checked) => updateRow(row.capability, { enabled: checked })}
                      disabled={saving}
                    />
                  {:else}
                    <div class="flex items-center gap-2 text-sm">
                      <Switch
                        checked={row.unlimited}
                        onCheckedChange={(checked) => updateRow(row.capability, { unlimited: checked })}
                        disabled={saving}
                        aria-label={`Unlimited ${meta.label}`}
                      />
                      <span>Unlimited</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Input
                        id={`ent-${row.capability}`}
                        type="number"
                        min="0"
                        placeholder={row.unlimited ? 'unlimited' : 'limit'}
                        value={row.unlimited ? '' : row.limitText}
                        oninput={(e) => updateRow(row.capability, { limitText: (e.currentTarget as HTMLInputElement).value })}
                        disabled={saving || row.unlimited}
                        class="w-40"
                      />
                      {#if unit}<span class="text-xs text-muted-foreground">{unit}</span>{/if}
                    </div>
                    {#if meta.unit === 'bytes' && bytesHint(row)}
                      <span class="text-xs text-muted-foreground">{bytesHint(row)}</span>
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}

      {#if saveError}
        <p class="text-sm text-destructive" role="alert">{saveError}</p>
      {/if}

      <div class="flex flex-wrap items-center gap-3">
        <Button onclick={save} disabled={saving || !dirty}>
          <Save class="mr-2 h-4 w-4" />
          {saving ? 'Saving...' : 'Save entitlements'}
        </Button>
        <p class="text-sm text-muted-foreground">Quota changes take effect on the next evaluator tick (about a minute).</p>
      </div>
    </div>
  {/if}
</SettingsSection>
