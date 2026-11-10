<script lang="ts">
  import type {
    HardwareComponentKey,
    HardwareComponentSnapshots,
    HardwareComponentStatus,
    HardwareCounter,
    HardwareMissingDevice,
    HardwareSeries,
  } from '@logtide/shared';
  import { HARDWARE_THRESHOLDS } from '@logtide/shared';
  import * as Table from '$lib/components/ui/table';
  import HardwareStatusBadge from './HardwareStatusBadge.svelte';
  import HardwareTrends from './HardwareTrends.svelte';
  import {
    componentLabel,
    counterDeltaText,
    counterGrew,
    diskAttribute,
    diskTemperatureStatus,
    enduranceStatus,
    formatCelsius,
    formatCounterTotal,
    formatLinkSpeed,
    formatMemorySize,
    formatPercent,
    hardwareStatusTone,
    seriesFor,
    valueTextClass,
  } from './hardware-meta';

  interface Props {
    snapshot: HardwareComponentSnapshots;
    series: HardwareSeries[];
  }

  let { snapshot, series }: Props = $props();

  const head = 'h-9 whitespace-nowrap px-3 text-xs';
  const cell = 'whitespace-nowrap px-3 py-2 text-sm';
  const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const temperatures = $derived(snapshot.cooling.temperatures ?? []);

  function voltLimit(warn: number | null | undefined, crit: number | null): string {
    const parts: string[] = [];
    if (warn !== null && warn !== undefined) parts.push(`${num(warn)} V warn`);
    if (crit !== null) parts.push(`${num(crit)} V crit`);
    return parts.length > 0 ? parts.join(', ') : '-';
  }
</script>

