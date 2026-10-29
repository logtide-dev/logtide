import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers: Record<string, (p: unknown) => void> = {};
const getDataURL = vi.fn(() => 'data:image/png;base64,AAA');

vi.mock('echarts', () => ({
  init: () => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getDataURL,
    on: (name: string, ...rest: unknown[]) => {
      handlers[name] = rest[rest.length - 1] as (p: unknown) => void;
    },
  }),
}));
vi.mock('$app/environment', () => ({ browser: true }));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

import { render, screen, fireEvent } from '@testing-library/svelte';
import ServiceMapPanel from './ServiceMapPanel.svelte';

const range = { from: new Date('2026-10-22T09:00:00.000Z'), to: new Date('2026-10-22T10:00:00.000Z') };

function data(name = 'checkout api') {
  return {
    nodes: [
      { id: '1', name, callCount: 10, errorRate: 0.2, avgLatencyMs: 120, p95LatencyMs: 300, totalCalls: 10 },
      { id: '2', name: 'db', callCount: 5, errorRate: 0, avgLatencyMs: 10, p95LatencyMs: null, totalCalls: 5 },
    ],
    edges: [{ source: name, target: 'db', callCount: 5, type: 'span' as const }],
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    data: data(),
    loading: false,
    error: null,
    range,
    onRetry: vi.fn(),
    onViewTraces: vi.fn(),
    ...overrides,
  };
}

async function clickNode(name: string) {
  handlers.click({ dataType: 'node', name });
  await Promise.resolve();
}

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('ServiceMapPanel', () => {
  it('node click shows View logs, View errors and View traces', async () => {
    const onViewTraces = vi.fn();
    render(ServiceMapPanel, props({ onViewTraces }));
    await clickNode('checkout api');
    expect(await screen.findByRole('link', { name: 'View logs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View errors' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'View traces' }));
    expect(onViewTraces).toHaveBeenCalledWith('checkout api');
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('View logs links to /dashboard/logs with q=service:"name" and project and range', async () => {
    render(ServiceMapPanel, props());
    await clickNode('checkout api');
    const link = await screen.findByRole('link', { name: 'View logs' });
    const url = new URL(link.getAttribute('href')!, 'http://x');
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('q')).toBe('service:"checkout api"');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-10-22T09:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-22T10:00:00.000Z');
    const errors = new URL(screen.getByRole('link', { name: 'View errors' }).getAttribute('href')!, 'http://x');
    expect(errors.pathname).toBe('/dashboard/errors');
    expect(errors.searchParams.get('service')).toBe('checkout api');
    expect(errors.searchParams.get('project')).toBe('p1');
  });

  it('service names with spaces and quotes are encoded', async () => {
    const name = 'my "svc" a&b';
    render(ServiceMapPanel, props({ data: data(name) }));
    await clickNode(name);
    const link = await screen.findByRole('link', { name: 'View logs' });
    const href = link.getAttribute('href')!;
    expect(href).not.toContain(' ');
    expect(href).not.toContain('"');
    const url = new URL(href, 'http://x');
    expect(url.searchParams.get('q')).toContain('my');
    expect(url.searchParams.get('q')).toContain('a&b');
  });

  it('exports a PNG through the chart instance', async () => {
    render(ServiceMapPanel, props());
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));
    expect(getDataURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('shows the empty state', () => {
    render(ServiceMapPanel, props({ data: { nodes: [], edges: [] } }));
    expect(screen.getByText('No service dependencies found in this range')).toBeInTheDocument();
  });

  it('shows the error with Retry', async () => {
    const onRetry = vi.fn();
    render(ServiceMapPanel, props({ error: 'boom', data: null, onRetry }));
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
