<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import {
    DNS_RECORD_TYPES,
    HTTP_METHODS,
    MAX_HEADERS,
    type MonitorFormValues,
  } from './monitor-form-state';

  interface Props {
    values: MonitorFormValues;
    errors: Record<string, string>;
    availableServices?: string[];
    /** Fixed prefix so ids stay unique when two forms exist on a page. */
    idPrefix: string;
  }

  let { values = $bindable(), errors, availableServices = [], idPrefix }: Props = $props();

  let serviceSearchOpen = $state(false);

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

  const defaultGrace = $derived.by(() => {
    const n = Number(values.intervalSeconds);
    return Number.isFinite(n) && values.intervalSeconds.trim() !== '' ? String(Math.round(n * 1.5)) : '';
  });

  const matchingServices = $derived(
    availableServices.filter((s) => !values.target || s.toLowerCase().includes(values.target.toLowerCase()))
  );

  function addHeader() {
    if (values.headers.length >= MAX_HEADERS) return;
    values.headers = [...values.headers, { name: '', value: '' }];
  }

  function removeHeader(index: number) {
    values.headers = values.headers.filter((_, i) => i !== index);
  }

  const id = (name: string) => `${idPrefix}-${name}`;
</script>

{#if values.type === 'http'}
  <div class="space-y-1.5 sm:col-span-2">
    <Label for={id('target')}>URL</Label>
    <Input
      id={id('target')}
      bind:value={values.target}
      placeholder="https://example.com/health"
      aria-invalid={errors.target ? 'true' : undefined}
      aria-describedby={errors.target ? id('target-error') : undefined}
    />
    {#if errors.target}<p id={id('target-error')} class="text-xs text-destructive-text">{errors.target}</p>{/if}
  </div>

  <div class="space-y-1.5">
    <Label for={id('method')}>Method</Label>
    <select id={id('method')} class={selectClass} bind:value={values.method}>
      {#each HTTP_METHODS as method (method)}
        <option value={method}>{method}</option>
      {/each}
    </select>
  </div>

  <div class="space-y-1.5">
    <Label for={id('expected-status')}>Expected status</Label>
    <Input
      id={id('expected-status')}
      inputmode="numeric"
      bind:value={values.expectedStatus}
      placeholder="Any 2xx"
      aria-invalid={errors.expectedStatus ? 'true' : undefined}
    />
    {#if errors.expectedStatus}
      <p class="text-xs text-destructive-text">{errors.expectedStatus}</p>
    {:else}
      <p class="text-xs text-muted-foreground">Leave blank to accept any 2xx response.</p>
    {/if}
  </div>

  <div class="space-y-2 sm:col-span-2">
    <div class="flex items-center justify-between">
      <Label>Request headers</Label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onclick={addHeader}
        disabled={values.headers.length >= MAX_HEADERS}
      >
        <Plus class="mr-1 h-4 w-4" />
        Add header
      </Button>
    </div>
    {#each values.headers as header, i (i)}
      <div class="flex items-center gap-2">
        <Input
          aria-label="Header {i + 1} name"
          placeholder="Name"
          class="w-2/5"
          bind:value={header.name}
        />
        <Input
          aria-label="Header {i + 1} value"
          placeholder="Value"
          class="flex-1"
          bind:value={header.value}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onclick={() => removeHeader(i)}
          aria-label="Remove header {i + 1}"
        >
          <X class="h-4 w-4" />
        </Button>
      </div>
    {/each}
    {#if errors.headers}<p class="text-xs text-destructive-text">{errors.headers}</p>{/if}
  </div>

  <div class="space-y-1.5">
    <Label for={id('body-kind')}>Response body check</Label>
    <select id={id('body-kind')} class={selectClass} bind:value={values.bodyAssertionKind}>
      <option value="none">None</option>
      <option value="contains">Contains text</option>
      <option value="regex">Matches regular expression</option>
    </select>
  </div>
  {#if values.bodyAssertionKind !== 'none'}
    <div class="space-y-1.5">
      <Label for={id('body-value')}>
        {values.bodyAssertionKind === 'regex' ? 'Pattern' : 'Text'}
      </Label>
      <Input
        id={id('body-value')}
        bind:value={values.bodyAssertionValue}
        aria-invalid={errors.bodyAssertionValue ? 'true' : undefined}
      />
      {#if errors.bodyAssertionValue}
        <p class="text-xs text-destructive-text">{errors.bodyAssertionValue}</p>
      {/if}
    </div>
  {/if}
{:else if values.type === 'tcp'}
  <div class="space-y-1.5 sm:col-span-2">
    <Label for={id('target')}>Target (host:port)</Label>
    <Input
      id={id('target')}
      bind:value={values.target}
      placeholder="db.example.com:5432"
      aria-invalid={errors.target ? 'true' : undefined}
    />
    {#if errors.target}<p class="text-xs text-destructive-text">{errors.target}</p>{/if}
  </div>
{:else if values.type === 'heartbeat'}
  <div class="rounded-md border border-info/30 bg-info/15 px-3 py-2 text-sm text-info-text sm:col-span-2">
    <p class="mb-1 font-medium">Push-based heartbeat</p>
    <p class="text-xs">
      After you create this monitor you get an endpoint URL. Your service must send a request to it on
      a schedule.
    </p>
  </div>
{:else if values.type === 'log_heartbeat'}
  <div class="space-y-1.5">
    <Label for={id('target')}>Service name</Label>
    <div class="relative">
      <Input
        id={id('target')}
        bind:value={values.target}
        placeholder="logtide-worker"
        autocomplete="off"
        onfocus={() => (serviceSearchOpen = true)}
        onblur={() => setTimeout(() => (serviceSearchOpen = false), 150)}
        aria-invalid={errors.target ? 'true' : undefined}
      />
      {#if serviceSearchOpen && matchingServices.length > 0}
        <div class="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {#each matchingServices as svc (svc)}
            <button
              type="button"
              class="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              onmousedown={() => {
                values.target = svc;
                serviceSearchOpen = false;
              }}
            >
              {svc}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    {#if errors.target}
      <p class="text-xs text-destructive-text">{errors.target}</p>
    {:else}
      <p class="text-xs text-muted-foreground">Down when this service stops sending logs.</p>
    {/if}
  </div>
  <div class="space-y-1.5">
    <Label for={id('grace')}>Silence threshold (seconds)</Label>
    <Input
      id={id('grace')}
      inputmode="numeric"
      bind:value={values.gracePeriodSeconds}
      placeholder={defaultGrace}
      aria-invalid={errors.gracePeriodSeconds ? 'true' : undefined}
    />
    {#if errors.gracePeriodSeconds}
      <p class="text-xs text-destructive-text">{errors.gracePeriodSeconds}</p>
    {:else}
      <p class="text-xs text-muted-foreground">
        Down after this long without logs. Default: {defaultGrace || '-'} s (interval x 1.5).
      </p>
    {/if}
  </div>
{:else if values.type === 'ssl'}
  <div class="space-y-1.5">
    <Label for={id('target')}>Host (host or host:port)</Label>
    <Input
      id={id('target')}
      bind:value={values.target}
      placeholder="example.com"
      aria-invalid={errors.target ? 'true' : undefined}
    />
    {#if errors.target}
      <p class="text-xs text-destructive-text">{errors.target}</p>
    {:else}
      <p class="text-xs text-muted-foreground">The port defaults to 443.</p>
    {/if}
  </div>
  <div class="space-y-1.5">
    <Label for={id('warn-days')}>Warn when fewer than (days)</Label>
    <Input
      id={id('warn-days')}
      inputmode="numeric"
      bind:value={values.warnDays}
      aria-invalid={errors.warnDays ? 'true' : undefined}
    />
    {#if errors.warnDays}
      <p class="text-xs text-destructive-text">{errors.warnDays}</p>
    {:else}
      <p class="text-xs text-muted-foreground">The monitor goes down when the certificate has fewer days left.</p>
    {/if}
  </div>
{:else if values.type === 'dns'}
  <div class="space-y-1.5">
    <Label for={id('target')}>Hostname</Label>
    <Input
      id={id('target')}
      bind:value={values.target}
      placeholder="example.com"
      aria-invalid={errors.target ? 'true' : undefined}
    />
    {#if errors.target}<p class="text-xs text-destructive-text">{errors.target}</p>{/if}
  </div>
  <div class="space-y-1.5">
    <Label for={id('record-type')}>Record type</Label>
    <select id={id('record-type')} class={selectClass} bind:value={values.recordType}>
      {#each DNS_RECORD_TYPES as type (type)}
        <option value={type}>{type}</option>
      {/each}
    </select>
  </div>
  <div class="space-y-1.5 sm:col-span-2">
    <Label for={id('expected-value')}>Expected value</Label>
    <Input
      id={id('expected-value')}
      bind:value={values.expectedValue}
      placeholder="Optional"
    />
    <p class="text-xs text-muted-foreground">
      Leave blank to only require that the record exists. For MX records compare the mail server host.
    </p>
  </div>
{/if}
