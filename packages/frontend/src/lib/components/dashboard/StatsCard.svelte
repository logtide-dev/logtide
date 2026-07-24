<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import type { Component } from 'svelte';

  interface Props {
    title: string;
    value: string | number;
    icon: Component<{ class?: string }>;
    description?: string;
    trend?: {
      value: number;
      isPositive: boolean;
      /** Suffix after the number. Defaults to '%'. Pass '' for a plain count, ' pp' for percentage points. */
      unit?: string;
      /** Trailing label. Defaults to 'from last period'. */
      label?: string;
    };
    onclick?: () => void;
  }

  let { title, value, icon: Icon, description, trend, onclick }: Props = $props();

  function formatTrend(t: NonNullable<Props['trend']>): string {
    const unit = t.unit ?? '%';
    const decimals = unit === '' ? 0 : 2;
    const sign = t.isPositive ? '+' : '';
    return `${sign}${t.value.toFixed(decimals)}${unit} ${t.label ?? 'from last period'}`;
  }
</script>

{#if onclick}
  <button
    type="button"
    class="w-full text-left transition-all hover:shadow-md cursor-pointer rounded-lg"
    {onclick}
    title="Click to view related logs"
  >
    <Card class="h-full">
      <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle class="text-sm font-medium">{title}</CardTitle>
        <Icon class="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div class="text-2xl font-bold">{value}</div>
        {#if description}
          <p class="text-xs text-muted-foreground">{description}</p>
        {/if}
        {#if trend}
          <p class="text-xs {trend.isPositive ? 'text-green-600' : 'text-red-600'}">
            {formatTrend(trend)}
          </p>
        {/if}
      </CardContent>
    </Card>
  </button>
{:else}
  <Card>
    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle class="text-sm font-medium">{title}</CardTitle>
      <Icon class="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      <div class="text-2xl font-bold">{value}</div>
      {#if description}
        <p class="text-xs text-muted-foreground">{description}</p>
      {/if}
      {#if trend}
        <p class="text-xs {trend.isPositive ? 'text-green-600' : 'text-red-600'}">
          {trend.isPositive ? '+' : ''}{trend.value.toFixed(2)}% from last period
        </p>
      {/if}
    </CardContent>
  </Card>
{/if}
