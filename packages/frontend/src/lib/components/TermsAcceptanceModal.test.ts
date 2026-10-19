import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { getAuthConfig, getMe, acceptTerms, logout, goto } = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  getMe: vi.fn(),
  acceptTerms: vi.fn(),
  logout: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { getAuthConfig, getMe, acceptTerms, logout },
}));
vi.mock('$app/navigation', () => ({ goto }));

import TermsAcceptanceModal from './TermsAcceptanceModal.svelte';
import { authStore } from '$lib/stores/auth';
import { requestTermsRecheck } from '$lib/stores/terms-recheck';
import { get } from 'svelte/store';

const TERMS = {
  authMode: 'standard',
  signupEnabled: true,
  termsUrl: 'https://example.com/terms',
  privacyUrl: 'https://example.com/privacy',
  termsVersion: '2026-10-19',
};

describe('TermsAcceptanceModal', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const fn of [getAuthConfig, getMe, acceptTerms, logout, goto]) fn.mockReset();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
  });

  it('blocks a pending user with both links opening in a new tab', async () => {
    getAuthConfig.mockResolvedValue(TERMS);
    getMe.mockResolvedValue({ user: { id: 'u1', termsAcceptanceRequired: true } });
    render(TermsAcceptanceModal);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const terms = screen.getByRole('link', { name: 'Terms of Service' });
    const privacy = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(terms.getAttribute('href')).toBe(TERMS.termsUrl);
    expect(privacy.getAttribute('href')).toBe(TERMS.privacyUrl);
    expect(terms.getAttribute('target')).toBe('_blank');
    expect(privacy.getAttribute('target')).toBe('_blank');
    expect(terms.getAttribute('rel')).toContain('noopener');
    expect(getMe).toHaveBeenCalledWith('session-1');
  });

  it('renders nothing and skips /me when terms are not configured', async () => {
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    const { container } = render(TermsAcceptanceModal);
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    await Promise.resolve();
    expect(getMe).not.toHaveBeenCalled();
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders nothing when the user already accepted', async () => {
    getAuthConfig.mockResolvedValue(TERMS);
    getMe.mockResolvedValue({ user: { id: 'u1' } });
    const { container } = render(TermsAcceptanceModal);
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.textContent?.trim()).toBe('');
  });

  it('accept sends the current version, reloads the user and closes', async () => {
    getAuthConfig.mockResolvedValue(TERMS);
    getMe
      .mockResolvedValueOnce({ user: { id: 'u1', termsAcceptanceRequired: true } })
      .mockResolvedValueOnce({ user: { id: 'u1' } });
    acceptTerms.mockResolvedValue(undefined);
    render(TermsAcceptanceModal);
    await fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(acceptTerms).toHaveBeenCalledWith('session-1', '2026-10-19');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('keeps the modal open and shows the error when accept fails', async () => {
    getAuthConfig.mockResolvedValue(TERMS);
    getMe.mockResolvedValue({ user: { id: 'u1', termsAcceptanceRequired: true } });
    acceptTerms.mockRejectedValue(new Error('The terms were updated in the meantime.'));
    render(TermsAcceptanceModal);
    await fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.getByText('The terms were updated in the meantime.')).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('log out revokes the session, clears auth and goes to /login', async () => {
    getAuthConfig.mockResolvedValue(TERMS);
    getMe.mockResolvedValue({ user: { id: 'u1', termsAcceptanceRequired: true } });
    logout.mockResolvedValue(undefined);
    render(TermsAcceptanceModal);
    await fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/login'));
    expect(logout).toHaveBeenCalledWith('session-1');
    expect(get(authStore).token).toBeNull();
  });
});

describe('TermsAcceptanceModal re-check', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const fn of [getAuthConfig, getMe, acceptTerms, logout, goto]) fn.mockReset();
    authStore.setAuth({ id: 'u1', email: 'a@b.c', name: 'A' }, 'session-1');
  });

  it('appears without a reload when a request reports terms_not_accepted', async () => {
    getAuthConfig.mockResolvedValue(TERMS);
    getMe.mockResolvedValueOnce({ user: { id: 'u1' } });
    render(TermsAcceptanceModal);
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();

    // The terms version was bumped while the page was open.
    getAuthConfig.mockResolvedValue({ ...TERMS, termsVersion: '2026-12-01' });
    getMe.mockResolvedValueOnce({ user: { id: 'u1', termsAcceptanceRequired: true } });
    requestTermsRecheck();
    expect(await screen.findByRole('dialog')).toBeTruthy();

    acceptTerms.mockResolvedValue(undefined);
    getMe.mockResolvedValueOnce({ user: { id: 'u1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(acceptTerms).toHaveBeenCalledWith('session-1', '2026-12-01');
  });
});
