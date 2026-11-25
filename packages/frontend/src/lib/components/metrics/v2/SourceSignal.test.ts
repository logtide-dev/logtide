import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SourceSignalCell from './SourceSignalCell.svelte';
import SourceStatusDot from './SourceStatusDot.svelte';

describe('SourceSignalCell', () => {
  it('renders a meter for percent signals with the threshold color', () => {
    const { rerender } = render(SourceSignalCell, { signal: { value: 40, unit: '%', spark: [] }, label: 'CPU' });
    expect(screen.getByRole('meter', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('meter').firstElementChild).toHaveClass('bg-success');
    expect(screen.getByText('40%')).toBeInTheDocument();
    return rerender({ signal: { value: 88, unit: '%', spark: [] }, label: 'CPU' }).then(async () => {
      expect(screen.getByRole('meter').firstElementChild).toHaveClass('bg-warning');
      await rerender({ signal: { value: 97, unit: '%', spark: [] }, label: 'CPU' });
      expect(screen.getByRole('meter').firstElementChild).toHaveClass('bg-destructive');
    });
  });

  it('honours custom thresholds', () => {
    render(SourceSignalCell, {
      signal: { value: 82, unit: '%', spark: [] },
      label: 'Disk',
      thresholds: { warning: 80, critical: 90 },
    });
    expect(screen.getByRole('meter').firstElementChild).toHaveClass('bg-warning');
  });

  it('clamps the meter to 0-100', () => {
    render(SourceSignalCell, { signal: { value: 130, unit: '%', spark: [] }, label: 'X' });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });

  it('renders value and sparkline for other units', () => {
    render(SourceSignalCell, { signal: { value: 2048, unit: 'By/s', spark: [1, 2, 3, null, 5] }, label: 'Network' });
    expect(screen.getByText('2 KB/s')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Network trend' })).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('can hide the sparkline', () => {
    render(SourceSignalCell, { signal: { value: 1, unit: '1', spark: [1, 2] }, label: 'Load', showSpark: false });
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a placeholder without data', () => {
    render(SourceSignalCell, { signal: { value: null, unit: '%', spark: [] }, label: 'CPU' });
    expect(screen.getByLabelText('CPU: no data')).toBeInTheDocument();
  });

  it('handles a null signal', () => {
    render(SourceSignalCell, { signal: null, label: 'RPS' });
    expect(screen.getByLabelText('RPS: no data')).toBeInTheDocument();
  });
});

describe('SourceStatusDot', () => {
  it.each([
    ['ok', 'bg-success', 'Healthy'],
    ['warning', 'bg-warning', 'Warning'],
    ['critical', 'bg-destructive', 'Critical'],
    ['stale', 'bg-muted-foreground/60', 'No data'],
    ['unknown', 'bg-muted-foreground/30', 'Unknown'],
  ] as const)('%s maps to a color and name', (status, cls, label) => {
    render(SourceStatusDot, { status });
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    expect(screen.getByTestId('status-dot')).toHaveClass(cls);
  });

  it('puts the reason in the accessible name', () => {
    render(SourceStatusDot, { status: 'critical', reason: 'Disk at 93%' });
    expect(screen.getByRole('img', { name: 'Critical: Disk at 93%' })).toBeInTheDocument();
  });

  it('can print the label', () => {
    render(SourceStatusDot, { status: 'ok', showLabel: true });
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });
});
