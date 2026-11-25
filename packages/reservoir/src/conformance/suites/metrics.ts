// Metric label conformance: attribute keys are literal keys, dots included
// (`http.request.method`, the OTel norm), for where filters, group by and
// label values alike; a nested object with the same dotted name is not that
// label. Buckets are epoch aligned. Engines order rows and label values
// freely, so results compare sorted.

import { describe, expect, it } from 'vitest';
import { metricAttrLabel, type MetricAggregateParams, type MetricAggregationFn, type MetricAttrFilter, type MetricAttrRef, type MetricSourcesParams } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { METRIC_CPU, METRIC_QUEUE, METRIC_REQUESTS, minutes, PROJECT_A, PROJECT_B, PROJECT_C, WINDOW } from '../corpus.js';

const METHOD = 'http.request.method';
const ADDRESS = 'server.address';

const at = (n: number): string => minutes(n).toISOString();

export function describeMetricsConformance(ctx: ConformanceContext): void {
  describe('metrics', () => {
    const series = async (aggregation: MetricAggregationFn, extra: Partial<MetricAggregateParams>): Promise<string[]> => {
      const { timeseries } = await ctx.subject().aggregateMetrics({
        projectId: PROJECT_A,
        metricName: METRIC_REQUESTS,
        metricType: 'sum',
        from: WINDOW.from,
        to: WINDOW.to,
        interval: '15m',
        aggregation,
        ...extra,
      });
      return timeseries
        .map((b) => [new Date(b.bucket).toISOString(), ...(extra.groupBy ?? []).map((k) => b.labels?.[k] ?? 'NO LABEL'), b.value].join(' '))
        .sort();
    };

    it('MT01 group by a dotted label key', async () => {
      expect(await series('sum', { groupBy: [METHOD] })).toEqual([
        `${at(0)}  100`,
        `${at(0)} GET 17`,
        `${at(0)} POST 5`,
        `${at(15)} GET 3`,
      ]);
    });

    it('MT02 a where filter on a dotted label key', async () => {
      expect(await series('sum', { attributes: { [METHOD]: 'GET' } })).toEqual([`${at(0)} 17`, `${at(15)} 3`]);
    });

    it('MT03 group by two dotted label keys', async () => {
      expect(await series('sum', { groupBy: [METHOD, ADDRESS] })).toEqual([
        `${at(0)}   100`,
        `${at(0)} GET api-1 10`,
        `${at(0)} GET api-2 7`,
        `${at(0)} POST api-1 5`,
        `${at(15)} GET api-1 3`,
      ]);
    });

    it('MT04 a where filter and a group by together', async () => {
      expect(await series('count', { attributes: { [ADDRESS]: 'api-1' }, groupBy: [METHOD] })).toEqual([
        `${at(0)} GET 1`,
        `${at(0)} POST 1`,
        `${at(15)} GET 1`,
      ]);
    });

    it('MT05 label values of a dotted key', async () => {
      const values = async (key: string) =>
        [...((await ctx.subject().getMetricLabelValues({ projectId: PROJECT_A, metricName: METRIC_REQUESTS, ...WINDOW }, key)).values ?? [])].sort();
      expect(await values(METHOD)).toEqual(['GET', 'POST']);
      expect(await values(ADDRESS)).toEqual(['api-1', 'api-2']);
    });

    it('MT06 raw points filtered by a dotted label key', async () => {
      const { metrics, total } = await ctx.subject().queryMetrics({
        projectId: PROJECT_A,
        metricName: METRIC_REQUESTS,
        ...WINDOW,
        attributes: { [ADDRESS]: 'api-2' },
      });
      expect(metrics.map((m) => `${new Date(m.time).toISOString()} ${m.value}`)).toEqual([`${at(3)} 7`]);
      expect(total).toBe(1);
    });

    describeMetricAttrConformance(ctx);
  });
}

// ----------------------------------------------------------------------------
// 1.8 attribute refs, filters, label discovery, names and sources (MT07+)
// ----------------------------------------------------------------------------
// Rulings pinned here: keys are literal (dots included); the text form of a
// value is the string itself, or the JSON scalar of a number or boolean
// (8 -> "8", true -> "true"); null counts as a missing key; objects and
// arrays exist but have no text; neq/nin match points without text;
// in [] matches nothing, nin [] everything; gte/lt compare the number the
// text parses to (booleans and words never match); exists is a present
// non-null key, even an empty string. Corpus rows: corpus.ts SOURCE_ROWS.

