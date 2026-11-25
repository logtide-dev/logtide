import { describe, it, expect } from 'vitest';
import {
  metricExplorerQuerySchema,
  metricQueryRequestSchema,
  metricPanelsDataSchema,
  effectiveVariables,
  windowError,
  MAX_QUERY_WINDOW_MS,
} from '../../../../modules/metrics/query/schema.js';
import { variableName, isVariableRef, resolveFilterVariables } from '../../../../modules/metrics/query/variables.js';
import { panelConfigSchema, dashboardDocumentSchema } from '../../../../modules/custom-dashboards/panel-registry.js';
import { collectVariableRefs } from '../../../../modules/custom-dashboards/variables.js';
import { metricAlertConfigSchema } from '../../../../modules/alerts/metric-config.js';
import { effectiveTemporality } from '../../../../modules/metrics/query/units.js';
import { foldTopNWith, topByRecent, lastValue, OTHER_LABEL } from '../../../../modules/metrics/query/series-fold.js';
import { evaluateFormulaFolded, parseFormula } from '../../../../modules/metrics/query/formula.js';
import { singleLevelIsExact } from '../../../../modules/metrics/query/service.js';
import type { PanelConfig } from '@logtide/shared';

const explorer = (queryOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  projectIds: null,
  queries: [{ id: 'A', metricName: 'cpu', aggregation: 'avg', filters: [], groupBy: [], ...queryOver }],
  formulas: [],
  interval: 'auto',
  compareTo: 'none',
  display: 'lines',
  ...over,
});

const panel = (query: unknown) => ({ type: 'metrics', title: 'T', source: 'metrics', timeRange: '24h', query });
const alert = (query: unknown) => ({ query, condition: 'above', threshold: 1, window: '5m', forEvaluations: 1 });

/** The same explorer query through the three entry points. */
function everywhere(query: unknown) {
  return {
    explorer: metricExplorerQuerySchema.safeParse(query).success,
    panel: panelConfigSchema.safeParse(panel(query)).success,
    alert: metricAlertConfigSchema.safeParse(alert(query)).success,
    request: metricQueryRequestSchema.safeParse({
      ...(query as object),
      organizationId: '11111111-1111-4111-8111-111111111111',
      from: '2026-11-25T00:00:00.000Z',
      to: '2026-11-25T06:00:00.000Z',
    }).success,
  };
}

const all = (v: boolean) => ({ explorer: v, panel: v, alert: v, request: v });

