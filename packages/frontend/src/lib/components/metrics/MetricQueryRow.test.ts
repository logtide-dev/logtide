import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MetricQueryRow from './MetricQueryRow.svelte';
import { DEFAULT_QUERY, type MetricQueryState } from '$lib/utils/metrics-query';

function setup(query: Partial<MetricQueryState> = {}) {
  const onChange = vi.fn();
  render(MetricQueryRow, {
    metricNames: [{ name: 'cpu', type: 'gauge' }],
    query: { ...DEFAULT_QUERY, metric: 'cpu', ...query },
    labelKeys: ['host', 'env', 'region'],
    loadLabelValues: vi.fn().mockResolvedValue(['a', 'b']),
    services: ['api', 'web'],
    onChange,
  });
  return onChange;
}

describe('MetricQueryRow', () => {
  it('rate option present for any metric', () => {
    setup();
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Rate');
    expect(options).toContain('p95');
    expect(options).toContain('Auto');
  });

  it('changing aggregate emits patch', async () => {
    const onChange = setup();
    await fireEvent.change(screen.getByLabelText('Aggregate'), { target: { value: 'rate' } });
    expect(onChange).toHaveBeenCalledWith({ aggregation: 'rate' });
  });

  it('rate shows its tooltip text', () => {
    setup({ aggregation: 'rate' });
    expect(screen.getByText('Per-second increase of a cumulative counter')).toBeInTheDocument();
  });

  it('changing service emits null for all services', async () => {
    const onChange = setup({ service: 'api' });
    await fireEvent.change(screen.getByLabelText('Service'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ service: null });
  });

  it('group by third selection is disabled', async () => {
    setup({ groupBy: ['host', 'env'] });
    await fireEvent.click(screen.getByRole('button', { name: /host, env/ }));
    expect(screen.getByRole('checkbox', { name: 'region' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'host' })).not.toBeDisabled();
  });

  it('group by emits the new list', async () => {
    const onChange = setup({ groupBy: ['host'] });
    await fireEvent.click(screen.getByRole('button', { name: /host/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'env' }));
    expect(onChange).toHaveBeenCalledWith({ groupBy: ['host', 'env'] });
  });

  it('remove-filter button has aria-label and emits the reduced filters', async () => {
    const onChange = setup({ where: { env: ['prod'], host: ['h1'] } });
    const button = screen.getByRole('button', { name: 'Remove filter env' });
    expect(button.getAttribute('aria-label')).toBe('Remove filter env');
    await fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith({ where: { host: ['h1'] } });
  });

  it('adds a multi-value filter and shows the series hint', async () => {
    const onChange = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    await fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'env' } });
    const a = await screen.findByRole('checkbox', { name: 'a' });
    await fireEvent.click(a);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'b' }));
    expect(screen.getByText('Each selected value is shown as its own series.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onChange).toHaveBeenCalledWith({ where: { env: ['a', 'b'] } });
  });
});
