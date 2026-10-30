import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import MetricCombobox from './MetricCombobox.svelte';

const options = [
  { name: 'http.server.duration', type: 'histogram' },
  { name: 'process.memory.bytes', type: 'gauge' },
  { name: 'process.cpu.time', type: 'sum' },
];

describe('MetricCombobox', () => {
  it('filters options by typed text', async () => {
    render(MetricCombobox, { options, value: null, onSelect: vi.fn() });
    const input = screen.getByRole('combobox', { name: 'Metric' });
    await fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await fireEvent.input(input, { target: { value: 'process' } });
    const shown = screen.getAllByRole('option');
    expect(shown).toHaveLength(2);
    expect(shown[0].textContent).toContain('process.memory.bytes');
    expect(shown[0].textContent).toContain('gauge');
  });

  it('selecting calls onSelect', async () => {
    const onSelect = vi.fn();
    render(MetricCombobox, { options, value: null, onSelect });
    await fireEvent.focus(screen.getByRole('combobox', { name: 'Metric' }));
    await fireEvent.click(screen.getByRole('option', { name: /process\.cpu\.time/ }));
    expect(onSelect).toHaveBeenCalledWith('process.cpu.time');
  });

  it('shows an empty message when nothing matches', async () => {
    render(MetricCombobox, { options, value: null, onSelect: vi.fn() });
    const input = screen.getByRole('combobox', { name: 'Metric' });
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No metrics found')).toBeInTheDocument();
  });

  it('keyboard enter picks the highlighted option', async () => {
    const onSelect = vi.fn();
    render(MetricCombobox, { options, value: null, onSelect });
    const input = screen.getByRole('combobox', { name: 'Metric' });
    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('process.memory.bytes');
  });
});
