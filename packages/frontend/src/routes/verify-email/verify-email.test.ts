import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const { verifyEmail, getState } = vi.hoisted(() => ({ verifyEmail: vi.fn(), getState: vi.fn() }));

vi.mock('$lib/api/auth', () => ({
  authAPI: { verifyEmail },
}));

vi.mock('$lib/api/onboarding', () => ({
  OnboardingAPI: class {
    getState = getState;
  },
}));

import VerifyEmailPage from './+page.svelte';
// Same module the alias resolves $app/state to, typed loosely for tests.
import { page } from '../../test-stubs/app-state';
import { authStore } from '$lib/stores/auth';

describe('/verify-email page', () => {
  beforeEach(() => {
    localStorage.clear();
    verifyEmail.mockReset();
    getState.mockReset();
    getState.mockResolvedValue({ tutorialCompleted: true, tutorialSkipped: false });
    authStore.clearAuth();
  });

  it('consumes the token from the url and confirms', async () => {
    page.url = new URL('http://localhost/verify-email?token=abc123');
    verifyEmail.mockResolvedValue(undefined);
    render(VerifyEmailPage);
    await waitFor(() => expect(screen.getByText('Email verified')).toBeTruthy());
    expect(verifyEmail).toHaveBeenCalledWith('abc123', null);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('sends the session when signed in and links to the dashboard', async () => {
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
    page.url = new URL('http://localhost/verify-email?token=abc123');
    verifyEmail.mockResolvedValue(undefined);
    render(VerifyEmailPage);
    await waitFor(() => expect(screen.getByText('Email verified')).toBeTruthy());
    expect(verifyEmail).toHaveBeenCalledWith('abc123', 'session-1');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Go to dashboard' }).getAttribute('href')).toBe('/dashboard');
  });

  it('signed in with unfinished onboarding shows Continue setup to /onboarding', async () => {
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
    page.url = new URL('http://localhost/verify-email?token=abc123');
    verifyEmail.mockResolvedValue(undefined);
    getState.mockResolvedValue({ tutorialCompleted: false, tutorialSkipped: false });
    render(VerifyEmailPage);
    const link = await screen.findByRole('link', { name: 'Continue setup' });
    expect(link.getAttribute('href')).toBe('/onboarding');
  });

  it('signed in with skipped onboarding shows Go to dashboard', async () => {
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
    page.url = new URL('http://localhost/verify-email?token=abc123');
    verifyEmail.mockResolvedValue(undefined);
    getState.mockResolvedValue({ tutorialCompleted: false, tutorialSkipped: true });
    render(VerifyEmailPage);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Continue setup' })).toBeNull();
  });

  it('shows the failure for an invalid or used token', async () => {
    page.url = new URL('http://localhost/verify-email?token=used');
    verifyEmail.mockRejectedValue(new Error('This verification link is invalid, expired or was already used.'));
    render(VerifyEmailPage);
    await waitFor(() => expect(screen.getByText('Verification failed')).toBeTruthy());
    expect(screen.getByText('This verification link is invalid, expired or was already used.')).toBeTruthy();
  });

  it('reports a missing token without calling the api', async () => {
    page.url = new URL('http://localhost/verify-email');
    render(VerifyEmailPage);
    await waitFor(() => expect(screen.getByText('This verification link is missing its token.')).toBeTruthy());
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
