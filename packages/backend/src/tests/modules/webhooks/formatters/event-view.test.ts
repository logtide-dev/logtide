import { describe, it, expect } from 'vitest';
import { describeEvent, rawJsonFallback } from '../../../../modules/webhooks/formatters/event-view.js';

function envelope(type: string, data: Record<string, unknown>) {
  return {
    id: 'evt_1',
    type,
    version: 1,
    occurredAt: '2026-08-10T09:19:12.000Z',
    organizationId: 'org-1',
    projectId: null,
    data,
  };
}

const monitor = (status: string) =>
  envelope('monitor.status_changed', {
    status,
    severity: 'critical',
    title: `Monitor ${status}: api-prod`,
    organization: { name: 'Acme' },
    target: 'https://api.example.com/health',
    consecutive_failures: 3,
    link: 'https://app.logtide.dev/dashboard/uptime',
  });

describe('describeEvent', () => {
  it('describes a monitor down event as critical with fields', () => {
    const view = describeEvent(monitor('down'))!;
    expect(view.tone).toBe('critical');
    const names = view.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Status', 'Target', 'Consecutive failures']));
    expect(view.link).toBe('https://app.logtide.dev/dashboard/uptime');
    expect(view.orgName).toBe('Acme');
    expect(view.occurredAt).toBe('2026-08-10T09:19:12.000Z');
  });

  it('turns a recovery into success', () => {
    expect(describeEvent(monitor('up'))!.tone).toBe('success');
  });

  it('describes alert.triggered', () => {
    const view = describeEvent(
      envelope('alert.triggered', { alert_name: 'API 5xx', log_count: 12, threshold: 10, time_window: 5 })
    )!;
    expect(view.title).toBe('Alert triggered: API 5xx');
    expect(view.description).toBe('12 logs in 5 min (threshold: 10)');
    expect(view.fields).toContainEqual({ name: 'Time window', value: '5 min' });
    expect(view.tone).toBe('high');
  });

  it('describes alert.resolved', () => {
    const view = describeEvent(
      envelope('alert.resolved', { alert_name: 'API 5xx', message: 'back to normal' })
    )!;
    expect(view.title).toBe('Alert resolved: API 5xx');
    expect(view.tone).toBe('success');
    expect(view.description).toBe('back to normal');
    expect(describeEvent(envelope('alert.resolved', {}))!.title).toBe('Alert resolved: unnamed rule');
  });

  it('humanizes unknown types and lists up to five metadata fields', () => {
    const view = describeEvent(
      envelope('thing.happened', { metadata: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } })
    )!;
    expect(view.title).toBe('Thing happened');
    expect(view.fields).toHaveLength(5);
  });

  it('renders numeric values as plain strings', () => {
    const view = describeEvent(monitor('down'))!;
    expect(view.fields.find((f) => f.name === 'Consecutive failures')!.value).toBe('3');
  });

  it('returns null for bodies that are not envelopes', () => {
    expect(describeEvent('x')).toBeNull();
    expect(describeEvent({ type: 1 })).toBeNull();
    expect(describeEvent(null)).toBeNull();
  });
});

describe('rawJsonFallback', () => {
  it('pretty prints and survives circular input', () => {
    expect(rawJsonFallback({ a: 1 })).toBe('{\n  "a": 1\n}');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(typeof rawJsonFallback(loop)).toBe('string');
  });
});
