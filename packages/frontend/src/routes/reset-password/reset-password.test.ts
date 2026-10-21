import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { confirmPasswordReset } = vi.hoisted(() => ({ confirmPasswordReset: vi.fn() }));

vi.mock('$lib/api/auth', () => ({
  authAPI: { confirmPasswordReset },
}));

import ResetPasswordPage from './+page.svelte';
import { page } from '../../test-stubs/app-state';
import { authStore } from '$lib/stores/auth';

async function typePassword(value: string) {
  await fireEvent.input(screen.getByLabelText('New password'), { target: { value } });
}

describe('/reset-password page', () => {
  beforeEach(() => {
    localStorage.clear();
    confirmPasswordReset.mockReset();
    authStore.clearAuth();
    page.url = new URL('http://localhost/reset-password?token=tok123');
  });

  it('submits token and password and shows the sign in action', async () => {
    confirmPasswordReset.mockResolvedValue(undefined);
    render(ResetPasswordPage);
    await typePassword('longenough');
    await fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(screen.getByText('Password updated')).toBeTruthy());
    expect(confirmPasswordReset).toHaveBeenCalledWith('tok123', 'longenough');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('invalid token shows Request a new link pointing to /forgot-password', async () => {
    confirmPasswordReset.mockRejectedValue(new Error('invalid_or_expired_token'));
    render(ResetPasswordPage);
    await typePassword('longenough');
    await fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(screen.getByText('This link is invalid or expired')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Request a new link' }).getAttribute('href')).toBe(
      '/forgot-password'
    );
  });

  it('missing token shows the error state without calling the api', async () => {
    page.url = new URL('http://localhost/reset-password');
    render(ResetPasswordPage);
    await waitFor(() => expect(screen.getByText('This link is invalid or expired')).toBeTruthy());
    expect(confirmPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeTruthy();
  });

  it('password under 8 characters blocks submit', async () => {
    render(ResetPasswordPage);
    await typePassword('short');
    const button = screen.getByRole('button', { name: 'Set new password' });
    expect(button).toBeDisabled();
    await fireEvent.submit(button.closest('form')!);
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('has an accessible show and hide toggle', async () => {
    render(ResetPasswordPage);
    const input = screen.getByLabelText('New password') as HTMLInputElement;
    expect(input.type).toBe('password');
    await fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('clears local auth on success', async () => {
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
    confirmPasswordReset.mockResolvedValue(undefined);
    render(ResetPasswordPage);
    await typePassword('longenough');
    await fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(screen.getByText('Password updated')).toBeTruthy());
    let token: string | null = 'x';
    authStore.subscribe((s) => (token = s.token))();
    expect(token).toBeNull();
  });
});
