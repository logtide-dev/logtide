import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import RuleFilters from './RuleFilters.svelte';
import { EMPTY_RULE_FILTERS } from './rule-filters';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RuleFilters', () => {
  it('typing debounces onChange by 300ms', async () => {
    const onChange = vi.fn();
    render(RuleFilters, { value: EMPTY_RULE_FILTERS, onChange });
    const input = screen.getByRole('searchbox', { name: 'Search rules' });
    await fireEvent.input(input, { target: { value: 'ssh' } });
    await vi.advanceTimersByTimeAsync(299);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_RULE_FILTERS, q: 'ssh' });
  });

  it('only the last keystroke within the window is emitted', async () => {
    const onChange = vi.fn();
    render(RuleFilters, { value: EMPTY_RULE_FILTERS, onChange });
    const input = screen.getByRole('searchbox', { name: 'Search rules' });
    await fireEvent.input(input, { target: { value: 's' } });
    await vi.advanceTimersByTimeAsync(200);
    await fireEvent.input(input, { target: { value: 'ssh' } });
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].q).toBe('ssh');
  });

  it('severity selection emits arrays', async () => {
    const onChange = vi.fn();
    render(RuleFilters, { value: { ...EMPTY_RULE_FILTERS, severity: ['high'] }, onChange });
    await fireEvent.click(screen.getByRole('button', { name: 'Critical' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_RULE_FILTERS, severity: ['high', 'critical'] });
  });

  it('deselecting a severity removes it', async () => {
    const onChange = vi.fn();
    render(RuleFilters, { value: { ...EMPTY_RULE_FILTERS, severity: ['high'] }, onChange });
    await fireEvent.click(screen.getByRole('button', { name: 'High' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_RULE_FILTERS, severity: [] });
  });

  it('Clear filters resets everything', async () => {
    const onChange = vi.fn();
    render(RuleFilters, { value: { ...EMPTY_RULE_FILTERS, source: ['pack'] }, onChange });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_RULE_FILTERS);
  });
});
