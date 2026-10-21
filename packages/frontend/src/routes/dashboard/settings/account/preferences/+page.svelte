<script lang="ts">
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from '$lib/components/ui/select';
  import Label from '$lib/components/ui/label/label.svelte';
  import PageHeader from '$lib/components/app/PageHeader.svelte';
  import SettingsSection from '$lib/components/app/SettingsSection.svelte';
  import { displayPreferences, resolveTimeZone } from '$lib/stores/display-preferences';
  import { themeStore, type ThemePreference } from '$lib/stores/theme';
  import { currentProjectStore } from '$lib/stores/current-project';
  import { formatTimestamp, getDisplayZoneLabel } from '$lib/utils/datetime';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Laptop from '@lucide/svelte/icons/laptop';
  import Plug from '@lucide/svelte/icons/plug';

  const BROWSER_VALUE = '__browser__';

  const timeFormatOptions = [
    { value: '24', label: '24-hour' },
    { value: '12', label: '12-hour (AM/PM)' },
  ];

  const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ];

  function isValidZone(zone: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }

  // Intl.supportedValuesOf is missing in older runtimes; Browser default and
  // UTC stay selectable either way.
  const supportedZones: string[] = (() => {
    const intl = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'timeZone') => string[];
    };
    try {
      return intl.supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  })();

  // The effective stored zone: null, 'browser' and names that are no longer
  // valid IANA zones all behave as the browser default.
  let storedZone = $derived.by(() => {
    const zone = resolveTimeZone($displayPreferences.timeZone);
    if (!zone) return null;
    return zone === 'UTC' || isValidZone(zone) ? zone : null;
  });

  let zoneOptions = $derived.by(() => {
    const set = new Set<string>(['UTC', ...supportedZones]);
    if (storedZone) set.add(storedZone);
    return [...set];
  });

  let timeFormatValue = $derived($displayPreferences.hour12 ? '12' : '24');
  let timeZoneValue = $derived(storedZone ?? BROWSER_VALUE);
  let timeZoneLabel = $derived(storedZone ?? 'Browser default');

  // Depends on the stored preferences so the sample follows every change.
  let sample = $derived.by(() => {
    void $displayPreferences;
    return formatTimestamp(new Date(), { withZone: true });
  });
  let zoneLabel = $derived.by(() => {
    void $displayPreferences;
    return getDisplayZoneLabel();
  });

  function setTimeFormat(value: string) {
    displayPreferences.set({ ...$displayPreferences, hour12: value === '12' });
  }

  function setTimeZone(value: string) {
    displayPreferences.set({
      ...$displayPreferences,
      timeZone: value === BROWSER_VALUE ? null : value,
    });
  }

  const themePreference = themeStore.preference;

  let projectId = $derived($currentProjectStore);
  let connectHref = $derived(
    projectId ? `/dashboard/projects/${projectId}/settings#connect` : '/dashboard/projects'
  );
</script>

<svelte:head>
  <title>Preferences - LogTide</title>
</svelte:head>

<div class="space-y-6">
  <PageHeader
    title="Preferences"
    appliesTo="you"
    description="How LogTide looks and shows time for you in this browser."
  />

  <SettingsSection title="Time format" description="Applies to every page in this browser.">
    <div class="space-y-2 max-w-sm">
      <Label>Time format</Label>
      <Select type="single" value={timeFormatValue} onValueChange={(v) => v && setTimeFormat(v)}>
        <SelectTrigger aria-label="Time format">
          <SelectValue>
            {timeFormatOptions.find((o) => o.value === timeFormatValue)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {#each timeFormatOptions as option (option.value)}
            <SelectItem value={option.value}>{option.label}</SelectItem>
          {/each}
        </SelectContent>
      </Select>
    </div>
  </SettingsSection>

  <SettingsSection title="Time zone" description="Applies to every page in this browser.">
    <div class="space-y-4 max-w-sm">
      <div class="space-y-2">
        <Label>Time zone</Label>
        <Select type="single" value={timeZoneValue} onValueChange={(v) => v && setTimeZone(v)}>
          <SelectTrigger aria-label="Time zone">
            <SelectValue>{timeZoneLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BROWSER_VALUE}>Browser default</SelectItem>
            {#each zoneOptions as zone (zone)}
              <SelectItem value={zone}>{zone}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
      </div>
      <p class="text-sm text-muted-foreground" data-testid="time-sample">
        Now: {sample}
      </p>
      <p class="text-xs text-muted-foreground">Displayed in {zoneLabel}.</p>
    </div>
  </SettingsSection>

  <SettingsSection title="Theme" description="Applies to every page in this browser.">
    <div class="flex flex-wrap gap-2" role="group" aria-label="Theme">
      {#each themeOptions as option (option.value)}
        {@const Icon = option.icon}
        <button
          type="button"
          aria-pressed={$themePreference === option.value}
          onclick={() => themeStore.setPreference(option.value)}
          class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors
            {$themePreference === option.value
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
        >
          <Icon class="h-4 w-4" aria-hidden="true" />
          {option.label}
        </button>
      {/each}
    </div>
  </SettingsSection>

  <SettingsSection
    title="Connect an app"
    description="Send logs from your application to a project."
  >
    <a href={connectHref} class="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
      <Plug class="h-4 w-4" aria-hidden="true" />
      Connect an app
    </a>
  </SettingsSection>
</div>
