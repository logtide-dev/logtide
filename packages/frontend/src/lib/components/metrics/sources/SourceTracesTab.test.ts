import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ getSourceTraces: vi.fn(), getTraces: vi.fn(), goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto: h.goto }));
vi.mock('$lib/api/metrics-v2', () => ({ metricsV2API: { getSourceTraces: h.getSourceTraces } }));
vi.mock('$lib/api/traces', () => ({ tracesAPI: { getTraces: h.getTraces } }));
// The charts only have to mount; their options are tested in source-traces.test.ts.
vi.mock('echarts', () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
}));

import SourceTracesTab from './SourceTracesTab.svelte';

const FROM = '2026-11-26T10:00:00.000Z';
const TO = '2026-11-26T11:00:00.000Z';

function trace(id: string, extra: Record<string, unknown> = {}) {
  return {
    trace_id: id,
    service_name: 'api-gateway',
    root_service_name: 'api-gateway',
    root_operation_name: `GET /${id}`,
    start_time: '2026-11-26T10:30:00.000Z',
    end_time: '2026-11-26T10:30:00.050Z',
    duration_ms: 50,
    span_count: 6,
    error: false,
    ...extra,
  };
}

function renderTab(kind: 'host' | 'service' = 'host', name = 'vps-app') {
  return render(SourceTracesTab, {
    props: {
      kind,
      name,
      organizationId: 'org-1',
      projectIds: ['p1'],
      services: kind === 'host' ? ['checkout-api', 'orders-service'] : [],
      from: FROM,
      to: TO,
    },
  });
}

const lastList = () => h.getTraces.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.resetAllMocks();
  h.getSourceTraces.mockResolvedValue({
    bucketSeconds: 300,
    buckets: [
      { time: FROM, requests: 100, errors: 4, p95: 80 },
      { time: '2026-11-26T10:05:00.000Z', requests: 50, errors: 0, p95: 140 },
    ],
    totals: { requests: 150, errors: 4 },
  });
  h.getTraces.mockResolvedValue({ traces: [trace('a'), trace('b', { error: true })], total: 2 });
});

describe('SourceTracesTab', () => {
  it('loads the activity of the host and the traces that touched it', async () => {
    renderTab();
    expect((await screen.findAllByText('GET /a')).length).toBeGreaterThan(0);
    expect(h.getSourceTraces).toHaveBeenCalledWith('host', 'vps-app', { organizationId: 'org-1', projectIds: ['p1'], from: FROM, to: TO });
    expect(lastList()).toMatchObject({
      projectId: ['p1'],
      attr: 'resource.host.name:vps-app',
      from: FROM,
      to: TO,
      sortBy: 'start_time',
      sortOrder: 'desc',
      offset: 0,
    });
    expect(lastList().error).toBeUndefined();
    const totals = await screen.findByTestId('trace-totals');
    expect(totals.textContent).toContain('150 requests');
    expect(totals.textContent).toContain('2.7% errors');
    expect(totals.textContent).toContain('p95 peak 140ms');
    expect(screen.getByRole('img', { name: 'Requests and errors over time' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'p95 latency over time' })).toBeTruthy();
  });

  it('narrows to a service of the host and to errors', async () => {
    renderTab();
    await screen.findAllByText('GET /a');
    await fireEvent.click(within(screen.getByRole('group', { name: 'Service' })).getByRole('button', { name: 'orders-service' }));
    await waitFor(() => expect(lastList().attr).toBe('resource.host.name:vps-app resource.service.name:orders-service'));
    await fireEvent.click(screen.getByRole('button', { name: /Errors only/ }));
    await waitFor(() => expect(lastList().error).toBe(true));

    const url = new URL(screen.getByRole('link', { name: 'Open in Traces' }).getAttribute('href') ?? '', 'http://x');
    expect(url.searchParams.get('attr')).toBe('resource.host.name:vps-app resource.service.name:orders-service');
    expect(url.searchParams.get('status')).toBe('errors');

    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(lastList().attr).toBe('resource.host.name:vps-app'));
    expect(lastList().error).toBeUndefined();
  });

  it('a service page matches the spans of the service and has no service chips', async () => {
    renderTab('service', 'checkout-api');
    await screen.findAllByText('GET /a');
    expect(lastList().attr).toBe('resource.service.name:checkout-api');
    expect(screen.queryByRole('group', { name: 'Service' })).toBeNull();
  });

  it('explains a host without traces', async () => {
    h.getSourceTraces.mockResolvedValue({ bucketSeconds: 300, buckets: [], totals: { requests: 0, errors: 0 } });
    h.getTraces.mockResolvedValue({ traces: [], total: 0 });
    renderTab('host', 'homelab-nas');
    expect(await screen.findByText('No traces on this host')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Requests and errors over time' })).toBeNull();
  });

  it('keeps the list when the activity cannot load', async () => {
    h.getSourceTraces.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByText(/Could not load the trace activity: boom/)).toBeTruthy();
    expect((await screen.findAllByText('GET /a')).length).toBeGreaterThan(0);
  });
});
