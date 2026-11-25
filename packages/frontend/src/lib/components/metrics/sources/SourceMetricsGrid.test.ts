import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ getCatalog: vi.fn(), query: vi.fn() }));

vi.mock('$lib/api/metrics-v2', () => ({ metricsV2API: { getCatalog: h.getCatalog, query: h.query } }));
vi.mock('$lib/components/metrics/v2/MetricSeriesView.svelte', async () => ({
  default: (await import('../../../../test-stubs/SeriesView.stub.svelte')).default,
}));

import SourceMetricsGrid from './SourceMetricsGrid.svelte';

const props = {
  kind: 'host' as const,
  name: 'web-1',
  metricNames: ['http.requests', 'http.duration', 'cpu.load'],
  organizationId: 'org-1',
  projectIds: null,
  from: '2026-01-01T00:00:00Z',
  to: '2026-01-01T01:00:00Z',
};

beforeEach(() => {
  h.getCatalog.mockReset();
  h.query.mockReset();
  h.query.mockResolvedValue({ series: [], queries: [] });
});

function aggregationOf(metricName: string): string {
  const call = h.query.mock.calls.find((c) => c[0].queries[0].metricName === metricName);
  return call?.[0].queries[0].aggregation;
}

describe('SourceMetricsGrid', () => {
  it('queries rate for monotonic sums, p95 for histograms and avg otherwise', async () => {
    h.getCatalog.mockResolvedValue({
      metrics: [
        { name: 'http.requests', type: 'sum', isMonotonic: true },
        { name: 'http.duration', type: 'histogram', isMonotonic: null },
        { name: 'cpu.load', type: 'gauge', isMonotonic: null },
      ],
    });
    render(SourceMetricsGrid, { props });
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(3));
    expect(h.getCatalog).toHaveBeenCalledTimes(1);
    expect(aggregationOf('http.requests')).toBe('rate');
    expect(aggregationOf('http.duration')).toBe('p95');
    expect(aggregationOf('cpu.load')).toBe('avg');
  });

  it('falls back to avg when the catalog cannot be loaded', async () => {
    h.getCatalog.mockRejectedValue(new Error('boom'));
    render(SourceMetricsGrid, { props });
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(3));
    expect(aggregationOf('http.requests')).toBe('avg');
  });
});
