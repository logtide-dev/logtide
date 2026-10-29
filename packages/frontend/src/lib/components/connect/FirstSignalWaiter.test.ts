import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FirstSignalWaiter from './FirstSignalWaiter.svelte';
import type { FirstSignal } from '$lib/api/first-signal';

const empty: FirstSignal = {
  logs: false,
  traces: false,
  metrics: false,
  errors: false,
  firstAt: null,
  lastEventAt: null,
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FirstSignalWaiter', () => {
  it('calls onDetected once when any signal becomes true (traces only)', async () => {
    const fetchSignal = vi
      .fn()
      .mockResolvedValueOnce(empty)
      .mockResolvedValue({ ...empty, traces: true });
    const onDetected = vi.fn();
    render(FirstSignalWaiter, { projectId: 'p1', onDetected, fetchSignal, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(onDetected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Received traces')).toBeInTheDocument();

    const calls = fetchSignal.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSignal.mock.calls.length).toBe(calls);
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it('names several signal kinds', async () => {
    const fetchSignal = vi.fn().mockResolvedValue({ ...empty, logs: true, traces: true });
    render(FirstSignalWaiter, { projectId: 'p1', onDetected: vi.fn(), fetchSignal });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Received logs and traces')).toBeInTheDocument();
  });

  it('detects an error-only project', async () => {
    const onDetected = vi.fn();
    const fetchSignal = vi.fn().mockResolvedValue({ ...empty, errors: true });
    render(FirstSignalWaiter, { projectId: 'p1', onDetected, fetchSignal });
    await vi.advanceTimersByTimeAsync(0);
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a rejected fetch and does not show tips', async () => {
    const fetchSignal = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ...empty, logs: true });
    const onDetected = vi.fn();
    render(FirstSignalWaiter, { projectId: 'p1', onDetected, fetchSignal, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByTestId('troubleshooting-tips')).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it('shows troubleshooting tips after 60 s without a signal', async () => {
    const fetchSignal = vi.fn().mockResolvedValue(empty);
    render(FirstSignalWaiter, { projectId: 'p1', onDetected: vi.fn(), fetchSignal });
    await vi.advanceTimersByTimeAsync(59000);
    expect(screen.queryByTestId('troubleshooting-tips')).toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    expect(screen.getByTestId('troubleshooting-tips')).toBeInTheDocument();
    expect(screen.getByText(/Wrong API key/)).toBeInTheDocument();
  });

  it('stops polling after unmount', async () => {
    const fetchSignal = vi.fn().mockResolvedValue(empty);
    const { unmount } = render(FirstSignalWaiter, {
      projectId: 'p1',
      onDetected: vi.fn(),
      fetchSignal,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(2500);
    unmount();
    const calls = fetchSignal.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchSignal.mock.calls.length).toBe(calls);
  });

  it('Skip for now calls onSkip', async () => {
    const onSkip = vi.fn();
    render(FirstSignalWaiter, {
      projectId: 'p1',
      onDetected: vi.fn(),
      onSkip,
      fetchSignal: vi.fn().mockResolvedValue(empty),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalled();
  });
});
