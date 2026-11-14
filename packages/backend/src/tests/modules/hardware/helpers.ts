/**
 * Test helpers for the hardware module: build metric records shaped exactly
 * like the hw-agent sends them (data-point attributes host.name, hw.type,
 * hw.id + extras; resource service.name/host.name) and an OTLP JSON body.
 */
import type { MetricRecord } from '@logtide/reservoir';
import { db } from '../../../database/index.js';

export interface HwPoint {
  name: string;
  value: number;
  hwType: string;
  hwId: string;
  attrs?: Record<string, string>;
}

export function hwRecords(
  points: HwPoint[],
  hostName: string,
  time: Date,
  projectId: string,
  organizationId: string
): MetricRecord[] {
  return points.map((p) => ({
    time,
    organizationId,
    projectId,
    metricName: p.name,
    metricType: 'gauge',
    value: p.value,
    serviceName: 'logtide-hw-agent',
    attributes: { 'host.name': hostName, 'hw.type': p.hwType, 'hw.id': p.hwId, ...(p.attrs ?? {}) },
    resourceAttributes: { 'service.name': 'logtide-hw-agent', 'host.name': hostName },
  }));
}

const kv = (key: string, value: string) => ({ key, value: { stringValue: value } });

/** OTLP JSON ExportMetricsServiceRequest, the same shape as build_otlp_metrics in the agent. */
export function hwOtlpBody(points: HwPoint[], hostName: string, time: Date = new Date()) {
  const byName = new Map<string, unknown[]>();
  for (const p of points) {
    const list = byName.get(p.name) ?? [];
    list.push({
      timeUnixNano: String(BigInt(time.getTime()) * 1_000_000n),
      asDouble: p.value,
      attributes: [
        kv('host.name', hostName),
        kv('hw.type', p.hwType),
        kv('hw.id', p.hwId),
        ...Object.entries(p.attrs ?? {}).map(([k, v]) => kv(k, v)),
      ],
    });
    byName.set(p.name, list);
  }
  return {
    resourceMetrics: [
      {
        resource: { attributes: [kv('service.name', 'logtide-hw-agent'), kv('host.name', hostName)] },
        scopeMetrics: [
          {
            scope: { name: 'logtide-hw-agent', version: 'test' },
            metrics: [...byName.entries()].map(([name, dataPoints]) => ({ name, unit: '1', gauge: { dataPoints } })),
          },
        ],
      },
    ],
  };
}

/** Polls until `fn` returns a truthy value (fire-and-forget writes). */
export async function eventually<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function getHostRow(projectId: string, hostName: string) {
  return db
    .selectFrom('hardware_hosts')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('host_name', '=', hostName)
    .executeTakeFirst();
}

/** A healthy host: one disk, memory controller, CPU sensor, fan, PSU, NIC, host info. */
export function healthyPoints(): HwPoint[] {
  return [
    { name: 'hw.host.info', value: 1, hwType: 'host', hwId: 'host', attrs: { 'hw.virtual': 'false', 'hw.vendor': 'Supermicro', 'hw.model': 'X11', 'os.kernel': '6.1.0', 'agent.version': '1.7.0' } },
    { name: 'hw.agent.collector.status', value: 1, hwType: 'agent', hwId: 'smart', attrs: { collector: 'smart' } },
    { name: 'hw.physical_disk.smart_status', value: 1, hwType: 'physical_disk', hwId: 'sda', attrs: { device: '/dev/sda', model: 'WDC', serial: 'S1', protocol: 'ata' } },
    { name: 'hw.physical_disk.smart', value: 0, hwType: 'physical_disk', hwId: 'sda', attrs: { device: '/dev/sda', smart_attribute: 'reallocated_sector_count' } },
    { name: 'hw.memory.errors', value: 0, hwType: 'memory', hwId: 'mc0', attrs: { error_type: 'corrected', scope: 'controller' } },
    { name: 'hw.memory.errors', value: 0, hwType: 'memory', hwId: 'mc0', attrs: { error_type: 'uncorrected', scope: 'controller' } },
    { name: 'hw.temperature', value: 45, hwType: 'cpu', hwId: 'coretemp-isa-0000', attrs: { sensor: 'Package id 0' } },
    { name: 'hw.fan.speed', value: 1200, hwType: 'fan', hwId: 'nct6775', attrs: { sensor: 'fan1' } },
    { name: 'hw.power_supply.status', value: 1, hwType: 'power_supply', hwId: 'PS1', attrs: { sensor: 'PS1 Status' } },
    { name: 'hw.network.up', value: 1, hwType: 'network', hwId: 'eno1', attrs: { speed_mbps: '1000' } },
  ];
}
