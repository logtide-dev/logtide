import { describe, it, expect } from 'vitest';
import { clampPage, clearedState, hasActiveFilters, matchesInbox, summarizeBulk } from './inbox-controller';
import { parseInboxUrl } from './incident-model';

const state = (qs = '') => parseInboxUrl(new URL(`http://x/dashboard/incidents${qs}`), 'me-id');
const inc = (extra: Record<string, unknown> = {}) =>
  ({ id: 'i', status: 'open', severity: 'high', source: 'alert', projectId: null, assigneeId: null, ...extra }) as never;

describe('inbox-controller', () => {
  it('hasActiveFilters is false at defaults and true otherwise', () => {
    expect(hasActiveFilters(state())).toBe(false);
    expect(hasActiveFilters(state('?status=all'))).toBe(true);
    expect(hasActiveFilters(state('?source=alert'))).toBe(true);
    expect(hasActiveFilters(clearedState(state('?source=alert&ruleId=r')))).toBe(false);
  });

  it('clampPage keeps the page within range', () => {
    expect(clampPage(9, 30, 25)).toBe(2);
    expect(clampPage(0, 0, 25)).toBe(1);
  });

  it('matchesInbox applies status, source, project and assignee', () => {
    expect(matchesInbox(inc(), state(), 'me-id')).toBe(true);
    expect(matchesInbox(inc({ status: 'resolved' }), state(), 'me-id')).toBe(false);
    expect(matchesInbox(inc({ status: 'resolved' }), state('?status=all'), 'me-id')).toBe(true);
    expect(matchesInbox(inc({ source: 'monitor' }), state('?source=alert'), 'me-id')).toBe(false);
    expect(matchesInbox(inc({ projectId: null }), state('?project=p1'), 'me-id')).toBe(false);
    expect(matchesInbox(inc({ projectId: 'p1' }), state('?project=p1'), 'me-id')).toBe(true);
    expect(matchesInbox(inc({ assigneeId: 'x' }), state('?assignee=unassigned'), 'me-id')).toBe(false);
    expect(matchesInbox(inc({ assigneeId: 'me-id' }), state('?assignee=me'), 'me-id')).toBe(true);
  });

  it('matchesInbox rejects on later pages and with a rule filter', () => {
    expect(matchesInbox(inc(), state('?page=2'), null)).toBe(false);
    expect(matchesInbox(inc(), state('?ruleId=r1'), null)).toBe(false);
  });

  it('summarizeBulk reports full success', () => {
    const o = summarizeBulk('resolve', undefined, ['a', 'b'], { updated: [{ id: 'a' }, { id: 'b' }], skipped: [] }, () => 't');
    expect(o.tone).toBe('success');
    expect(o.message).toBe('Resolved 2 incidents');
    const one = summarizeBulk('assign', null, ['a'], { updated: [{ id: 'a' }], skipped: [] }, () => 't');
    expect(one.message).toBe('Unassigned 1 incident');
  });

  it('summarizeBulk names failures and counts ids the server did not mention', () => {
    const o = summarizeBulk(
      'acknowledge',
      undefined,
      ['a', 'b', 'c', 'd', 'e', 'f'],
      { updated: [{ id: 'a' }], skipped: [{ id: 'b', reason: 'invalid_transition' }] },
      (id) => `T-${id}`
    );
    expect(o.tone).toBe('warning');
    expect(o.updated).toBe(1);
    expect(o.skipped).toHaveLength(5);
    expect(o.message).toContain('1 of 6 updated');
    expect(o.message).toContain('T-b (cannot change from its current status)');
    expect(o.message).toContain('and 2 more');
  });
});
