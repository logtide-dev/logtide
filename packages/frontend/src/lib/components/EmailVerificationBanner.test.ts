import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { getAuthConfig, getMe, resendVerification } = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  getMe: vi.fn(),
  resendVerification: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { getAuthConfig, getMe, resendVerification },
}));

import EmailVerificationBanner from './EmailVerificationBanner.svelte';
import { authStore } from '$lib/stores/auth';

describe('EmailVerificationBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    getAuthConfig.mockReset();
    getMe.mockReset();
    resendVerification.mockReset();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
  });

  it('shows the banner for an unverified user when the gate is on', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, emailVerificationRequired: true });
    getMe.mockResolvedValue({ user: { id: 'u1', emailVerified: false } });
    render(EmailVerificationBanner);
    await waitFor(() => expect(screen.getByText('Verify your email')).toBeTruthy());
    expect(getMe).toHaveBeenCalledWith('session-1');
  });

  it('renders nothing and skips /me when the gate is off', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    const { container } = render(EmailVerificationBanner);
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    await Promise.resolve();
    expect(getMe).not.toHaveBeenCalled();
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing for a verified user', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, emailVerificationRequired: true });
    getMe.mockResolvedValue({ user: { id: 'u1', emailVerified: true } });
    const { container } = render(EmailVerificationBanner);
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent?.trim()).toBe('');
  });

  it('resend button asks for a new email and confirms', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, emailVerificationRequired: true });
    getMe.mockResolvedValue({ user: { id: 'u1', emailVerified: false } });
    resendVerification.mockResolvedValue(undefined);
    render(EmailVerificationBanner);
    const button = await screen.findByRole('button', { name: 'Resend email' });
    await fireEvent.click(button);
    expect(resendVerification).toHaveBeenCalledWith('session-1');
    await waitFor(() => expect(screen.getByText('Verification email sent. Check your inbox.')).toBeTruthy());
  });

  it('shows the error when resend fails', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, emailVerificationRequired: true });
    getMe.mockResolvedValue({ user: { id: 'u1', emailVerified: false } });
    resendVerification.mockRejectedValue(new Error('Too many requests. Please wait a while before asking for another email.'));
    render(EmailVerificationBanner);
    await fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }));
    await waitFor(() => expect(screen.getByText(/Too many requests/)).toBeTruthy());
  });
});
