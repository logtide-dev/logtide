import { describe, it, expect } from 'vitest';
import { parseAttrFilters } from '../../../modules/traces/attr-filters.js';

describe('parseAttrFilters', () => {
  it('returns an empty list for undefined and blank input', () => {
    expect(parseAttrFilters(undefined)).toEqual({ ok: true, filters: [] });
    expect(parseAttrFilters('')).toEqual({ ok: true, filters: [] });
    expect(parseAttrFilters('   ')).toEqual({ ok: true, filters: [] });
  });

  it('maps equals, not_equals, contains, exists, in and not_in to metadata filters', () => {
    const res = parseAttrFilters(
      'http.method:GET -http.status_code:500 http.route:(a OR b) -env:(x OR y) region:*eu* user.id:*'
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.filters).toHaveLength(6);
    expect(res.filters[0]).toMatchObject({ key: 'http.method', op: 'equals', value: 'GET' });
    expect(res.filters[1]).toMatchObject({
      key: 'http.status_code',
      op: 'not_equals',
      value: '500',
      include_missing: true,
    });
    expect(res.filters[2]).toMatchObject({ key: 'http.route', op: 'in', values: ['a', 'b'] });
    expect(res.filters[3]).toMatchObject({ key: 'env', op: 'not_in', values: ['x', 'y'], include_missing: true });
    expect(res.filters[4]).toMatchObject({ key: 'region', op: 'contains', value: 'eu' });
    expect(res.filters[5]).toMatchObject({ key: 'user.id', op: 'exists' });
  });

  it('rejects free text with its position', () => {
    const res = parseAttrFilters('timeout');
    expect(res).toMatchObject({ ok: false, position: 0 });
    const res2 = parseAttrFilters('http.method:GET timeout');
    expect(res2).toMatchObject({ ok: false, position: 16 });
  });

  it('rejects built-in keys such as service:api', () => {
    const res = parseAttrFilters('http.method:GET service:api');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('service and operation filters');
    expect(res.position).toBe(16);
  });

  it('rejects more than 10 clauses', () => {
    const attr = Array.from({ length: 11 }, (_, i) => `k${i}:v`).join(' ');
    const res = parseAttrFilters(attr);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.position).toBe(0);
  });

  it('reports an unbalanced quote with a position', () => {
    const res = parseAttrFilters('x:"unclosed');
    expect(res).toMatchObject({ ok: false, position: 2 });
  });
});
