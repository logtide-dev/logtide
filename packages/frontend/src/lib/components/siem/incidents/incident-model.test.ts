import { describe, it, expect } from 'vitest';
import {
  INCIDENT_STATUS_LABEL,
  availableActions,
  parseInboxUrl,
  serializeInboxUrl,
  incidentLastEventAt,
  buildMergedTimeline,
  buildIncidentLogsUrl,
  buildPublishToStatusPageUrl,
  toInboxFilters,
} from './incident-model';

const u = (qs: string) => new URL(`http://x/dashboard/incidents${qs}`);

describe('incident-model', () => {
  it('labels map investigating to Acknowledged', () => {
    expect(INCIDENT_STATUS_LABEL.investigating).toBe('Acknowledged');
    expect(INCIDENT_STATUS_LABEL.false_positive).toBe('False positive');
  });

  it('availableActions: sigma open allows acknowledge, resolve, falsePositive, exportPdf, not publish', () => {
    expect(availableActions({ status: 'open', source: 'sigma' })).toEqual({
      acknowledge: true,
      resolve: true,
      reopen: false,
      falsePositive: true,
      publishToStatusPage: false,
      exportPdf: true,
    });
  });

  it('availableActions: monitor open allows publishToStatusPage, never falsePositive', () => {
    const a = availableActions({ status: 'open', source: 'monitor' });
    expect(a.publishToStatusPage).toBe(true);
    expect(a.falsePositive).toBe(false);
    expect(availableActions({ status: 'investigating', source: 'alert' }).falsePositive).toBe(false);
  });

  it('availableActions: resolved allows reopen only', () => {
    const a = availableActions({ status: 'resolved', source: 'sigma' });
    expect(a.reopen).toBe(true);
    expect(a.acknowledge || a.resolve || a.falsePositive).toBe(false);
  });

  it('parseInboxUrl: no status param gives default [open, investigating]', () => {
    const s = parseInboxUrl(u(''), null);
    expect(s.status).toEqual(['open', 'investigating']);
    expect(s.assignee).toBe('anyone');
    expect(s.page).toBe(1);
  });

  it('parseInboxUrl: status=all gives all', () => {
    expect(parseInboxUrl(u('?status=all'), null).status).toBe('all');
  });

  it('parseInboxUrl: legacy repeated status and projectId, unknown values dropped, page clamped to >= 1', () => {
    const s = parseInboxUrl(
      u('?status=resolved&status=bogus&status=open&projectId=p1&source=nope&source=alert&severity=high&page=-3'),
      null
    );
    expect(s.status).toEqual(['resolved', 'open']);
    expect(s.projectIds).toEqual(['p1']);
    expect(s.source).toEqual(['alert']);
    expect(s.severity).toEqual(['high']);
    expect(s.page).toBe(1);
    expect(parseInboxUrl(u('?status=bogus'), null).status).toEqual(['open', 'investigating']);
  });

  it('parseInboxUrl maps the current user id to me', () => {
    expect(parseInboxUrl(u('?assignee=me'), null).assignee).toBe('me');
    expect(parseInboxUrl(u('?assignee=abc'), 'abc').assignee).toBe('me');
    expect(parseInboxUrl(u('?assignee=zzz'), 'abc').assignee).toBe('anyone');
  });

  it('serializeInboxUrl omits defaults and round-trips', () => {
    const base = u('?range=7d');
    const def = serializeInboxUrl(parseInboxUrl(u(''), null), base);
    expect(def.search).toBe('?range=7d');
    const state = parseInboxUrl(
      u('?project=p1,p2&status=all&severity=high,critical&source=alert&assignee=unassigned&service=api&technique=T1&ruleId=r1&page=3'),
      null
    );
    const out = serializeInboxUrl(state, base);
    expect(out.searchParams.get('range')).toBe('7d');
    expect(parseInboxUrl(out, null)).toEqual(state);
  });

  it('toInboxFilters builds offset and assignee', () => {
    const f = toInboxFilters(parseInboxUrl(u('?status=all&assignee=me&page=3'), null), 'o1', 25);
    expect(f.status).toBeUndefined();
    expect(f.offset).toBe(50);
    expect(f.limit).toBe(25);
    expect(f.assignee).toEqual({ kind: 'me' });
  });

  it('incidentLastEventAt falls back to timeWindowEnd then updatedAt', () => {
    expect(incidentLastEventAt({ lastEventAt: 'a', timeWindowEnd: 'b', updatedAt: 'c' })).toBe('a');
    expect(incidentLastEventAt({ timeWindowEnd: 'b', updatedAt: 'c' })).toBe('b');
    expect(incidentLastEventAt({ timeWindowEnd: null, updatedAt: 'c' })).toBe('c');
  });

  it('buildMergedTimeline orders detections, comments and history newest first and tolerates missing sourceEvents', () => {
    const t = buildMergedTimeline({
      detections: [{ id: 'd1', time: '2026-01-01T10:00:00Z' } as never],
      comments: [{ id: 'c1', createdAt: '2026-01-01T12:00:00Z' } as never],
      history: [
        { id: 'h1', action: 'status_change', createdAt: '2026-01-01T11:00:00Z' } as never,
        { id: 'h2', action: 'source_event', createdAt: '2026-01-01T13:00:00Z' } as never,
      ],
    });
    expect(t.map((e) => e.id)).toEqual(['c-c1', 'h-h1', 'd-d1']);
  });

  it('buildMergedTimeline includes source events and drops duplicated created rows', () => {
    const t = buildMergedTimeline({
      detections: [],
      comments: [],
      history: [{ id: 'h1', action: 'created', createdAt: '2026-01-01T09:00:00Z' } as never],
      sourceEvents: [
        { id: 'e1', kind: 'alert_trigger', time: '2026-01-01T09:00:00Z', summary: 's' },
        { id: 'e2', kind: 'monitor_check', time: '2026-01-01T10:00:00Z', summary: 's' },
      ],
    });
    expect(t.map((e) => e.kind)).toEqual(['monitor_check', 'alert_trigger']);
  });

  it('buildIncidentLogsUrl for sigma uses window from timeWindowStart/End, project, trace:<id> and service clauses', () => {
    const url = new URL(
      'http://x' +
        buildIncidentLogsUrl({
          projectId: 'p1',
          traceId: 'abc123',
          affectedServices: ['api', 'my svc'],
          timeWindowStart: '2026-01-01T10:00:00.000Z',
          timeWindowEnd: '2026-01-01T11:00:00.000Z',
          createdAt: '2026-01-01T12:00:00.000Z',
        })
    );
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-01-01T10:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-01-01T11:00:00.000Z');
    expect(url.searchParams.get('q')).toBe('trace:abc123 service:(api OR "my svc")');
  });

  it('buildIncidentLogsUrl falls back to createdAt +/- 30 min', () => {
    const url = new URL(
      'http://x' +
        buildIncidentLogsUrl({
          projectId: null,
          traceId: null,
          affectedServices: null,
          timeWindowStart: null,
          timeWindowEnd: null,
          createdAt: '2026-01-01T12:00:00.000Z',
        })
    );
    expect(url.searchParams.get('from')).toBe('2026-01-01T11:30:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-01-01T12:30:00.000Z');
    expect(url.searchParams.has('project')).toBe(false);
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('buildPublishToStatusPageUrl emits the W12 contract with encoded title and message', () => {
    const base = {
      id: 'i1',
      projectId: 'p1',
      title: 'API down & slow',
      description: 'We are looking',
      monitorId: 'm1',
    };
    const url = new URL('http://x' + buildPublishToStatusPageUrl({ ...base, severity: 'high' }));
    expect(url.pathname).toBe('/dashboard/uptime');
    expect([...url.searchParams.keys()]).toEqual([
      'tab',
      'create',
      'project',
      'title',
      'severity',
      'message',
      'monitorIds',
      'sourceIncidentId',
    ]);
    expect(url.searchParams.get('tab')).toBe('status-updates');
    expect(url.searchParams.get('create')).toBe('1');
    expect(url.searchParams.get('title')).toBe('API down & slow');
    expect(url.searchParams.get('severity')).toBe('major');
    expect(url.searchParams.get('monitorIds')).toBe('m1');
    expect(url.searchParams.get('sourceIncidentId')).toBe('i1');
    expect(buildPublishToStatusPageUrl({ ...base, severity: 'critical' })).toContain('severity=critical');
    expect(buildPublishToStatusPageUrl({ ...base, severity: 'low' })).toContain('severity=minor');
    expect(buildPublishToStatusPageUrl({ ...base, severity: 'low' })).not.toContain('API down & slow');
  });
});

describe('detail view helpers', () => {
  it('describeHistoryEntry labels statuses with Acknowledged and accepts both spellings', async () => {
    const { describeHistoryEntry } = await import('./incident-model');
    const row = { fieldName: null, metadata: null, oldValue: 'open', newValue: 'investigating' };
    expect(describeHistoryEntry({ ...row, action: 'status_change' })).toBe('Status changed from Open to Acknowledged');
    expect(describeHistoryEntry({ ...row, action: 'status_changed' })).toBe('Status changed from Open to Acknowledged');
    expect(describeHistoryEntry({ ...row, action: 'created' })).toBe('Incident created');
    expect(describeHistoryEntry({ ...row, action: 'assignment_change', newValue: null })).toBe('Assignee removed');
  });

  it('formatIncidentDuration picks the largest unit and handles ongoing', async () => {
    const { formatIncidentDuration } = await import('./incident-model');
    expect(formatIncidentDuration('2026-10-22T10:00:00Z', null)).toBe('Ongoing');
    expect(formatIncidentDuration('2026-10-22T10:00:00Z', '2026-10-22T10:01:00Z')).toBe('1 minute');
    expect(formatIncidentDuration('2026-10-22T10:00:00Z', '2026-10-22T12:30:00Z')).toBe('2 hours');
    expect(formatIncidentDuration('2026-10-22T10:00:00Z', '2026-10-25T10:00:00Z')).toBe('3 days');
  });
});
