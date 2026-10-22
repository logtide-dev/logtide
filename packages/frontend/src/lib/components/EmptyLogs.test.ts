import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard: h.copyToClipboard }));

import { render, screen, fireEvent } from '@testing-library/svelte';
import EmptyLogs from './EmptyLogs.svelte';
import { toastStore } from '$lib/stores/toast';

beforeEach(() => {
  h.copyToClipboard.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmptyLogs', () => {
  it('uses sentence case copy', () => {
    render(EmptyLogs);
    expect(screen.getByRole('heading', { name: 'No logs yet' })).toBeTruthy();
    expect(screen.getByText('Get API key')).toBeTruthy();
    expect(screen.getByText('Read docs')).toBeTruthy();
    expect(screen.getByText('Quick start')).toBeTruthy();
    expect(screen.queryByText(/No Logs Yet|Get API Key|Read Docs|Quick Start/)).toBeNull();
  });

  it('labels the copy button and confirms without an exclamation mark', async () => {
    const success = vi.spyOn(toastStore, 'success').mockImplementation(() => {});
    render(EmptyLogs);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.copyToClipboard).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('Code copied');
  });

  it('uses no raw palette colours', () => {
    const { container } = render(EmptyLogs);
    expect(container.innerHTML).not.toMatch(/\btext-(red|green|yellow|blue|purple|orange)-\d{3}\b/);
  });
});
