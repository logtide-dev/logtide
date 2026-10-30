import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { requestPasswordReset, getAuthConfig } = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  getAuthConfig: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { requestPasswordReset, getAuthConfig },
}));

import ForgotPasswordPage from './+page.svelte';

const CONFIRMATION =
  'If an account exists for that address, we sent a link to reset the password. The link works for 1 hour.';

async function submitWith(email: string) {
  await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
  await fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
}

describe('/forgot-password page', () => {
  beforeEach(() => {
    requestPasswordReset.mockReset();
    getAuthConfig.mockReset();
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, passwordResetEnabled: true });
  });

  it('shows the same confirmation after success and after a network failure', async () => {
    requestPasswordReset.mockResolvedValue(undefined);
    const first = render(ForgotPasswordPage);
    await submitWith('a@b.co');
    await waitFor(() => expect(screen.getByText(CONFIRMATION)).toBeTruthy());
    first.unmount();

    requestPasswordReset.mockRejectedValue(new TypeError('Failed to fetch'));
    render(ForgotPasswordPage);
    await submitWith('a@b.co');
    await waitFor(() => expect(screen.getByText(CONFIRMATION)).toBeTruthy());
  });

  it('disables the submit button while sending', async () => {
    let resolve: () => void = () => {};
    requestPasswordReset.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    render(ForgotPasswordPage);
    await submitWith('a@b.co');
    const button = await screen.findByRole('button', { name: /Sending/ });
    expect(button).toBeDisabled();
    await fireEvent.click(button);
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(screen.getByText(CONFIRMATION)).toBeTruthy());
  });

  it('trims the address before sending', async () => {
    requestPasswordReset.mockResolvedValue(undefined);
    render(ForgotPasswordPage);
    await submitWith('  A@B.co ');
    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('A@B.co'));
  });

  it('shows the unavailable state when passwordResetEnabled is false', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    render(ForgotPasswordPage);
    await waitFor(() => expect(screen.getByText('Password reset is not available')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('429 shows the retry message', async () => {
    requestPasswordReset.mockRejectedValue(new Error('rate_limited'));
    render(ForgotPasswordPage);
    await submitWith('a@b.co');
    await waitFor(() => expect(screen.getByText('Too many attempts, try again later')).toBeTruthy());
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });
});
