import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('$lib/stores/toast', () => ({
  toastStore: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import DashboardErrorState from './DashboardErrorState.svelte';
import { APP_VERSION } from '$lib/components/Footer.svelte';
import { page } from '$app/state';

const writeText = vi.fn();

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  (page as { url: URL }).url = new URL('http://localhost/dashboard/logs?q=secret-filter');
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('DashboardErrorState', () => {
  it('renders the error state with Retry and Copy error details', () => {
    render(DashboardErrorState, { props: { error: new Error('boom'), reset: vi.fn() } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('This page failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy error details' })).toBeInTheDocument();
  });

  it('Retry calls reset', async () => {
    const reset = vi.fn();
    render(DashboardErrorState, { props: { error: new Error('boom'), reset } });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('copies the built details to the clipboard without the query string', async () => {
    writeText.mockResolvedValue(undefined);
    render(DashboardErrorState, { props: { error: new Error('boom'), reset: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('Message: boom');
    expect(text).toContain('Path: /dashboard/logs\n');
    expect(text).toContain(`Version: ${APP_VERSION}`);
    expect(text).not.toContain('secret-filter');
  });

  it('keeps the details selectable when the clipboard is blocked', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(DashboardErrorState, { props: { error: new Error('boom'), reset: vi.fn() } });
    expect(screen.queryByTestId('error-details')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }));
    const pre = await screen.findByTestId('error-details');
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toContain('Message: boom');
    expect(toastError).toHaveBeenCalledWith('Could not copy, select the details below');
    warn.mockRestore();
    err.mockRestore();
  });
});
