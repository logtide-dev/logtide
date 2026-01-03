<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import type { ComponentType } from 'svelte';

  interface Props {
    title: string;
    value: string | number;
    icon: ComponentType;
    description?: string;
    trend?: {
      value: number;
      isPositive: boolean;
    };
    onclick?: () => void;
  }

  let { title, value, icon: Icon, description, trend, onclick }: Props = $props();
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
            {trend.isPositive ? '+' : ''}{trend.value.toFixed(2)}% from last period
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
