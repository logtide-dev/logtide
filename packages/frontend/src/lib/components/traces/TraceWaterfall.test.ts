import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TraceWaterfall from './TraceWaterfall.svelte';

const T0 = '2026-10-22T10:00:00.000Z';

function span(id: string, parent: string | null, offsetMs: number, durMs: number, extra: Record<string, unknown> = {}) {
  const start = new Date(new Date(T0).getTime() + offsetMs);
  return {
    span_id: id,
    trace_id: 't1',
    parent_span_id: parent,
    service_name: 'api',
    operation_name: `op-${id}`,
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + durMs).toISOString(),
    duration_ms: durMs,
    kind: 'SERVER',
    status_code: 'OK',
    status_message: null,
    attributes: null,
    events: null,
    links: null,
    resource_attributes: null,
    ...extra,
  } as any;
}

const trace = {
  trace_id: 't1',
  service_name: 'api',
  root_service_name: 'api',
  root_operation_name: 'root',
  start_time: T0,
  end_time: new Date(new Date(T0).getTime() + 1000).toISOString(),
  duration_ms: 1000,
  span_count: 3,
  error: false,
} as any;

describe('TraceWaterfall', () => {
  it('renders one row per span and collapses children', async () => {
    const spans = [span('a', null, 0, 1000), span('b', 'a', 100, 200), span('c', 'a', 400, 200)];
    render(TraceWaterfall, { spans, trace, selectedSpanId: null, onSelect: vi.fn() });
    expect(screen.getAllByRole('button', { pressed: false }).filter((el) => el.hasAttribute('data-span-row'))).toHaveLength(3);
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse children' }));
    expect(document.querySelectorAll('[data-span-row]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Expand children' })).toBeInTheDocument();
  });

  it('clamps a bar that starts before the trace', () => {
    const spans = [span('a', null, -500, 800)];
    const { container } = render(TraceWaterfall, { spans, trace, selectedSpanId: null, onSelect: vi.fn() });
    const bar = container.querySelector('[data-span-bar]') as HTMLElement;
    const left = parseFloat(bar.style.left);
    const width = parseFloat(bar.style.width);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(100.0001);
  });

  it('Enter on a row selects it', async () => {
    const onSelect = vi.fn();
    render(TraceWaterfall, { spans: [span('a', null, 0, 500)], trace, selectedSpanId: null, onSelect });
    const row = document.querySelector('[data-span-row]') as HTMLElement;
    await fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('error spans use the failed tone', () => {
    const spans = [span('a', null, 0, 500, { status_code: 'ERROR' })];
    const { container } = render(TraceWaterfall, { spans, trace, selectedSpanId: null, onSelect: vi.fn() });
    const bar = container.querySelector('[data-span-bar]') as HTMLElement;
    expect(bar.className).toContain('bg-');
    expect(bar.className).not.toContain('bg-red-');
  });
});
