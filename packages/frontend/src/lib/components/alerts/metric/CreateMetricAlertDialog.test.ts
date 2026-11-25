import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import type { MetricExplorerQuery, MetricQueryResponse } from '@logtide/shared';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  chart: { setOption: vi.fn(), on: vi.fn(), resize: vi.fn(), dispose: vi.fn(), clear: vi.fn() },
}));

vi.mock('echarts', () => ({ init: vi.fn(() => h.chart) }));
vi.mock('$lib/api/metrics-v2', () => ({ metricsV2API: { query: h.query } }));
vi.mock('$lib/api/alerts', () => ({ alertsAPI: { createAlertRule: h.create, updateAlertRule: h.update } }));
vi.mock('$lib/api/notification-routing', () => ({
  notificationRoutingAPI: { preview: vi.fn().mockResolvedValue({ destinations: [], fallback: false }) },
}));
vi.mock('$lib/stores/organization', async () => {
  const { writable } = await import('svelte/store');
  return { organizationStore: writable({ currentOrganization: { id: 'org-1' } }) };
});
vi.mock('$lib/stores/notification-channels', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({ channels: [], loading: false, error: null });
  return { notificationChannelsStore: { subscribe: store.subscribe, load: vi.fn() } };
});
vi.mock('$lib/stores/toast', () => ({
  toastStore: { success: h.success, error: h.error, warning: vi.fn(), info: vi.fn() },
}));

import CreateMetricAlertDialog from './CreateMetricAlertDialog.svelte';
import type { AlertRule } from '$lib/api/alerts';

const spec = (id: string, metricName: string, extra: Record<string, unknown> = {}) => ({
  id,
  metricName,
  aggregation: 'avg' as const,
  filters: [],
  groupBy: [{ scope: 'resource' as const, key: 'host.name' }],
  ...extra,
});

function explorer(over: Partial<MetricExplorerQuery> = {}): MetricExplorerQuery {
  return {
    projectIds: ['p1'],
    queries: [spec('A', 'system.cpu.utilization')],
    formulas: [],
    interval: 'auto',
    compareTo: 'none',
    display: 'split',
    ...over,
  };
}

function response(max = 0.72): MetricQueryResponse {
  return {
    interval: '1m',
    warnings: [],
    queries: [{ id: 'A', seriesTotal: 1, seriesShown: 1, metricType: 'gauge', unit: '1' }],
    series: [
      {
        id: 'A|web-1',
        queryId: 'A',
        labels: { 'host.name': 'web-1' },
        name: 'web-1',
        unit: '1',
        comparison: false,
        points: [
          { t: '2026-11-25T10:00:00Z', v: 0.5 },
          { t: '2026-11-25T10:01:00Z', v: max },
        ],
        stats: { min: 0.5, avg: 0.61, max, last: max },
      },
    ],
  };
}

function savedRule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'm1',
    organizationId: 'org-1',
    projectId: 'p1',
    name: 'CPU high',
    enabled: true,
    service: null,
    level: [],
    threshold: 0,
    timeWindow: 15,
    alertType: 'metric',
    baselineType: null,
    deviationMultiplier: null,
    minBaselineValue: null,
    cooldownMinutes: null,
    sustainedMinutes: null,
    emailRecipients: [],
    webhookUrl: null,
    channelIds: [],
    metadataFilters: [],
    renotifyMinutes: 30,
    metricConfig: {
      query: { ...explorer(), display: 'lines', queries: [{ ...spec('A', 'system.cpu.utilization'), hidden: false }] },
      condition: 'above',
      threshold: 0.9,
      window: '15m',
      forEvaluations: 3,
      severity: 'critical',
      unit: '1',
    },
    createdAt: '2026-11-25T00:00:00Z',
    updatedAt: '2026-11-25T00:00:00Z',
    ...over,
  };
}

function lastMarkLine(): unknown {
  const calls = h.chart.setOption.mock.calls;
  const option = calls[calls.length - 1]?.[0];
  return option?.series?.[0]?.markLine?.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.query.mockResolvedValue(response());
  h.create.mockResolvedValue({ alertRule: savedRule() });
  h.update.mockResolvedValue({ alertRule: savedRule() });
});

afterEach(() => cleanup());

