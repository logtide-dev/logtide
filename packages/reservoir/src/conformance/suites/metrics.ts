// Metric label conformance: attribute keys are literal keys, dots included
// (`http.request.method`, the OTel norm), for where filters, group by and
// label values alike; a nested object with the same dotted name is not that
// label. Buckets are epoch aligned. Engines order rows and label values
// freely, so results compare sorted.

import { describe, expect, it } from 'vitest';
import type { MetricAggregateParams, MetricAggregationFn } from '../../core/types.js';
import type { ConformanceContext } from '../harness.js';
import { METRIC_REQUESTS, minutes, PROJECT_A, WINDOW } from '../corpus.js';

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
  });
}
