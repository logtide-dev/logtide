import { describe, it, expect } from 'vitest';
import type { MetricExplorerQuery } from '@logtide/shared';
import {
  decodeExplorerQuery,
  defaultDisplayFor,
  defaultExplorerQuery,
  encodeExplorerQuery,
  isSourceAttribute,
  readExplorerQuery,
  sanitizeExplorerQuery,
  writeExplorerQuery,
} from './metrics-explorer-url';

const full: MetricExplorerQuery = {
  projectIds: ['p1', 'p2'],
  queries: [
    {
      id: 'A',
      metricName: 'system.cpu.utilization.total',
      aggregation: 'avg',
      spaceAggregation: 'max',
      filters: [
        { scope: 'resource', key: 'host.name', op: 'in', values: ['web-1', 'caffè'] },
        { scope: 'metric', key: 'state', op: 'exists' },
      ],
      groupBy: [{ scope: 'resource', key: 'host.name' }],
      limit: 5,
      label: 'CPU',
    },
    { id: 'B', metricName: 'x', aggregation: 'rate', filters: [], groupBy: [], hidden: true },
  ],
  formulas: [{ id: 'F1', expression: 'A / B * 100', label: 'ratio' }],
  interval: '5m',
  compareTo: '1d',
  display: 'split',
  unitOverride: 'By',
};

describe('metrics explorer url codec', () => {
  it('round trips a full query', () => {
    expect(decodeExplorerQuery(encodeExplorerQuery(full))).toEqual(full);
  });

  it('round trips the default query', () => {
    const d = defaultExplorerQuery();
    expect(decodeExplorerQuery(encodeExplorerQuery(d))).toEqual(d);
  });

  it('produces url safe output', () => {
    expect(encodeExplorerQuery(full)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is compact for defaults', () => {
    expect(encodeExplorerQuery(defaultExplorerQuery()).length).toBeLessThan(120);
  });

  it('returns null for missing or garbage input', () => {
    expect(decodeExplorerQuery(null)).toBeNull();
    expect(decodeExplorerQuery('')).toBeNull();
    expect(decodeExplorerQuery('!!!not base64')).toBeNull();
    expect(decodeExplorerQuery(btoa('not json'))).toBeNull();
    expect(decodeExplorerQuery('x'.repeat(20_000))).toBeNull();
  });

  it('readExplorerQuery falls back to defaults', () => {
    expect(readExplorerQuery(new URLSearchParams('q=%%%'))).toEqual(defaultExplorerQuery());
    expect(readExplorerQuery(new URLSearchParams(''))).toEqual(defaultExplorerQuery());
  });

  it('writeExplorerQuery keeps other params and does not mutate', () => {
    const base = new URLSearchParams('range=1h');
    const next = writeExplorerQuery(base, full);
    expect(next.get('range')).toBe('1h');
    expect(readExplorerQuery(next)).toEqual(full);
    expect(base.has('q')).toBe(false);
  });
});

describe('sanitizeExplorerQuery', () => {
  it('defaults non objects', () => {
    expect(sanitizeExplorerQuery(null)).toEqual(defaultExplorerQuery());
    expect(sanitizeExplorerQuery('x')).toEqual(defaultExplorerQuery());
  });

  it('replaces invalid enums and keeps one query', () => {
    const q = sanitizeExplorerQuery({
      queries: [{ id: 'A', metricName: 'm', aggregation: 'bogus' }],
      interval: '3y',
      compareTo: 'yesterday',
      display: 'pie',
    });
    expect(q.queries[0].aggregation).toBe('avg');
    expect(q.interval).toBe('auto');
    expect(q.compareTo).toBe('none');
    expect(q.display).toBe('lines');
  });

  it('infers split display when missing and grouped by a source attribute', () => {
    const q = sanitizeExplorerQuery({
      queries: [{ id: 'A', metricName: 'm', groupBy: [{ scope: 'resource', key: 'host.name' }] }],
    });
    expect(q.display).toBe('split');
  });

  it('caps queries, formulas, group bys, filters and limit', () => {
    const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
    const q = sanitizeExplorerQuery({
      queries: many(9, (i) => ({
        id: 'A',
        metricName: `m${i}`,
        limit: 999,
        groupBy: many(6, (j) => ({ scope: 'metric', key: `k${j}` })),
        filters: many(15, (j) => ({ scope: 'metric', key: `k${j}`, op: 'exists' })),
      })),
      formulas: many(7, () => ({ id: 'F1', expression: 'A' })),
    });
    expect(q.queries).toHaveLength(6);
    expect(new Set(q.queries.map((s) => s.id)).size).toBe(6);
    expect(q.queries[0].groupBy).toHaveLength(3);
    expect(q.queries[0].filters).toHaveLength(10);
    expect(q.queries[0].limit).toBe(50);
    expect(q.formulas).toHaveLength(4);
    expect(new Set(q.formulas.map((f) => f.id)).size).toBe(4);
  });

  it('drops invalid filters and refs', () => {
    const q = sanitizeExplorerQuery({
      queries: [
        {
          id: 'A',
          metricName: 'm',
          filters: [{ scope: 'metric', key: 'a', op: 'like' }, { scope: 'weird', key: 'a', op: 'eq' }, 5],
          groupBy: [{ scope: 'metric', key: '' }],
        },
      ],
    });
    expect(q.queries[0].filters).toEqual([]);
    expect(q.queries[0].groupBy).toEqual([]);
  });

  it('turns an empty queries list into the default query', () => {
    expect(sanitizeExplorerQuery({ queries: [] }).queries).toHaveLength(1);
  });

  it('normalizes empty projectIds to null', () => {
    expect(sanitizeExplorerQuery({ projectIds: [] }).projectIds).toBeNull();
  });
});

describe('default display rule', () => {
  it('detects source attributes on the resource scope only', () => {
    expect(isSourceAttribute({ scope: 'resource', key: 'host.name' })).toBe(true);
    expect(isSourceAttribute({ scope: 'resource', key: 'service.instance.id' })).toBe(true);
    expect(isSourceAttribute({ scope: 'resource', key: 'container.id' })).toBe(true);
    expect(isSourceAttribute({ scope: 'resource', key: 'k8s.pod.name' })).toBe(true);
    expect(isSourceAttribute({ scope: 'metric', key: 'host.name' })).toBe(false);
    expect(isSourceAttribute({ scope: 'resource', key: 'deployment.environment' })).toBe(false);
  });

  it('picks split or lines', () => {
    expect(defaultDisplayFor([])).toBe('lines');
    expect(defaultDisplayFor([{ scope: 'metric', key: 'state' }])).toBe('lines');
    expect(defaultDisplayFor([{ scope: 'metric', key: 'state' }, { scope: 'resource', key: 'service.name' }])).toBe('split');
  });
});