describe('CreateMetricAlertDialog', () => {
  it('prefills from the explorer query and previews the watched item with the threshold', async () => {
    render(CreateMetricAlertDialog, {
      props: { open: true, organizationId: 'org-1', query: explorer(), response: response() },
    });

    expect(screen.getByLabelText('Name')).toHaveValue('High system.cpu.utilization');
    expect(screen.getByLabelText('Threshold')).toHaveValue(72);
    expect(screen.getByTestId('threshold-unit')).toHaveTextContent('%');
    // One query: no picker.
    expect(screen.queryByLabelText('Watch')).toBeNull();

    await waitFor(() => expect(h.query).toHaveBeenCalled());
    const req = h.query.mock.calls[0][0];
    expect(req).toMatchObject({ organizationId: 'org-1', projectIds: ['p1'], compareTo: 'none', display: 'lines' });
    expect(new Date(req.to).getTime() - new Date(req.from).getTime()).toBe(60 * 60 * 1000);
    await waitFor(() => expect(lastMarkLine()).toEqual([{ yAxis: 0.72 }]));
  });

  it('creates a metric rule with the raw threshold and the chosen options', async () => {
    const onSaved = vi.fn();
    render(CreateMetricAlertDialog, {
      props: { open: true, organizationId: 'org-1', query: explorer(), response: response(), onSaved },
    });
    await fireEvent.input(screen.getByLabelText('Threshold'), { target: { value: '85' } });
    await fireEvent.input(screen.getByLabelText('For (checks in a row)'), { target: { value: '4' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));

    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    const input = h.create.mock.calls[0][0];
    expect(input).toMatchObject({
      organizationId: 'org-1',
      name: 'High system.cpu.utilization',
      alertType: 'metric',
      channelIds: [],
      renotifyMinutes: null,
      metricConfig: {
        condition: 'above',
        window: '5m',
        forEvaluations: 4,
        severity: 'high',
        unit: '1',
        query: { projectIds: ['p1'], formulas: [], queries: [expect.objectContaining({ id: 'A', hidden: false })] },
      },
    });
    expect(input.metricConfig.threshold).toBeCloseTo(0.85);
    expect(onSaved).toHaveBeenCalled();
    expect(h.success).toHaveBeenCalledWith('Metric alert created');
  });

  it('offers a picker when the query has several items and builds the formula query', async () => {
    const query = explorer({
      queries: [spec('A', 'http.errors', { hidden: true }), spec('B', 'http.requests', { hidden: true })],
      formulas: [{ id: 'F1', expression: 'A / B * 100' }],
    });
    render(CreateMetricAlertDialog, { props: { open: true, organizationId: 'org-1', query, response: null } });
    expect(screen.getByLabelText('Watch')).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('Threshold'), { target: { value: '5' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    const built = h.create.mock.calls[0][0].metricConfig.query;
    expect(built.formulas).toEqual([{ id: 'F1', expression: 'A / B * 100', hidden: false }]);
    expect(built.queries.every((x: { hidden: boolean }) => x.hidden)).toBe(true);
    expect(h.create.mock.calls[0][0].metricConfig.threshold).toBe(5);
  });

  it('does not save without a threshold', async () => {
    render(CreateMetricAlertDialog, { props: { open: true, organizationId: 'org-1', query: explorer(), response: null } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(await screen.findByText('Enter a number')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('edits a stored rule in display units', async () => {
    render(CreateMetricAlertDialog, {
      props: { open: true, organizationId: 'org-1', rule: savedRule(), mode: 'edit' },
    });
    expect(screen.getByLabelText('Name')).toHaveValue('CPU high');
    expect(screen.getByLabelText('Threshold')).toHaveValue(90);
    expect(screen.getByLabelText('For (checks in a row)')).toHaveValue(3);
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    const [orgId, id, input] = h.update.mock.calls[0];
    expect([orgId, id]).toEqual(['org-1', 'm1']);
    expect(input).toMatchObject({
      name: 'CPU high',
      renotifyMinutes: 30,
      metricConfig: { window: '15m', forEvaluations: 3, severity: 'critical', condition: 'above' },
    });
    expect(input.metricConfig.threshold).toBeCloseTo(0.9);
  });

  it('duplicates a rule as a new one', async () => {
    render(CreateMetricAlertDialog, {
      props: { open: true, organizationId: 'org-1', rule: savedRule(), mode: 'create' },
    });
    expect(screen.getByLabelText('Name')).toHaveValue('CPU high (copy)');
    await fireEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.update).not.toHaveBeenCalled();
  });
});
