import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { getMe, resendVerification } = vi.hoisted(() => ({
  getMe: vi.fn(),
  resendVerification: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { getMe, resendVerification },
}));

import VerifyEmailStep from './VerifyEmailStep.svelte';
import { authStore } from '$lib/stores/auth';

beforeEach(() => {
  vi.useFakeTimers();
  getMe.mockReset();
  resendVerification.mockReset();
  authStore.setAuth({ id: 'u1', email: 'jane@example.com', name: 'Jane' }, 'tok');
});
afterEach(() => {
  vi.useRealTimers();
  authStore.clearAuth();
});

describe('VerifyEmailStep', () => {
  it('shows the address', () => {
    getMe.mockResolvedValue({ user: { emailVerified: false } });
    render(VerifyEmailStep, { onVerified: vi.fn() });
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('polls every 5 s and advances once verified', async () => {
    getMe
      .mockResolvedValueOnce({ user: { emailVerified: false } })
      .mockResolvedValue({ user: { emailVerified: true } });
    const onVerified = vi.fn();
    render(VerifyEmailStep, { onVerified });
    await vi.advanceTimersByTimeAsync(4900);
    expect(getMe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onVerified).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20000);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a failed check', async () => {
    getMe.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ user: { emailVerified: true } });
    const onVerified = vi.fn();
    render(VerifyEmailStep, { onVerified });
    await vi.advanceTimersByTimeAsync(10100);
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('stops polling on destroy', async () => {
    getMe.mockResolvedValue({ user: { emailVerified: false } });
    const { unmount } = render(VerifyEmailStep, { onVerified: vi.fn() });
    await vi.advanceTimersByTimeAsync(5100);
    unmount();
    const calls = getMe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(getMe.mock.calls.length).toBe(calls);
  });

  it('resend calls resendVerification and disables the button during the cooldown', async () => {
    getMe.mockResolvedValue({ user: { emailVerified: false } });
    resendVerification.mockResolvedValue(undefined);
    render(VerifyEmailStep, { onVerified: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(resendVerification).toHaveBeenCalledWith('tok');
    expect(screen.getByRole('button', { name: /Resend email/ })).toBeDisabled();
    await vi.advanceTimersByTimeAsync(61000);
    expect(screen.getByRole('button', { name: 'Resend email' })).not.toBeDisabled();
  });
});
