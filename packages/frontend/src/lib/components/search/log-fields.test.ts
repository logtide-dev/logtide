import { describe, it, expect } from 'vitest';
import {
  activeProjectKey,
  detailsMetadata,
  logBreadcrumbs,
  logHostname,
  metadataFilterValue,
  rowKey,
} from './log-fields';
import { makeLog } from './test-fixtures';

describe('logHostname', () => {
  it('reads the host from the top-level field, then metadata', () => {
    expect(logHostname(makeLog({ hostname: 'h1', metadata: { hostname: 'h2' } }))).toBe('h1');
    expect(logHostname(makeLog({ metadata: { hostname: 'h2' } }))).toBe('h2');
    expect(logHostname(makeLog({ metadata: { hostname: 42 } }))).toBeNull();
  });

  it('falls back when the top-level field is null or empty', () => {
    expect(logHostname(makeLog({ hostname: null, metadata: { hostname: 'h2' } }))).toBe('h2');
    expect(logHostname(makeLog({ hostname: '', metadata: { hostname: 'h2' } }))).toBe('h2');
  });

  it('is null without metadata', () => {
    expect(logHostname(makeLog({ metadata: null }))).toBeNull();
    expect(logHostname(makeLog({ metadata: undefined }))).toBeNull();
    expect(logHostname(makeLog({ metadata: { hostname: '' } }))).toBeNull();
  });
});

describe('metadataFilterValue', () => {
  it('metadataFilterValue keeps scalars only', () => {
    expect(metadataFilterValue('a')).toBe('a');
    expect(metadataFilterValue(42)).toBe('42');
    expect(metadataFilterValue(true)).toBe('true');
    expect(metadataFilterValue(false)).toBe('false');
    expect(metadataFilterValue(null)).toBeNull();
    expect(metadataFilterValue(undefined)).toBeNull();
    expect(metadataFilterValue({})).toBeNull();
    expect(metadataFilterValue([])).toBeNull();
  });

  it('refuses non-finite numbers', () => {
    expect(metadataFilterValue(Number.NaN)).toBeNull();
    expect(metadataFilterValue(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('detailsMetadata', () => {
  it('detailsMetadata drops breadcrumbs and empty or non-object metadata', () => {
    expect(detailsMetadata({ a: 1, breadcrumbs: [] })).toEqual({ a: 1 });
    expect(detailsMetadata(null)).toBeNull();
    expect(detailsMetadata('x')).toBeNull();
    expect(detailsMetadata({})).toBeNull();
    expect(detailsMetadata({ breadcrumbs: [] })).toBeNull();
    expect(detailsMetadata([1, 2])).toBeNull();
  });

  it('does not mutate the input', () => {
    const metadata = { a: 1, breadcrumbs: [] };
    detailsMetadata(metadata);
    expect(metadata).toEqual({ a: 1, breadcrumbs: [] });
  });
});

describe('logBreadcrumbs', () => {
  it('returns metadata.breadcrumbs when it is an array', () => {
    const crumbs = [{ type: 'http', message: 'GET /', timestamp: 1 }];
    expect(logBreadcrumbs(makeLog({ metadata: { breadcrumbs: crumbs } }))).toEqual(crumbs);
  });

  it('returns an empty list otherwise', () => {
    expect(logBreadcrumbs(makeLog({ metadata: null }))).toEqual([]);
    expect(logBreadcrumbs(makeLog({ metadata: { breadcrumbs: 'x' } }))).toEqual([]);
    expect(logBreadcrumbs(makeLog({ metadata: {} }))).toEqual([]);
  });
});

describe('activeProjectKey', () => {
  it('activeProjectKey uses the first project', () => {
    expect(activeProjectKey([])).toBeNull();
    expect(activeProjectKey(['p2', 'p1'])).toBe('p2');
  });
});

describe('rowKey', () => {
  it('uses the log id, else time and index', () => {
    expect(rowKey(makeLog({ id: 'L1' }), 3)).toBe('L1');
    expect(rowKey(makeLog({ id: undefined, time: '2026-10-21T10:00:00.000Z' }), 3)).toBe('2026-10-21T10:00:00.000Z-3');
  });
});
