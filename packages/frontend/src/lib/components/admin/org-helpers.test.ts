import { describe, it, expect } from 'vitest';
import { createLatestGuard } from './latest-request';
import { buildOrgListSearch, parseOrgListParams, sortToApi, DEFAULT_ORG_SORT } from './org-list-params';
import {
  entitlementMeta,
  entitlementUnitText,
  groupEntitlementRows,
  isBytesMetric,
  metricLabel,
} from './admin-labels';

describe('org list params', () => {
  it('reads q, page, sort and order', () => {
    const p = parseOrgListParams(new URLSearchParams('q=acme&page=3&sort=members&order=asc'));
    expect(p).toEqual({ q: 'acme', page: 3, sort: { key: 'members', dir: 'asc' } });
  });

  it('falls back to defaults for junk values', () => {
    const p = parseOrgListParams(new URLSearchParams('page=-2&sort=drop_table&order=sideways'));
    expect(p).toEqual({ q: '', page: 1, sort: DEFAULT_ORG_SORT });
  });

  it('omits defaults from the URL and round-trips the rest', () => {
    expect(buildOrgListSearch({ q: '', page: 1, sort: DEFAULT_ORG_SORT })).toBe('');
    const state = { q: 'a b', page: 2, sort: { key: 'name', dir: 'asc' as const } };
    const search = buildOrgListSearch(state);
    expect(parseOrgListParams(new URLSearchParams(search))).toEqual(state);
  });

  it('maps table sort to API options', () => {
    expect(sortToApi({ key: 'projects', dir: 'desc' })).toEqual({ sort: 'projects', order: 'desc' });
    expect(sortToApi(undefined)).toEqual({ sort: 'created_at', order: 'desc' });
    expect(sortToApi({ key: 'owner', dir: 'asc' })).toEqual({ sort: 'created_at', order: 'asc' });
  });
});

describe('latest request guard', () => {
  it('only the newest ticket is current', () => {
    const g = createLatestGuard();
    const a = g.begin();
    const b = g.begin();
    expect(g.isCurrent(a)).toBe(false);
    expect(g.isCurrent(b)).toBe(true);
    g.cancel();
    expect(g.isCurrent(b)).toBe(false);
  });
});

describe('labels', () => {
  it('knows capability labels and units', () => {
    expect(entitlementMeta('projects.max').label).toBe('Active projects');
    expect(entitlementUnitText(entitlementMeta('audit.retention_days').unit)).toBe('days');
  });

  it('falls back to the raw key', () => {
    expect(entitlementMeta('future.thing', 'limit').label).toBe('future.thing');
    expect(entitlementMeta('constructor').label).toBe('constructor');
  });

  it('groups rows in display order and drops empty groups', () => {
    const groups = groupEntitlementRows([
      { capability: 'storage.max_bytes', kind: 'quota' as const },
      { capability: 'auth.sso', kind: 'boolean' as const },
      { capability: 'x.unknown', kind: 'limit' as const },
    ]);
    expect(groups.map((g) => g.id)).toEqual(['access', 'workspace', 'quotas']);
  });

  it('labels metering types and keeps unknown ids', () => {
    expect(metricLabel('logs.ingested.events')).toBe('Log events ingested');
    expect(metricLabel('weird.type')).toBe('weird.type');
    expect(isBytesMetric('spans.ingested.bytes')).toBe(true);
    expect(isBytesMetric('spans.ingested')).toBe(false);
  });
});
