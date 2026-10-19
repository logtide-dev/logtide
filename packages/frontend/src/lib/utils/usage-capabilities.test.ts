import { describe, it, expect } from 'vitest';
import type { CapabilityUsage } from '$lib/api/usage';
import { visibleCapabilities } from './usage-capabilities';

const row = (capability: string, kind: 'limit' | 'quota', limit: number | null): CapabilityUsage =>
  ({ capability, kind, current: 0, limit, description: '' }) as CapabilityUsage;

const names = (caps: CapabilityUsage[]) => visibleCapabilities(caps).map((c) => c.capability);

describe('visibleCapabilities', () => {
  it('keeps every row when no quota is capped (self-hosted default), limited first', () => {
    expect(
      names([
        row('ingestion.max_bytes_monthly', 'quota', null),
        row('alerts.max_rules', 'limit', 5),
        row('telemetry.max_bytes_monthly', 'quota', null),
      ])
    ).toEqual(['alerts.max_rules', 'ingestion.max_bytes_monthly', 'telemetry.max_bytes_monthly']);
  });

  it('keeps every row when only a per-signal quota is capped (self-hoster with one quota)', () => {
    expect(
      names([
        row('ingestion.max_bytes_monthly', 'quota', null),
        row('storage.max_bytes', 'quota', 1024),
        row('tracing.max_spans_monthly', 'quota', null),
        row('telemetry.max_bytes_monthly', 'quota', null),
      ])
    ).toEqual([
      'storage.max_bytes',
      'ingestion.max_bytes_monthly',
      'tracing.max_spans_monthly',
      'telemetry.max_bytes_monthly',
    ]);
  });

  it('hides null quotas when the combined telemetry quota is capped (hosted plan)', () => {
    expect(
      names([
        row('apikeys.max', 'limit', null),
        row('ingestion.max_bytes_monthly', 'quota', null),
        row('tracing.max_spans_monthly', 'quota', null),
        row('metrics.max_datapoints_monthly', 'quota', 1_000_000_000),
        row('telemetry.max_bytes_monthly', 'quota', 10 * 1024 ** 3),
      ])
    ).toEqual(['metrics.max_datapoints_monthly', 'telemetry.max_bytes_monthly', 'apikeys.max']);
  });
});
