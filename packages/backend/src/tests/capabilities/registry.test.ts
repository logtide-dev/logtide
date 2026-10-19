import { describe, it, expect } from 'vitest';
import {
  CAPABILITIES,
  CAPABILITY_NAMES,
  quotaSignals,
  type CapabilityName,
} from '../../capabilities/registry.js';

describe('capability registry', () => {
  it('exposes a non-empty list of capability names matching the record keys', () => {
    expect(CAPABILITY_NAMES.length).toBeGreaterThan(0);
    const recordKeys = Object.keys(CAPABILITIES).sort();
    expect([...CAPABILITY_NAMES].sort()).toEqual(recordKeys);
  });

  it('every boolean capability has a defaultEnabled flag', () => {
    for (const name of CAPABILITY_NAMES) {
      const def = CAPABILITIES[name];
      if (def.kind === 'boolean') {
        expect(typeof def.defaultEnabled).toBe('boolean');
      }
    }
  });

  it('every limit/quota capability has a defaultLimit (number or null)', () => {
    for (const name of CAPABILITY_NAMES) {
      const def = CAPABILITIES[name];
      if (def.kind === 'limit' || def.kind === 'quota') {
        expect(def.defaultLimit === null || typeof def.defaultLimit === 'number').toBe(true);
      }
    }
  });

  it('every quota capability carries a signal and a window', () => {
    for (const name of CAPABILITY_NAMES) {
      const def = CAPABILITIES[name];
      if (def.kind === 'quota') {
        const signals = quotaSignals(def);
        expect(signals.length).toBeGreaterThan(0);
        for (const sig of signals) expect(typeof sig).toBe('string');
        expect(['calendar_month', 'point_in_time']).toContain(def.window);
      }
    }
  });

  it('declares the initial v1.0 capability set with correct kinds', () => {
    expect(CAPABILITIES['auth.sso'].kind).toBe('boolean');
    expect(CAPABILITIES['detection.advanced'].kind).toBe('boolean');
    expect(CAPABILITIES['audit.enabled'].kind).toBe('boolean');
    expect(CAPABILITIES['isolation.dedicated'].kind).toBe('boolean');
    expect(CAPABILITIES['alerts.max_rules'].kind).toBe('limit');
    expect(CAPABILITIES['notifications.max_channels'].kind).toBe('limit');
    expect(CAPABILITIES['apikeys.max'].kind).toBe('limit');
    expect(CAPABILITIES['audit.retention_days'].kind).toBe('limit');
    expect(CAPABILITIES['ingestion.max_bytes_monthly'].kind).toBe('quota');
    expect(CAPABILITIES['ingestion.max_events_monthly'].kind).toBe('quota');
    expect(CAPABILITIES['storage.max_bytes'].kind).toBe('quota');
    expect(CAPABILITIES['tracing.max_spans_monthly'].kind).toBe('quota');
    expect(CAPABILITIES['metrics.max_datapoints_monthly'].kind).toBe('quota');
    expect(CAPABILITIES['telemetry.max_bytes_monthly'].kind).toBe('quota');
  });

  it('defaults every quota to null (unlimited) so OSS never blocks', () => {
    const quotas: CapabilityName[] = [
      'ingestion.max_bytes_monthly',
      'ingestion.max_events_monthly',
      'storage.max_bytes',
      'tracing.max_spans_monthly',
      'metrics.max_datapoints_monthly',
      'telemetry.max_bytes_monthly',
    ];
    for (const q of quotas) {
      const def = CAPABILITIES[q];
      if (def.kind === 'quota') {
        expect(def.defaultLimit).toBeNull();
      }
    }
  });

  it('maps quota signals to #212 metering event types', () => {
    const byteQuota = CAPABILITIES['ingestion.max_bytes_monthly'];
    const eventQuota = CAPABILITIES['ingestion.max_events_monthly'];
    const storageQuota = CAPABILITIES['storage.max_bytes'];
    const spanQuota = CAPABILITIES['tracing.max_spans_monthly'];
    if (byteQuota.kind === 'quota') expect(byteQuota.signal).toBe('logs.ingested.bytes');
    if (eventQuota.kind === 'quota') expect(eventQuota.signal).toBe('logs.ingested.events');
    if (storageQuota.kind === 'quota') {
      expect(storageQuota.signal).toBe('storage.snapshot');
      expect(storageQuota.window).toBe('point_in_time');
    }
    if (spanQuota.kind === 'quota') expect(spanQuota.signal).toBe('spans.ingested');
    const metricQuota = CAPABILITIES['metrics.max_datapoints_monthly'];
    if (metricQuota.kind === 'quota') expect(metricQuota.signal).toBe('metrics.ingested.datapoints');
  });
});