describe('one explorer query schema (item 10)', () => {
  it('accepts and rejects the same attribute keys everywhere', () => {
    for (const key of ['host.name', 'k8s.pod.labels.app.kubernetes.io/part-of', 'http.route', 'net:peer', 'x'.repeat(256)]) {
      expect(everywhere(explorer({ groupBy: [{ scope: 'resource', key }] })), key).toEqual(all(true));
    }
    for (const key of ['', 'a b', "x'y", 'x"y', '1abc', 'a;b', 'x'.repeat(257), 'tab\there']) {
      expect(everywhere(explorer({ groupBy: [{ scope: 'resource', key }] })), key).toEqual(all(false));
    }
  });

  it('agrees on values: empty and "$5" are literals, long values capped the same', () => {
    const f = (op: string, values?: string[]) => explorer({ filters: [{ scope: 'metric', key: 'k', op, values }] });
    expect(everywhere(f('eq', ['']))).toEqual(all(true));
    expect(everywhere(f('eq', ['$5']))).toEqual(all(true));
    expect(everywhere(f('eq', ['x'.repeat(1024)]))).toEqual(all(true));
    expect(everywhere(f('eq', ['x'.repeat(1025)]))).toEqual(all(false));
    expect(everywhere(f('gte', ['1e3']))).toEqual(all(true));
    expect(everywhere(f('gte', ['$5']))).toEqual(all(false));
    expect(everywhere(f('gte', ['0x10']))).toEqual(all(false));
    expect(everywhere(f('in', Array.from({ length: 100 }, (_, i) => `v${i}`)))).toEqual(all(true));
    expect(everywhere(f('in', Array.from({ length: 101 }, (_, i) => `v${i}`)))).toEqual(all(false));
  });

  it('agrees on lengths of names, labels, expressions and units', () => {
    expect(everywhere(explorer({ metricName: 'm'.repeat(512) }))).toEqual(all(true));
    expect(everywhere(explorer({ metricName: 'm'.repeat(513) }))).toEqual(all(false));
    expect(everywhere(explorer({ label: 'l'.repeat(200) }))).toEqual(all(true));
    expect(everywhere(explorer({ label: 'l'.repeat(201) }))).toEqual(all(false));
    expect(everywhere(explorer({}, { unitOverride: 'u'.repeat(32) }))).toEqual(all(true));
    expect(everywhere(explorer({}, { unitOverride: 'u'.repeat(33) }))).toEqual(all(false));
    expect(everywhere(explorer({}, { formulas: [{ id: 'F1', expression: 'A'.padEnd(500, ' ') }] }))).toEqual(all(true));
    expect(everywhere(explorer({}, { formulas: [{ id: 'F1', expression: 'A'.padEnd(501, ' ') }] }))).toEqual(all(false));
    expect(everywhere(explorer({}, { projectIds: [] }))).toEqual(all(false));
  });

  it('strips unknown keys instead of storing them', () => {
    const parsed = panelConfigSchema.parse(panel(explorer({ uiOnly: 1 }, { extra: true }))) as PanelConfig & {
      query: Record<string, unknown>;
    };
    expect(parsed.query.extra).toBeUndefined();
    expect((parsed.query.queries as Array<Record<string, unknown>>)[0].uiOnly).toBeUndefined();
  });
});

