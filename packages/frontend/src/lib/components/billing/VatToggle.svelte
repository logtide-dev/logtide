<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import TimeRangeButtons from '$lib/components/TimeRangeButtons.svelte';
  import { billingVat, type VatAudience } from '$lib/stores/billing-vat';
  import { EU_COUNTRIES } from '$lib/utils/eu-vat';

  const AUDIENCE_OPTIONS = [
    { value: 'personal', label: 'Personal' },
    { value: 'business', label: 'Business' },
  ];

  const COUNTRY_OPTIONS = [
    ...Object.entries(EU_COUNTRIES)
      .map(([code, c]) => ({ value: code, label: c.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
    { value: 'OUT', label: 'Outside the EU' },
  ];

  const countryLabel = $derived(COUNTRY_OPTIONS.find((o) => o.value === $billingVat.country)?.label ?? 'Outside the EU');
</script>

<div class="flex flex-wrap items-center gap-2">
  <TimeRangeButtons
    options={AUDIENCE_OPTIONS}
    value={$billingVat.audience}
    onChange={(v) => billingVat.setAudience(v as VatAudience)}
  />
  <Select.Root
    type="single"
    value={$billingVat.country}
    onValueChange={(v) => v && billingVat.setCountry(v)}
  >
    <Select.Trigger class="h-9 w-[11rem]" aria-label="Country for VAT">{countryLabel}</Select.Trigger>
    <Select.Content>
      {#each COUNTRY_OPTIONS as option (option.value)}
        <Select.Item value={option.value}>{option.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</div>