{#snippet counter(c: HardwareCounter | null | undefined, always: boolean = false)}
  {#if c}
    <div class={counterGrew(c) ? hardwareStatusTone('warning').text : ''}>
      <span class="font-medium tabular-nums">{formatCounterTotal(c.total)}</span>
      {#if always || counterGrew(c)}
        <p class="text-[11px] font-normal text-muted-foreground {counterGrew(c) ? hardwareStatusTone('warning').text : ''}">
          {counterDeltaText(c)}
        </p>
      {/if}
    </div>
  {:else}
    <span class="text-muted-foreground">-</span>
  {/if}
{/snippet}

{#snippet dot(status: HardwareComponentStatus, name: string)}
  <span
    class="inline-block h-2 w-2 shrink-0 rounded-full {hardwareStatusTone(status).dot}"
    title="{name}: {status}"
    role="img"
    aria-label="{name}: {status}"
  ></span>
{/snippet}

{#snippet section(
  key: HardwareComponentKey,
  status: HardwareComponentStatus,
  hasData: boolean,
  body: any,
  missing: HardwareMissingDevice[] = []
)}
  <section class="rounded-lg border bg-card" aria-labelledby="hw-{key}-title" data-testid="section-{key}">
    <div class="flex items-center justify-between gap-2 px-4 py-3 {hasData ? 'border-b' : ''}">
      <h2 id="hw-{key}-title" class="text-sm font-medium">{componentLabel(key)}</h2>
      {#if hasData}
        <HardwareStatusBadge {status} />
      {:else}
        <span class="text-xs text-muted-foreground" data-testid="no-data-{key}">No data</span>
      {/if}
    </div>
    {#if hasData}
      {@render body()}
      {#if missing.length > 0}
        <div class="border-t px-4 py-3 text-xs" data-testid="missing-{key}">
          <p class="font-medium {hardwareStatusTone('warning').text}">Seen before, not reporting now</p>
          <ul class="mt-1 space-y-0.5 text-muted-foreground">
            {#each missing as m (m.hwId + (m.sensor ?? '') + m.metric)}
              <li><span class="font-mono">{m.hwId}</span>{#if m.sensor} {m.sensor}{/if}</li>
            {/each}
          </ul>
        </div>
      {/if}
      <HardwareTrends series={seriesFor(series, key)} />
    {/if}
  </section>
{/snippet}

<div class="flex flex-col gap-4">
  <!-- Disks -->
  {#snippet disksBody()}
    <Table.Root>
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class={head}>Device</Table.Head>
          <Table.Head class={head}>Protocol</Table.Head>
          <Table.Head class={head}>SMART</Table.Head>
          <Table.Head class={head}>Reallocated</Table.Head>
          <Table.Head class={head}>Pending</Table.Head>
          <Table.Head class={head}>Uncorrectable</Table.Head>
          <Table.Head class={head}>Media errors</Table.Head>
          <Table.Head class={head}>Endurance</Table.Head>
          <Table.Head class={head}>Spare</Table.Head>
          <Table.Head class={head}>Temperature</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each snapshot.disks.disks as d (d.hwId)}
          {@const tempStatus = diskTemperatureStatus(d.protocol, d.temperature)}
          {@const endStatus = enduranceStatus(d.endurance)}
          <Table.Row data-testid="disk-row" data-status={d.status}>
            <Table.Cell class={cell}>
              <div class="flex items-center gap-2">
                {@render dot(d.status, d.device)}
                <div class="min-w-0">
                  <p class="font-mono text-xs font-medium">{d.device}</p>
                  {#if d.model || d.serial}
                    <p class="max-w-[14rem] truncate text-[11px] text-muted-foreground">
                      {[d.model, d.serial].filter(Boolean).join(' · ')}
                    </p>
                  {/if}
                </div>
              </div>
            </Table.Cell>
            <Table.Cell class={cell}>{d.protocol ? d.protocol.toUpperCase() : '-'}</Table.Cell>
            <Table.Cell class={cell}>
              {#if d.smartStatus === true}
                <span class="text-success-text">Passed</span>
              {:else if d.smartStatus === false}
                <span class="font-medium {hardwareStatusTone('critical').text}">Failed</span>
              {:else}
                <span class="text-muted-foreground">-</span>
              {/if}
            </Table.Cell>
            <Table.Cell class={cell}>{@render counter(diskAttribute(d, 'reallocated_sector_count'))}</Table.Cell>
            <Table.Cell class={cell}>{@render counter(diskAttribute(d, 'current_pending_sector'))}</Table.Cell>
            <Table.Cell class={cell}>{@render counter(diskAttribute(d, 'offline_uncorrectable'))}</Table.Cell>
            <Table.Cell class={cell}>{@render counter(d.mediaErrors)}</Table.Cell>
            <Table.Cell class="{cell} {valueTextClass(endStatus)}">{formatPercent(d.endurance)}</Table.Cell>
            <Table.Cell class={cell}>
              {formatPercent(d.spare)}
              {#if d.spareThreshold !== null}
                <span class="text-[11px] text-muted-foreground">(min {formatPercent(d.spareThreshold)})</span>
              {/if}
            </Table.Cell>
            <Table.Cell class="{cell} {valueTextClass(tempStatus)}">{formatCelsius(d.temperature)}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/snippet}
  {@render section(
    'disks',
    snapshot.disks.status,
    snapshot.disks.disks.length > 0 || (snapshot.disks.missing ?? []).length > 0,
    disksBody,
    snapshot.disks.missing
  )}

  <!-- Memory -->
  {#snippet memoryBody()}
    <p class="px-4 pt-3 text-sm text-muted-foreground">
      Installed memory <span class="font-medium text-foreground">{formatMemorySize(snapshot.memory.sizeBytes)}</span>
    </p>
    {#if snapshot.memory.controllers.length > 0}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={head}>Controller or DIMM</Table.Head>
            <Table.Head class={head}>Size</Table.Head>
            <Table.Head class={head}>Corrected errors</Table.Head>
            <Table.Head class={head}>Uncorrected errors</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each snapshot.memory.controllers as m (m.hwId)}
            <Table.Row data-testid="memory-row" data-status={m.status}>
              <Table.Cell class={cell}>
                <div class="flex items-center gap-2">
                  {@render dot(m.status, m.hwId)}
                  <div class="min-w-0">
                    <span class="font-mono text-xs font-medium">{m.dimmLabel ?? m.hwId}</span>
                    {#if m.scope === 'dimm' && m.controller}
                      <p class="text-[11px] text-muted-foreground">controller {m.controller}</p>
                    {/if}
                  </div>
                </div>
              </Table.Cell>
              <Table.Cell class={cell}>{formatMemorySize(m.sizeBytes)}</Table.Cell>
              <Table.Cell class={cell}>{@render counter(m.corrected, true)}</Table.Cell>
              <Table.Cell class={cell}>{@render counter(m.uncorrected, true)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      <p class="px-4 py-3 text-sm text-muted-foreground">No ECC memory controllers reported.</p>
    {/if}
  {/snippet}
  {@render section(
    'memory',
    snapshot.memory.status,
    snapshot.memory.sizeBytes !== null ||
      snapshot.memory.controllers.length > 0 ||
      (snapshot.memory.missing ?? []).length > 0,
    memoryBody,
    snapshot.memory.missing
  )}

  <!-- CPU -->
  {#snippet cpuBody()}
    {#if snapshot.cpu.sensors.length > 0}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={head}>Sensor</Table.Head>
            <Table.Head class={head}>Temperature</Table.Head>
            <Table.Head class={head}>High limit</Table.Head>
            <Table.Head class={head}>Critical limit</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each snapshot.cpu.sensors as s (s.hwId + s.sensor)}
            <Table.Row data-testid="cpu-row" data-status={s.status}>
              <Table.Cell class={cell}>
                <div class="flex items-center gap-2">
                  {@render dot(s.status, s.sensor)}
                  <span class="text-xs font-medium">{s.sensor}</span>
                  <span class="font-mono text-[11px] text-muted-foreground">{s.hwId}</span>
                </div>
              </Table.Cell>
              <Table.Cell class="{cell} font-medium {valueTextClass(s.status)}">{formatCelsius(s.temperature)}</Table.Cell>
              <Table.Cell class={cell}>
                {#if s.high !== null}
                  {formatCelsius(s.high)}
                {:else}
                  <span class="text-muted-foreground">{formatCelsius(HARDWARE_THRESHOLDS.cpu.temperatureHighFallback)} (default)</span>
                {/if}
              </Table.Cell>
              <Table.Cell class={cell}>
                {#if s.critical !== null}
                  {formatCelsius(s.critical)}
                {:else}
                  <span class="text-muted-foreground">{formatCelsius(HARDWARE_THRESHOLDS.cpu.temperatureCriticalFallback)} (default)</span>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
    {#if snapshot.cpu.throttle.length > 0}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={head}>Throttle events</Table.Head>
            <Table.Head class={head}>Count</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each snapshot.cpu.throttle as t (t.hwId)}
            <Table.Row data-testid="throttle-row">
              <Table.Cell class="{cell} font-mono text-xs">{t.hwId}</Table.Cell>
              <Table.Cell class={cell}>{@render counter(t, true)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  {/snippet}
  {@render section(
    'cpu',
    snapshot.cpu.status,
    snapshot.cpu.sensors.length > 0 ||
      snapshot.cpu.throttle.length > 0 ||
      (snapshot.cpu.missing ?? []).length > 0,
    cpuBody,
    snapshot.cpu.missing
  )}

  <!-- Cooling -->
  {#snippet coolingBody()}
    {#if snapshot.cooling.fans.length > 0}
    <Table.Root>
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class={head}>Fan</Table.Head>
          <Table.Head class={head}>Speed</Table.Head>
          <Table.Head class={head}>Low limit</Table.Head>
          <Table.Head class={head}>Highest in 24 h</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each snapshot.cooling.fans as f (f.hwId + f.sensor)}
          <Table.Row data-testid="fan-row" data-status={f.status}>
            <Table.Cell class={cell}>
              <div class="flex items-center gap-2">
                {@render dot(f.status, f.sensor)}
                <span class="text-xs font-medium">{f.sensor}</span>
              </div>
            </Table.Cell>
            <Table.Cell class="{cell} font-medium tabular-nums {valueTextClass(f.status)}">{num(f.rpm)} rpm</Table.Cell>
            <Table.Cell class={cell}>{f.lowCritical !== null ? `${num(f.lowCritical)} rpm` : '-'}</Table.Cell>
            <Table.Cell class={cell}>{f.max24h !== null ? `${num(f.max24h)} rpm` : '-'}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
    {/if}
    {#if temperatures.length > 0}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={head}>Temperature sensor</Table.Head>
            <Table.Head class={head}>Type</Table.Head>
            <Table.Head class={head}>Reading</Table.Head>
            <Table.Head class={head}>High limit</Table.Head>
            <Table.Head class={head}>Critical limit</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each temperatures as t (t.hwId + t.sensor)}
            <Table.Row data-testid="thermal-row" data-status={t.status}>
              <Table.Cell class={cell}>
                <div class="flex items-center gap-2">
                  {@render dot(t.status, t.sensor)}
                  <span class="text-xs font-medium">{t.sensor}</span>
                </div>
              </Table.Cell>
              <Table.Cell class={cell}>{t.type}</Table.Cell>
              <Table.Cell class="{cell} font-medium {valueTextClass(t.status)}">{formatCelsius(t.temperature)}</Table.Cell>
              <Table.Cell class={cell}>{formatCelsius(t.high)}</Table.Cell>
              <Table.Cell class={cell}>{formatCelsius(t.critical)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  {/snippet}
  {@render section(
    'cooling',
    snapshot.cooling.status,
    snapshot.cooling.fans.length > 0 ||
      temperatures.length > 0 ||
      (snapshot.cooling.missing ?? []).length > 0,
    coolingBody,
    snapshot.cooling.missing
  )}

  <!-- Power -->
  {#snippet powerBody()}
    {#if snapshot.power.supplies.length > 0}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={head}>Power supply</Table.Head>
            <Table.Head class={head}>Status</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each snapshot.power.supplies as p (p.hwId + p.sensor)}
            <Table.Row data-testid="psu-row" data-status={p.status}>
              <Table.Cell class={cell}>
                <div class="flex items-center gap-2">
                  {@render dot(p.status, p.sensor)}
                  <span class="text-xs font-medium">{p.sensor}</span>
                </div>
              </Table.Cell>
              <Table.Cell class={cell}>
                {#if p.ok}
                  <span class="text-success-text">OK</span>
                {:else}
                  <span class="font-medium {hardwareStatusTone('critical').text}">Failed</span>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
    {#if snapshot.power.voltages.length > 0}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class={head}>Voltage</Table.Head>
            <Table.Head class={head}>Reading</Table.Head>
            <Table.Head class={head}>Low limit</Table.Head>
            <Table.Head class={head}>High limit</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each snapshot.power.voltages as v (v.hwId + v.sensor)}
            <Table.Row data-testid="voltage-row" data-status={v.status}>
              <Table.Cell class={cell}>
                <div class="flex items-center gap-2">
                  {@render dot(v.status, v.sensor)}
                  <span class="text-xs font-medium">{v.sensor}</span>
                </div>
              </Table.Cell>
              <Table.Cell class="{cell} font-medium tabular-nums {valueTextClass(v.status)}">{num(v.volts)} V</Table.Cell>
              <Table.Cell class={cell}>{voltLimit(v.low, v.lowCritical)}</Table.Cell>
              <Table.Cell class={cell}>{voltLimit(v.high, v.highCritical)}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  {/snippet}
  {@render section(
    'power',
    snapshot.power.status,
    snapshot.power.supplies.length > 0 ||
      snapshot.power.voltages.length > 0 ||
      (snapshot.power.missing ?? []).length > 0,
    powerBody,
    snapshot.power.missing
  )}

  <!-- Network -->
  {#snippet networkBody()}
    <Table.Root>
      <Table.Header>
        <Table.Row class="hover:bg-transparent">
          <Table.Head class={head}>Interface</Table.Head>
          <Table.Head class={head}>Link</Table.Head>
          <Table.Head class={head}>Speed</Table.Head>
          <Table.Head class={head}>Errors</Table.Head>
          <Table.Head class={head}>CRC errors</Table.Head>
          <Table.Head class={head}>Dropped</Table.Head>
          <Table.Head class={head}>Link changes</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each snapshot.network.interfaces as n (n.hwId)}
          <Table.Row data-testid="nic-row" data-status={n.status}>
            <Table.Cell class={cell}>
              <div class="flex items-center gap-2">
                {@render dot(n.status, n.hwId)}
                <span class="font-mono text-xs font-medium">{n.hwId}</span>
              </div>
            </Table.Cell>
            <Table.Cell class={cell}>
              {#if n.up === true}
                <span class="text-success-text">Up</span>
              {:else if n.up === false}
                <span class="text-muted-foreground">Down</span>
              {:else}
                <span class="text-muted-foreground">-</span>
              {/if}
            </Table.Cell>
            <Table.Cell class={cell}>{formatLinkSpeed(n.speedMbps)}</Table.Cell>
            <Table.Cell class={cell}>{@render counter(n.errors)}</Table.Cell>
            <Table.Cell class={cell}>{@render counter(n.crc)}</Table.Cell>
            <!-- Dropped packets are informational and never raise the status. -->
            <Table.Cell class="{cell} text-muted-foreground">{formatCounterTotal(n.dropped.total)}</Table.Cell>
            <Table.Cell class={cell}>{@render counter(n.carrierChanges)}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  {/snippet}
  {@render section(
    'network',
    snapshot.network.status,
    snapshot.network.interfaces.length > 0 || (snapshot.network.missing ?? []).length > 0,
    networkBody,
    snapshot.network.missing
  )}
</div>