const BOTH = [PROJECT_A, PROJECT_B];
const res = (key: string): MetricAttrRef => ({ scope: 'resource', key });
const met = (key: string): MetricAttrRef => ({ scope: 'metric', key });
const f = (ref: MetricAttrRef, op: MetricAttrFilter['op'], ...values: string[]): MetricAttrFilter => ({
  ...ref,
  op,
  ...(values.length > 0 ? { values } : {}),
});
const sorted = (xs: string[]): string[] => [...xs].sort();

type LabelQuery = { projectId: string | string[]; metricName: string; scope?: 'metric' | 'resource'; window?: boolean };

function describeMetricAttrConformance(ctx: ConformanceContext): void {
  /**
   * `<bucket> <label>... <value>` lines, sorted, with the labels named by
   * `groupBy` then `groupByAttrs`; every bucket must carry exactly those labels.
   */
  const lines = async (metricName: string, extra: Partial<MetricAggregateParams>, aggregation: MetricAggregationFn = 'sum'): Promise<string[]> => {
    const { timeseries } = await ctx.subject().aggregateMetrics({
      projectId: BOTH,
      metricName,
      from: WINDOW.from,
      to: WINDOW.to,
      interval: '15m',
      aggregation,
      ...extra,
    });
    const labelKeys = [...(extra.groupBy ?? []), ...(extra.groupByAttrs ?? []).map(metricAttrLabel)];
    for (const b of timeseries) {
      expect(Object.keys(b.labels ?? {}).sort(), 'labels of every bucket').toEqual([...labelKeys].sort());
    }
    return timeseries.map((b) => [new Date(b.bucket).toISOString(), ...labelKeys.map((k) => b.labels?.[k]), b.value].join(' ')).sort();
  };
  const cpu = (filters: MetricAttrFilter[]) => lines(METRIC_CPU, { filters });
  const queue = (filters: MetricAttrFilter[]) => lines(METRIC_QUEUE, { filters });

  it('MT07 group by a resource attribute', async () => {
    expect(await lines(METRIC_CPU, { groupByAttrs: [res('host.name')] })).toEqual(sorted([
      `${at(0)}  60`,
      `${at(0)} host-1 30`,
      `${at(0)} host-2 90`,
      `${at(15)} host-1 30`,
    ]));
    // A number groups by its text form.
    expect(await lines(METRIC_CPU, { groupByAttrs: [res('host.cpus')] }, 'avg')).toEqual(sorted([
      `${at(0)}  60`,
      `${at(0)} 4 45`,
      `${at(0)} 8 15`,
      `${at(15)} 8 30`,
    ]));
    expect(await lines(METRIC_CPU, { projectId: PROJECT_B, groupByAttrs: [res('host.name')] })).toEqual([`${at(0)} host-2 50`]);
  });

  it('MT08 group by a metric attribute: number, numeric string, word and boolean as text', async () => {
    expect(await lines(METRIC_CPU, { groupByAttrs: [met('cpu.core')] })).toEqual(sorted([
      `${at(0)} 0 20`,
      `${at(0)} 1 40`,
      `${at(0)} 2 10`,
      `${at(0)} high 50`,
      `${at(0)} true 60`,
      `${at(15)} 4 30`,
    ]));
  });

  it('MT09 legacy groupBy with resource refs, a nested object is not the dotted key', async () => {
    expect(await lines(METRIC_QUEUE, {
      groupBy: ['queue.name'],
      groupByAttrs: [res('service.name'), res('host.name')],
    })).toEqual(sorted([
      `${at(0)} orders checkout host-1 5`,
      `${at(0)} orders checkout host-2 7`,
      `${at(0)} carts cart host-1 2`,
      `${at(0)} orders checkout  9`,
      `${at(0)} carts cart  4`,
      `${at(15)}  cart host-2 4`,
    ]));
  });

  it('MT10 legacy groupBy uses the text form too', async () => {
    expect(await lines(METRIC_CPU, { groupBy: ['cpu.core'] })).toEqual(sorted([
      `${at(0)} 0 20`,
      `${at(0)} 1 40`,
      `${at(0)} 2 10`,
      `${at(0)} high 50`,
      `${at(0)} true 60`,
      `${at(15)} 4 30`,
    ]));
  });

  it('MT11 eq and neq (neq matches a missing key)', async () => {
    expect(await cpu([f(res('host.name'), 'eq', 'host-1')])).toEqual([`${at(0)} 30`, `${at(15)} 30`]);
    expect(await cpu([f(res('host.name'), 'neq', 'host-1')])).toEqual([`${at(0)} 150`]);
    // Numbers and booleans compare by text.
    expect(await cpu([f(met('cpu.core'), 'eq', '4')])).toEqual([`${at(15)} 30`]);
    expect(await cpu([f(met('cpu.core'), 'eq', 'true')])).toEqual([`${at(0)} 60`]);
    expect(await cpu([f(res('host.cpus'), 'eq', '8')])).toEqual([`${at(0)} 30`, `${at(15)} 30`]);
  });

  it('MT12 in and nin (nin matches a missing key)', async () => {
    expect(await cpu([f(met('cpu.state'), 'in', 'user', 'idle')])).toEqual([`${at(0)} 110`, `${at(15)} 30`]);
    expect(await cpu([f(met('cpu.state'), 'nin', 'user')])).toEqual([`${at(0)} 120`]);
    expect(await cpu([f(met('cpu.state'), 'nin', 'user', 'system', 'idle')])).toEqual([`${at(0)} 60`]);
    expect(await cpu([f(met('cpu.core'), 'in', '0', '1', 'high')])).toEqual([`${at(0)} 110`]);
    expect(await cpu([{ ...met('cpu.state'), op: 'in', values: [] }])).toEqual([]);
    expect(await cpu([{ ...met('cpu.state'), op: 'nin', values: [] }])).toEqual([`${at(0)} 180`, `${at(15)} 30`]);
  });

  it('MT13 exists and notExists (an empty string exists)', async () => {
    expect(await cpu([f(met('cpu.state'), 'exists')])).toEqual([`${at(0)} 120`, `${at(15)} 30`]);
    expect(await cpu([f(met('cpu.state'), 'notExists')])).toEqual([`${at(0)} 60`]);
    // MH6 has cpu.state: null, which is a missing key, so it groups under ''.
    expect(await lines(METRIC_CPU, { groupByAttrs: [met('cpu.state')] })).toEqual(sorted([
      `${at(0)}  60`,
      `${at(0)} idle 50`,
      `${at(0)} system 10`,
      `${at(0)} user 60`,
      `${at(15)} user 30`,
    ]));
    expect(await queue([f(res('host.name'), 'exists')])).toEqual([`${at(0)} 15`, `${at(15)} 4`]);
    expect(await queue([f(res('host.name'), 'notExists')])).toEqual([`${at(0)} 12`]);
  });

  it('MT14 gte and lt compare numbers, non-numeric values never match', async () => {
    expect(await cpu([f(met('cpu.core'), 'gte', '1')])).toEqual([`${at(0)} 50`, `${at(15)} 30`]);
    expect(await cpu([f(met('cpu.core'), 'lt', '2')])).toEqual([`${at(0)} 60`]);
    expect(await cpu([f(met('cpu.core'), 'lt', '100')])).toEqual([`${at(0)} 70`, `${at(15)} 30`]);
    expect(await cpu([f(met('cpu.core'), 'gte', '1.5')])).toEqual([`${at(0)} 10`, `${at(15)} 30`]);
    expect(await cpu([f(met('cpu.state'), 'gte', '0')])).toEqual([]);
    expect(await cpu([f(met('cpu.core'), 'gte', 'abc')])).toEqual([]);
    expect(await cpu([f(met('no.such.key'), 'lt', '100')])).toEqual([]);
  });

  it('MT15 resource and metric filters are ANDed, with legacy attributes and group by', async () => {
    expect(await cpu([f(res('host.name'), 'eq', 'host-1'), f(met('cpu.state'), 'eq', 'user')])).toEqual([`${at(0)} 20`, `${at(15)} 30`]);
    expect(await cpu([f(res('host.cpus'), 'gte', '8'), f(met('cpu.core'), 'lt', '4')])).toEqual([`${at(0)} 30`]);
    expect(await lines(METRIC_QUEUE, {
      filters: [f(res('service.name'), 'eq', 'cart'), f(met('queue.name'), 'neq', 'carts')],
      groupByAttrs: [res('host.name')],
    })).toEqual([`${at(15)} host-2 4`]);
    expect(await lines(METRIC_QUEUE, {
      attributes: { 'queue.name': 'orders' },
      filters: [f(res('host.name'), 'in', 'host-1', 'host-2')],
    })).toEqual([`${at(0)} 12`]);
  });

  it('MT16 keys are literal, scopes are separate, objects exist without text', async () => {
    expect(await queue([f(res('host.name'), 'eq', 'nested-host')])).toEqual([]);
    expect(await queue([f(res('host'), 'exists')])).toEqual([`${at(0)} 3`]);
    expect(await queue([f(res('host'), 'neq', 'x'), f(res('host'), 'exists')])).toEqual([`${at(0)} 3`]);
    expect(await cpu([f(met('host.name'), 'exists')])).toEqual([]);
    expect(await cpu([f(res('cpu.state'), 'exists')])).toEqual([]);
  });

  describe('label discovery', () => {
    const labelParams = (q: LabelQuery) => ({
      projectId: q.projectId,
      metricName: q.metricName,
      ...(q.scope ? { scope: q.scope } : {}),
      ...(q.window === false ? {} : WINDOW),
    });
    const keys = async (q: LabelQuery) => sorted((await ctx.subject().getMetricLabelKeys(labelParams(q))).keys ?? []);
    const values = async (q: LabelQuery, key: string) => sorted((await ctx.subject().getMetricLabelValues(labelParams(q), key)).values ?? []);

    it('MT17 label keys per scope, an empty metric name means every metric', async () => {
      expect(await keys({ projectId: PROJECT_A, metricName: '', scope: 'resource' })).toEqual(['host.cpus', 'host.name', 'service.name']);
      expect(await keys({ projectId: PROJECT_B, metricName: '', scope: 'resource' })).toEqual(['host', 'host.cpus', 'host.name', 'service.name']);
      expect(await keys({ projectId: BOTH, metricName: METRIC_QUEUE, scope: 'resource' })).toEqual(['host', 'host.name', 'service.name']);
      expect(await keys({ projectId: PROJECT_A, metricName: METRIC_CPU })).toEqual(['cpu.core', 'cpu.state']);
      expect(await keys({ projectId: PROJECT_A, metricName: METRIC_CPU, scope: 'metric' })).toEqual(['cpu.core', 'cpu.state']);
      expect(await keys({ projectId: BOTH, metricName: '', scope: 'metric' })).toEqual(
        ['cpu.core', 'cpu.state', 'http', 'http.request.method', 'queue.name', 'server.address'],
      );
    });

    it('MT18 label values as text, empty values dropped', async () => {
      expect(await values({ projectId: BOTH, metricName: '', scope: 'resource' }, 'host.name')).toEqual(['host-1', 'host-2']);
      expect(await values({ projectId: PROJECT_A, metricName: '', scope: 'resource', window: false }, 'host.name')).toEqual(['host-1', 'host-2', 'host-3']);
      expect(await values({ projectId: BOTH, metricName: METRIC_QUEUE, scope: 'resource' }, 'service.name')).toEqual(['cart', 'checkout']);
      expect(await values({ projectId: BOTH, metricName: '', scope: 'resource' }, 'host.cpus')).toEqual(['4', '8']);
      expect(await values({ projectId: [PROJECT_A, PROJECT_B, PROJECT_C], metricName: '', scope: 'resource' }, 'service.name')).toEqual(
        ['cart', 'checkout', 'hw-agent', 'jobs'],
      );
      expect(await values({ projectId: BOTH, metricName: METRIC_CPU }, 'cpu.core')).toEqual(['0', '1', '2', '4', 'high', 'true']);
      expect(await values({ projectId: BOTH, metricName: '' }, 'queue.name')).toEqual(['carts', 'orders']);
    });
  });

  it('MT19 metric names filtered by attributes', async () => {
    const names = async (projectId: string | string[], filters?: MetricAttrFilter[]) =>
      sorted((await ctx.subject().getMetricNames({ projectId, ...WINDOW, ...(filters ? { filters } : {}) })).names.map((n) => n.name));
    expect(await names(BOTH)).toEqual(sorted([METRIC_QUEUE, METRIC_REQUESTS, METRIC_CPU]));
    expect(await names(BOTH, [f(res('host.name'), 'eq', 'host-1')])).toEqual(sorted([METRIC_QUEUE, METRIC_CPU]));
    expect(await names(PROJECT_B, [f(res('service.name'), 'eq', 'cart')])).toEqual([METRIC_QUEUE]);
    expect(await names(BOTH, [f(res('service.name'), 'eq', 'hw-agent'), f(met('cpu.core'), 'gte', '4')])).toEqual([METRIC_CPU]);
    expect(await names(BOTH, [f(res('host.name'), 'eq', 'host-3')])).toEqual([]);
  });

  describe('sources', () => {
    const sources = async (params: Partial<MetricSourcesParams> & Pick<MetricSourcesParams, 'key'>) =>
      (await ctx.subject().getMetricSources({ projectId: BOTH, ...WINDOW, ...params })).sources.map((s) => ({
        value: s.value,
        projectIds: s.projectIds,
        lastSeen: new Date(s.lastSeen).toISOString(),
        metricCount: s.metricCount,
        pointCount: s.pointCount,
        co: s.co,
      }));

    it('MT20 hosts with their services', async () => {
      expect(await sources({ key: 'host.name', coKeys: ['service.name'] })).toEqual([
        { value: 'host-1', projectIds: BOTH, lastSeen: at(16), metricCount: 2, pointCount: 5, co: { 'service.name': ['cart', 'checkout', 'hw-agent'] } },
        { value: 'host-2', projectIds: BOTH, lastSeen: at(17), metricCount: 2, pointCount: 4, co: { 'service.name': ['cart', 'checkout', 'hw-agent'] } },
      ]);
    });

    it('MT21 metric name prefixes include and exclude', async () => {
      expect(await sources({ key: 'service.name', excludeMetricPrefixes: ['system.'], coKeys: ['host.name'] })).toEqual([
        { value: 'cart', projectIds: BOTH, lastSeen: at(17), metricCount: 1, pointCount: 4, co: { 'host.name': ['host-1', 'host-2'] } },
        { value: 'checkout', projectIds: [PROJECT_A], lastSeen: at(6), metricCount: 1, pointCount: 3, co: { 'host.name': ['host-1', 'host-2'] } },
      ]);
      expect(await sources({ key: 'service.name', includeMetricPrefixes: ['system.'] })).toEqual([
        { value: 'hw-agent', projectIds: BOTH, lastSeen: at(16), metricCount: 1, pointCount: 6, co: {} },
      ]);
      expect(await sources({
        key: 'service.name',
        projectId: [PROJECT_A, PROJECT_B, PROJECT_C],
        includeMetricPrefixes: ['app.'],
        excludeMetricPrefixes: ['app.queue'],
      })).toEqual([
        { value: 'jobs', projectIds: [PROJECT_C], lastSeen: at(10), metricCount: 1, pointCount: 4, co: {} },
      ]);
      // Empty prefix lists filter nothing.
      expect((await sources({ key: 'service.name', includeMetricPrefixes: [], excludeMetricPrefixes: [] })).map((s) => s.value))
        .toEqual(['cart', 'checkout', 'hw-agent']);
    });

    it('MT22 ordered by value with a limit', async () => {
      expect((await sources({ key: 'service.name', includeMetricPrefixes: ['system.', 'app.'] })).map((s) => s.value)).toEqual(['cart', 'checkout', 'hw-agent']);
      expect((await sources({ key: 'service.name', limit: 2 })).map((s) => s.value)).toEqual(['cart', 'checkout']);
    });

    it('MT23 project scope, a missing co-key is an empty list', async () => {
      expect(await sources({ projectId: PROJECT_B, key: 'host.name', coKeys: ['service.name', 'missing.key'] })).toEqual([
        { value: 'host-1', projectIds: [PROJECT_B], lastSeen: at(3), metricCount: 1, pointCount: 1, co: { 'service.name': ['cart'], 'missing.key': [] } },
        { value: 'host-2', projectIds: [PROJECT_B], lastSeen: at(17), metricCount: 2, pointCount: 2, co: { 'service.name': ['cart', 'hw-agent'], 'missing.key': [] } },
      ]);
    });

    it('MT24 the window bounds points and lastSeen', async () => {
      expect(await sources({ projectId: PROJECT_A, from: minutes(-120), to: minutes(10), key: 'host.name' })).toEqual([
        { value: 'host-1', projectIds: [PROJECT_A], lastSeen: at(3), metricCount: 2, pointCount: 3, co: {} },
        { value: 'host-2', projectIds: [PROJECT_A], lastSeen: at(2), metricCount: 2, pointCount: 2, co: {} },
        { value: 'host-3', projectIds: [PROJECT_A], lastSeen: at(-60), metricCount: 1, pointCount: 1, co: {} },
      ]);
    });

    it('MT25 co-key values are distinct and sorted', async () => {
      expect(await sources({ projectId: PROJECT_C, key: 'host.name', coKeys: ['service.instance.id', 'service.name'] })).toEqual([
        {
          value: 'host-9', projectIds: [PROJECT_C], lastSeen: at(10), metricCount: 1, pointCount: 4,
          co: { 'service.instance.id': ['i-01', 'i-02', 'i-10'], 'service.name': ['jobs'] },
        },
      ]);
    });
  });
}
