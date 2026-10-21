import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard }));

import CopyButton from './CopyButton.svelte';

beforeEach(() => {
  vi.useFakeTimers();
  copyToClipboard.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies and shows Copied for 1500 ms', async () => {
    copyToClipboard.mockResolvedValue(true);
    render(CopyButton, { value: 'abc' });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyToClipboard).toHaveBeenCalledWith('abc');
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1500);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('never shows Copied when the copy fails', async () => {
    copyToClipboard.mockResolvedValue(false);
    render(CopyButton, { value: 'abc' });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('icon-only variant has an aria-label', () => {
    render(CopyButton, { value: 'abc' });
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Copy');
  });

  it('shows visible text when a label is set', () => {
    render(CopyButton, { value: 'abc', label: 'Copy token' });
    const b = screen.getByRole('button', { name: 'Copy token' });
    expect(b.textContent).toContain('Copy token');
  });
});