describe('the "$name" variable rule', () => {
  it('only "$" plus a valid variable name is a reference', () => {
    expect(variableName('$host')).toBe('host');
    expect(variableName('$host_2')).toBe('host_2');
    for (const v of ['$5', '$', '$Host', '$1abc', 'host', '$a-b', '$' + 'a'.repeat(33), 5, null]) {
      expect(variableName(v), String(v)).toBeNull();
      expect(isVariableRef(v)).toBe(false);
    }
  });

  it('keeps "$5" as a literal when resolving, and dashboards do not see it as a variable', () => {
    const filters = [{ scope: 'metric' as const, key: 'price', op: 'eq' as const, values: ['$5'] }];
    expect(resolveFilterVariables(filters, undefined)).toEqual(filters);
    const config = panel(explorer({ filters })) as unknown as PanelConfig;
    expect(collectVariableRefs(config)).toEqual([]);
    const doc = { schema_version: 2, panels: [{ id: 'p', layout: { x: 0, y: 0, w: 4, h: 3 }, config }] };
    expect(dashboardDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe('request window and panel variables (items 4 and 12)', () => {
  it('caps the window at 90 days with from < to', () => {
    expect(windowError(0, MAX_QUERY_WINDOW_MS)).toBeNull();
    expect(windowError(0, MAX_QUERY_WINDOW_MS + 1)).toMatch(/90 days/);
    expect(windowError(5, 5)).toMatch(/before/);
    expect(windowError(Number.NaN, 5)).toMatch(/before/);
    const req = (from: string, to: string) =>
      metricQueryRequestSchema.safeParse({ ...explorer(), organizationId: '11111111-1111-4111-8111-111111111111', from, to }).success;
    expect(req('2026-08-27T00:00:00.000Z', '2026-11-25T00:00:00.000Z')).toBe(true);
    expect(req('2026-08-26T00:00:00.000Z', '2026-11-25T00:00:00.000Z')).toBe(false);
    const panels = (from: string) =>
      metricPanelsDataSchema.safeParse({
        organizationId: '11111111-1111-4111-8111-111111111111',
        from,
        to: '2026-11-25T00:00:00.000Z',
        panels: [{ id: 'a', config: { type: 'metrics' } }],
      }).success;
    expect(panels('2026-08-27T00:00:00.000Z')).toBe(true);
    expect(panels('2026-08-26T00:00:00.000Z')).toBe(false);
  });

  it('fills declared variables missing from the body with their default', () => {
    const declared = [
      { name: 'host', default: 'web-1' },
      { name: 'service', default: null },
    ];
    expect(effectiveVariables(undefined, declared)).toEqual({ host: 'web-1', service: null });
    expect(effectiveVariables({ host: 'web-2' }, declared)).toEqual({ host: 'web-2', service: null });
    expect(effectiveVariables({ host: null }, declared)).toEqual({ host: null, service: null });
    expect(effectiveVariables({ other: 'x' }, undefined)).toEqual({ other: 'x' });
  });
});

describe('temporality default (item 14)', () => {
  it('is cumulative unless the catalog says delta', () => {
    expect(effectiveTemporality({ unit: null, type: 'sum', temporality: null, isMonotonic: false })).toBe('cumulative');
    expect(effectiveTemporality({ unit: null, type: 'sum', temporality: null, isMonotonic: null })).toBe('cumulative');
    expect(effectiveTemporality({ unit: null, type: 'sum', temporality: 'delta', isMonotonic: true })).toBe('delta');
    expect(effectiveTemporality({ unit: null, type: 'histogram', temporality: null })).toBe('cumulative');
    expect(effectiveTemporality({ unit: null, type: 'gauge' })).toBeNull();
    expect(effectiveTemporality(undefined)).toBeNull();
  });
});

describe('fold helpers', () => {
  const s = (labels: Record<string, string>, values: Array<number | null>) => ({ labels, values });

  it('folds with a custom combine and ranks the busiest series by their last value', () => {
    const groups = [s({ h: 'a' }, [1]), s({ h: 'b' }, [5]), s({ h: 'c' }, [3])];
    const out = foldTopNWith(groups, 1, (rest) => s({ [OTHER_LABEL]: 'true' }, [rest.length]));
    expect(out.series.map((x) => x.labels)).toEqual([{ h: 'b' }, { [OTHER_LABEL]: 'true' }]);
    expect(out.series[1].values).toEqual([2]);
    expect(topByRecent(groups, 2, (x) => lastValue(x.values)).map((x) => x.labels.h)).toEqual(['b', 'c']);
    expect(lastValue([1, null, 4, null])).toBe(4);
    expect(lastValue([null])).toBeNull();
  });

  it('formula Other never joins two unrelated Others', () => {
    const a = [s({ h: 'a' }, [50]), s({ h: 'b' }, [1]), s({ h: 'c' }, [9])];
    const b = [s({ h: 'a' }, [100]), s({ h: 'b' }, [100]), s({ h: 'c' }, [300])];
    const sum = (members: typeof a) => s({}, [members.reduce((t, m) => t + (m.values[0] ?? 0), 0)]);
    const out = evaluateFormulaFolded(
      parseFormula('A / B'),
      new Map([
        ['A', { groups: a, combine: sum }],
        ['B', { groups: b, combine: sum }],
      ]),
      1,
      1,
    );
    expect(out.seriesTotal).toBe(3);
    expect(out.seriesShown).toBe(1);
    expect(out.series[0].labels).toEqual({ h: 'a' });
    expect(out.series[1].labels).toEqual({ [OTHER_LABEL]: 'true' });
    expect(out.series[1].values[0]).toBeCloseTo(10 / 400);
  });

  it('single-level aggregation only where it is exact', () => {
    expect(singleLevelIsExact('sum', 'sum')).toBe(true);
    expect(singleLevelIsExact('count', 'sum')).toBe(true);
    expect(singleLevelIsExact('min', 'min')).toBe(true);
    expect(singleLevelIsExact('max', 'max')).toBe(true);
    expect(singleLevelIsExact('avg', 'avg')).toBe(false);
    expect(singleLevelIsExact('sum', 'avg')).toBe(false);
    expect(singleLevelIsExact('max', 'sum')).toBe(false);
    expect(singleLevelIsExact('rate', 'sum')).toBe(false);
  });
});
