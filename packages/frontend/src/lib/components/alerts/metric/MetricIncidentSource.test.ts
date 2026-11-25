import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { IncidentMetricAlertDetail } from '@logtide/shared';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('$lib/api/metrics-v2', () => ({ metricsV2API: { query: h.query } }));
vi.mock('$lib/components/metrics/v2/MetricSeriesView.svelte', async () => ({
  default: (await import('../../../../test-stubs/SeriesView.stub.svelte')).default,
}));

import MetricIncidentSource from './MetricIncidentSource.svelte';
import { decodeExplorerQuery } from '$lib/utils/metrics-explorer-url';

function detail(over: Partial<IncidentMetricAlertDetail> = {}): IncidentMetricAlertDetail {
  return {
    ruleId: 'r1',
    ruleName: 'CPU high',
    config: {
      query: {
        projectIds: ['p1'],
        queries: [
          {
            id: 'A',
            metricName: 'system.cpu.utilization',
            aggregation: 'avg',
            filters: [],
            groupBy: [{ scope: 'resource', key: 'host.name' }],
          },
        ],
        formulas: [],
        interval: 'auto',
        compareTo: 'none',
        display: 'lines',
      },
      condition: 'above',
      threshold: 0.9,
      window: '5m',
      forEvaluations: 1,
      severity: 'high',
      unit: '1',
    },
    queryId: 'A',
    source: 'system.cpu.utilization',
    condition: 'above',
    threshold: 0.9,
    unit: '1',
    window: '5m',
    groups: [
      { groupKey: 'host.name=web-2', labels: { 'host.name': 'web-2' }, value: 0.97, state: 'firing', firingSince: '2026-11-25T10:00:00.000Z' },
      { groupKey: 'host.name=web-1', labels: { 'host.name': 'web-1' }, value: 0.95, state: 'resolved', firingSince: '2026-11-25T10:00:00.000Z' },
    ],
    ...over,
  };
}

const props = (over: Partial<IncidentMetricAlertDetail> = {}, resolvedAt: string | null = '2026-11-25T11:00:00.000Z') => ({
  metricAlert: detail(over),
  organizationId: 'org1',
  createdAt: '2026-11-25T10:00:00.000Z',
  resolvedAt,
});

beforeEach(() => {
  h.query.mockReset().mockResolvedValue({ series: [], interval: '1m', queries: [], warnings: [] });
});

describe('MetricIncidentSource', () => {
  it('shows the rule, the threshold with its unit and the groups with their values', () => {
    render(MetricIncidentSource, { props: props() });
    expect(screen.getByText('CPU high')).toBeTruthy();
    expect(screen.getByTestId('metric-incident-condition').textContent).toMatch(/above\s+90%/);
    const groups = screen.getAllByTestId('metric-incident-group');
    expect(groups.map((g) => g.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringMatching(/host\.name=web-2.*97%.*Firing/),
      expect.stringMatching(/host\.name=web-1.*95%.*Resolved/),
    ]);
    expect(screen.getByText('Firing (1)')).toBeTruthy();
  });

  it('charts the rule query over the incident with lead time, in the incident organization', async () => {
    render(MetricIncidentSource, { props: props() });
    await waitFor(() => expect(h.query).toHaveBeenCalledTimes(1));
    const req = h.query.mock.calls[0][0];
    expect(req).toMatchObject({ organizationId: 'org1', projectIds: ['p1'], compareTo: 'none' });
    expect(req.queries[0].metricName).toBe('system.cpu.utilization');
    expect(req.from).toBe('2026-11-25T09:00:00.000Z');
    expect(req.to).toBe('2026-11-25T11:15:00.000Z');
    expect(screen.getByTestId('series-view')).toBeTruthy();
  });

  it('opens the explorer with the rule projects and the incident range', () => {
    render(MetricIncidentSource, { props: props() });
    const link = screen.getByRole('link', { name: 'Open in Explore' }) as HTMLAnchorElement;
    const params = new URL(link.getAttribute('href') as string, 'http://x').searchParams;
    expect(params.get('project')).toBe('p1');
    expect(params.get('from')).toBe('2026-11-25T09:00:00.000Z');
    expect(decodeExplorerQuery(params.get('q'))?.queries[0].metricName).toBe('system.cpu.utilization');
    expect((screen.getByRole('link', { name: 'Open rule' }) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/dashboard/alerts?edit=r1',
    );
  });

  it('a deleted rule keeps the groups but has no chart and no links', () => {
    render(MetricIncidentSource, { props: props({ ruleId: null, config: null }) });
    expect(screen.getAllByTestId('metric-incident-group')).toHaveLength(2);
    expect(screen.queryByTestId('metric-incident-chart')).toBeNull();
    expect(screen.getByText(/no longer exists/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(h.query).not.toHaveBeenCalled();
  });

  it('labels an ungrouped rule and an incident with no firing group', () => {
    render(MetricIncidentSource, {
      props: props({
        groups: [{ groupKey: '', labels: {}, value: 0.95, state: 'resolved', firingSince: null }],
      }),
    });
    expect(screen.getByText('All series')).toBeTruthy();
    expect(screen.getByText('Fired during this incident')).toBeTruthy();
  });
});
