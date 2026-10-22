import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const { getAuthConfig, getProviders } = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  getProviders: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { getAuthConfig, getProviders, login: vi.fn() },
}));

import LoginPage from './+page.svelte';
import { page } from '../../test-stubs/app-state';

const LOCAL = {
  id: 'p-local',
  type: 'local',
  name: 'Email',
  slug: 'local',
  icon: null,
  isDefault: true,
  displayOrder: 0,
  supportsRedirect: false,
};
const OIDC = { ...LOCAL, id: 'p-oidc', type: 'oidc', name: 'Acme SSO', slug: 'acme', supportsRedirect: true };

describe('/login page', () => {
  beforeEach(() => {
    localStorage.clear();
    getAuthConfig.mockReset();
    getProviders.mockReset();
    page.url = new URL('http://localhost/login');
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    getProviders.mockResolvedValue({ providers: [LOCAL] });
  });

  it('shows Forgot password? only when passwordResetEnabled', async () => {
    const first = render(LoginPage);
    await screen.findByLabelText('Email');
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).toBeNull();
    first.unmount();

    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, passwordResetEnabled: true });
    render(LoginPage);
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toBeTruthy();
  });

  it('forgot link keeps the redirect param off the url', async () => {
    page.url = new URL('http://localhost/login?redirect=%2Fdashboard%2Fx');
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true, passwordResetEnabled: true });
    render(LoginPage);
    const link = await screen.findByRole('link', { name: 'Forgot password?' });
    expect(link.getAttribute('href')).toBe('/forgot-password');
  });

  it('button is "Sign in" when email is the only provider', async () => {
    render(LoginPage);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('button is "Sign in with email" when an OIDC provider exists', async () => {
    getProviders.mockResolvedValue({ providers: [LOCAL, OIDC] });
    render(LoginPage);
    expect(await screen.findByRole('button', { name: 'Sign in with email' })).toBeTruthy();
  });
});
