import { describe, it, expect } from 'vitest';
import type { CapabilityUsage } from '$lib/api/usage';
import { visibleCapabilities } from './usage-capabilities';

const row = (capability: string, kind: 'limit' | 'quota', limit: number | null): CapabilityUsage =>
  ({ capability, kind, current: 0, limit, description: '' }) as CapabilityUsage;

describe('visibleCapabilities', () => {
  it('keeps every row when no quota is capped (self-hosted default), limited first', () => {
    const caps = [
      row('ingestion.max_bytes_monthly', 'quota', null),
      row('alerts.max_rules', 'limit', 5),
      row('telemetry.max_bytes_monthly', 'quota', null),
    ];
    expect(visibleCapabilities(caps).map((c) => c.capability)).toEqual([
      'alerts.max_rules',
      'ingestion.max_bytes_monthly',
      'telemetry.max_bytes_monthly',
    ]);
  });

  it('hides null per-signal quotas when the plan caps the combined telemetry quota', () => {
    const caps = [
      row('apikeys.max', 'limit', null),
      row('ingestion.max_bytes_monthly', 'quota', null),
      row('tracing.max_spans_monthly', 'quota', null),
      row('metrics.max_datapoints_monthly', 'quota', 1_000_000_000),
      row('telemetry.max_bytes_monthly', 'quota', 10 * 1024 ** 3),
    ];
    expect(visibleCapabilities(caps).map((c) => c.capability)).toEqual([
      'metrics.max_datapoints_monthly',
      'telemetry.max_bytes_monthly',
      'apikeys.max',
    ]);
  });
});
