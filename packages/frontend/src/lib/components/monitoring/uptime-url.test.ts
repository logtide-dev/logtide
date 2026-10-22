import { describe, it, expect } from 'vitest';
import { normalizeStatusSeverity, parseUptimeUrl, writeUptimeUrl } from './uptime-url';

const u = (qs: string) => new URL(`http://localhost/dashboard/uptime${qs}`);

describe('parseUptimeUrl', () => {
  it('defaults to monitors and ignores an unknown tab', () => {
    expect(parseUptimeUrl(u('')).tab).toBe('monitors');
    expect(parseUptimeUrl(u('?tab=nope')).tab).toBe('monitors');
    expect(parseUptimeUrl(u('?tab=status-page')).tab).toBe('status-page');
  });

  it('reads status filter, search and create', () => {
    const s = parseUptimeUrl(u('?status=down&q=api&create=1'));
    expect(s.status).toBe('down');
    expect(s.q).toBe('api');
    expect(s.create).toBe(true);
    expect(s.prefill).toBeNull();
    expect(parseUptimeUrl(u('?status=bogus')).status).toBe('all');
  });

  it('reads the publish prefill (create=1, title, severity=high, monitorIds a,b, sourceIncidentId)', () => {
    const s = parseUptimeUrl(
      u('?tab=status-updates&create=1&title=API%20down&severity=high&message=We%20are%20looking&monitorIds=a,b&sourceIncidentId=inc-1')
    );
    expect(s.prefill).toEqual({
      title: 'API down',
      severity: 'major',
      message: 'We are looking',
      monitorIds: ['a', 'b'],
      sourceIncidentId: 'inc-1',
    });
  });

  it('ignores the prefill without create=1', () => {
    expect(parseUptimeUrl(u('?tab=status-updates&title=x')).prefill).toBeNull();
  });
});

describe('normalizeStatusSeverity', () => {
  it('maps high to major', () => {
    expect(normalizeStatusSeverity('critical')).toBe('critical');
    expect(normalizeStatusSeverity('high')).toBe('major');
    expect(normalizeStatusSeverity('major')).toBe('major');
    expect(normalizeStatusSeverity('medium')).toBe('minor');
    expect(normalizeStatusSeverity('weird')).toBe('minor');
  });
});

describe('writeUptimeUrl', () => {
  it('drops defaults and keeps unrelated params', () => {
    const next = writeUptimeUrl(u('?project=p1&tab=maintenance'), { tab: 'monitors', status: 'all', q: '' });
    expect(next.search).toBe('?project=p1');
  });

  it('switching tab closes the dialog and clears the prefill', () => {
    const next = writeUptimeUrl(u('?tab=status-updates&create=1&title=x&monitorIds=a'), { tab: 'maintenance' });
    expect(next.searchParams.get('tab')).toBe('maintenance');
    expect(next.searchParams.has('create')).toBe(false);
    expect(next.searchParams.has('title')).toBe(false);
  });

  it('sets create without touching the tab', () => {
    const next = writeUptimeUrl(u('?tab=maintenance'), { create: true });
    expect(next.searchParams.get('create')).toBe('1');
    expect(next.searchParams.get('tab')).toBe('maintenance');
  });
});
