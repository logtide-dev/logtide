import { describe, it, expect } from 'vitest';
import { SERVICE_TEMPLATE, applicableTemplatePanels } from './templates.js';

function httpKeys(names: string[]): string[] {
  const sections = applicableTemplatePanels(SERVICE_TEMPLATE, names);
  return sections.filter((s) => s.title === 'HTTP (from metrics)').flatMap((s) => s.panels.map((p) => p.key));
}

interface Cfg {
  query: {
    queries: Array<{ aggregation: string; filters: Array<{ key: string; op: string; values: string[] }> }>;
    formulas: Array<{ expression: string }>;
  };
}

function panel(key: string): Cfg {
  const p = SERVICE_TEMPLATE.sections.flatMap((s) => s.panels).find((x) => x.key === key);
  return p?.config as unknown as Cfg;
}

describe('SERVICE_TEMPLATE http section', () => {
  it('shows the current semconv panels only for http.server.request.duration', () => {
    expect(httpKeys(['http.server.request.duration'])).toEqual(['http-rate', 'http-error-rate', 'http-latency']);
  });

  it('shows the legacy panels only for http.server.duration', () => {
    expect(httpKeys(['http.server.duration'])).toEqual(['http-legacy-rate', 'http-legacy-error-rate', 'http-legacy-latency']);
  });

  it('is hidden without http metrics', () => {
    expect(httpKeys(['jvm.memory.used'])).toEqual([]);
  });

  it('error rate is 5xx over total with the matching status key', () => {
    for (const [key, statusKey] of [
      ['http-error-rate', 'http.response.status_code'],
      ['http-legacy-error-rate', 'http.status_code'],
    ]) {
      const cfg = panel(key);
      expect(cfg.query.formulas[0].expression).toBe('A / B * 100');
      expect(cfg.query.queries[0].filters).toContainEqual(expect.objectContaining({ key: statusKey, op: 'gte', values: ['500'] }));
      expect(cfg.query.queries[1].filters.some((f) => f.key === statusKey)).toBe(false);
    }
  });

  it('latency panels carry p50, p95 and p99 queries', () => {
    expect(panel('http-latency').query.queries.map((x) => x.aggregation)).toEqual(['p50', 'p95', 'p99']);
    expect(panel('http-legacy-latency').query.queries.map((x) => x.aggregation)).toEqual(['p50', 'p95', 'p99']);
  });
});

describe('service template traces and error rate', () => {
  it('hides trace-only panels when the service has no traces', () => {
    const keys = (opts: { hasTraces?: boolean }) =>
      applicableTemplatePanels(SERVICE_TEMPLATE, [], opts).flatMap((s) => s.panels.map((p) => p.key));
    expect(keys({})).toContain('trace-volume');
    expect(keys({ hasTraces: true })).toContain('trace-latency');
    expect(keys({ hasTraces: false })).not.toContain('trace-volume');
    expect(keys({ hasTraces: false })).not.toContain('trace-latency');
    expect(applicableTemplatePanels(SERVICE_TEMPLATE, [], { hasTraces: false }).some((s) => s.title === 'Traffic (from traces)')).toBe(false);
  });

  it('error rate formula is a percent with hidden operands', () => {
    for (const key of ['http-error-rate', 'http-legacy-error-rate']) {
      const p = SERVICE_TEMPLATE.sections.flatMap((s) => s.panels).find((x) => x.key === key)!;
      const query = (p.config as unknown as { query: { unitOverride?: string; queries: Array<{ hidden?: boolean }>; formulas: unknown[] } }).query;
      expect(query.unitOverride).toBe('%');
      expect(query.formulas).toHaveLength(1);
      expect(query.queries.every((x) => x.hidden === true)).toBe(true);
    }
  });
});
