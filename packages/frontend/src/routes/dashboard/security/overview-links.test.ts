import { describe, it, expect } from 'vitest';
import { incidentsLink, detectionLink, toSecurityRange } from './overview-links';

describe('incidentsLink', () => {
  it('encodes ruleId and keeps source=sigma first', () => {
    const url = incidentsLink({ ruleId: 'a b/c' });
    expect(url.startsWith('/dashboard/incidents?source=sigma&')).toBe(true);
    expect(url).toContain('ruleId=a+b%2Fc');
  });

  it('combines service and technique params', () => {
    const url = new URL(incidentsLink({ service: 'api', technique: 'T1059.001' }), 'http://x');
    expect(url.searchParams.get('source')).toBe('sigma');
    expect(url.searchParams.get('service')).toBe('api');
    expect(url.searchParams.get('technique')).toBe('T1059.001');
    expect(url.searchParams.has('ruleId')).toBe(false);
  });

  it('returns just the source filter for an empty filter', () => {
    expect(incidentsLink({})).toBe('/dashboard/incidents?source=sigma');
  });
});

describe('detectionLink', () => {
  const base = { logId: 'log-1', projectId: 'p-1', time: '2026-10-01T10:00:00.000Z' };

  it('prefers the incident', () => {
    expect(detectionLink({ ...base, incidentId: 'inc-1' })).toBe('/dashboard/incidents/inc-1');
  });

  it('builds a five minute log window', () => {
    const url = new URL(detectionLink({ ...base, incidentId: null }) as string, 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('logId')).toBe('log-1');
    expect(url.searchParams.get('project')).toBe('p-1');
    expect(url.searchParams.get('from')).toBe('2026-10-01T09:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-01T10:05:00.000Z');
  });

  it('omits project when null', () => {
    const url = new URL(detectionLink({ ...base, projectId: null, incidentId: null }) as string, 'http://x');
    expect(url.searchParams.has('project')).toBe(false);
  });

  it('is null without a logId', () => {
    expect(detectionLink({ ...base, logId: '', incidentId: null })).toBeNull();
  });
});

describe('toSecurityRange', () => {
  const preset = (p: string) => ({ kind: 'preset', preset: p }) as never;

  it('keeps 24h, 7d and 30d', () => {
    expect(toSecurityRange(preset('24h'))).toBe('24h');
    expect(toSecurityRange(preset('7d'))).toBe('7d');
    expect(toSecurityRange(preset('30d'))).toBe('30d');
  });

  it('maps 6h to 24h, 3d to 7d, 14d to 30d', () => {
    expect(toSecurityRange(preset('6h'))).toBe('24h');
    expect(toSecurityRange(preset('3d'))).toBe('7d');
    expect(toSecurityRange(preset('14d'))).toBe('30d');
  });

  it('maps custom spans to the smallest covering range', () => {
    const day = 24 * 3600 * 1000;
    const from = new Date('2026-08-01T00:00:00Z');
    const mk = (days: number) => ({
      kind: 'custom' as const,
      from: from.toISOString(),
      to: new Date(from.getTime() + days * day).toISOString(),
    });
    expect(toSecurityRange(mk(40))).toBe('30d');
    expect(toSecurityRange(mk(5))).toBe('7d');
    expect(toSecurityRange(mk(0.5))).toBe('24h');
  });
});
