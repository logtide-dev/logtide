<script lang="ts">
  import { adminAPI, type UserLimitOverride, type UserOrganizationLimitsAdmin } from '$lib/api/admin';
  import { toastStore } from '$lib/stores/toast';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { SelectField } from '$lib/components/ui/select';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import {
    limitFieldFromOverride,
    limitFieldToOverride,
    limitText,
    type LimitField,
    type LimitMode,
  } from './user-limits-form';

  interface Props {
    userId: string;
    limits: UserOrganizationLimitsAdmin;
    onSaved?: (limits: UserOrganizationLimitsAdmin) => void;
  }

  let { userId, limits, onSaved }: Props = $props();

  type Key = 'maxOwned' | 'maxCreationsPerMonth';

  const ROWS: Array<{ key: Key; label: string; help: string; usage: (l: UserOrganizationLimitsAdmin) => string }> = [
    {
      key: 'maxOwned',
      label: 'Organizations owned',
      help: 'How many organizations this user can own at the same time.',
      usage: (l) => `Owns ${l.effective.owned.toLocaleString('en-US')} now`,
    },
    {
      key: 'maxCreationsPerMonth',
      label: 'Organizations created per month',
      help: 'How many organizations this user can create in a calendar month (UTC). Deleting one does not give the creation back.',
      usage: (l) => `Created ${l.effective.createdThisMonth.toLocaleString('en-US')} this month`,
    },
  ];

  let fields = $state<Record<Key, LimitField>>({
    maxOwned: { mode: 'default', text: '' },
    maxCreationsPerMonth: { mode: 'default', text: '' },
  });
  let saving = $state(false);
  let formError = $state('');

  // Reset the form whenever the stored overrides change (load, save, other user).
  $effect(() => {
    fields = {
      maxOwned: limitFieldFromOverride(limits.overrides.maxOwned),
      maxCreationsPerMonth: limitFieldFromOverride(limits.overrides.maxCreationsPerMonth),
    };
    formError = '';
  });

  function parsed(key: Key): UserLimitOverride | null {
    return limitFieldToOverride(fields[key]);
  }

  const changes = $derived.by(() => {
    const out: Partial<Record<Key, UserLimitOverride>> = {};
    for (const { key } of ROWS) {
      const value = parsed(key);
      if (value !== null && value !== limits.overrides[key]) out[key] = value;
    }
    return out;
  });
  const invalid = $derived(ROWS.some(({ key }) => parsed(key) === null));
  const dirty = $derived(Object.keys(changes).length > 0);

  function modeOptions(key: Key) {
    return [
      { value: 'default', label: `Instance setting (${limitText(limits.instance[key])})` },
      { value: 'custom', label: 'Custom limit' },
      { value: 'unlimited', label: 'No limit' },
    ];
  }

  async function save() {
    if (invalid) {
      formError = 'Enter a whole number from 0 to 100,000 for each custom limit.';
      return;
    }
    if (!dirty) return;
    saving = true;
    formError = '';
    try {
      const res = await adminAPI.updateUserOrganizationLimits(userId, changes);
      toastStore.success('Organization limits updated');
      onSaved?.(res.organizationLimits);
    } catch (err) {
      formError = err instanceof Error ? err.message : 'Failed to update organization limits';
      toastStore.error(formError);
    } finally {
      saving = false;
    }
  }
</script>

<SettingsSection
  title="Organization limits"
  description="How many organizations this user can own and create. A custom limit replaces the instance setting for this user only."
>
  <div class="space-y-5" data-testid="user-org-limits">
    {#each ROWS as row (row.key)}
      <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
        <div class="space-y-1">
          <p class="text-sm font-medium" id="limit-label-{row.key}">{row.label}</p>
          <p class="text-sm text-muted-foreground">{row.help}</p>
          <p class="text-sm text-muted-foreground" data-testid="limit-usage-{row.key}">
            {row.usage(limits)}. In force: {limitText(limits.effective[row.key])}.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <SelectField
            aria-label="{row.label}: limit type"
            class="w-56"
            value={fields[row.key].mode}
            onValueChange={(v) => (fields[row.key].mode = v as LimitMode)}
            options={modeOptions(row.key)}
            disabled={saving}
          />
          {#if fields[row.key].mode === 'custom'}
            <Input
              type="number"
              min="0"
              max="100000"
              step="1"
              inputmode="numeric"
              class="w-28"
              aria-label="{row.label}: custom limit"
              data-testid="limit-input-{row.key}"
              bind:value={fields[row.key].text}
              disabled={saving}
            />
          {/if}
        </div>
      </div>
    {/each}

    {#if formError}
      <p class="text-sm text-destructive" role="alert">{formError}</p>
    {/if}

    <div class="flex flex-wrap items-center gap-3">
      <Button onclick={save} disabled={saving || !dirty}>
        {saving ? 'Saving...' : 'Save limits'}
      </Button>
      <p class="text-sm text-muted-foreground">
        Lowering a limit removes nothing: it only stops new organizations.
      </p>
    </div>
  </div>
</SettingsSection>
