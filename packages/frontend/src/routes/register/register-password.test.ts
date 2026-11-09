import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { getAuthConfig, getProviders, register } = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  getProviders: vi.fn(),
  register: vi.fn(),
}));

vi.mock('$lib/api/auth', () => ({
  authAPI: { getAuthConfig, getProviders, register },
}));

import RegisterPage from './+page.svelte';
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

describe('/register password field', () => {
  beforeEach(() => {
    localStorage.clear();
    getAuthConfig.mockReset();
    getProviders.mockReset();
    register.mockReset();
    page.url = new URL('http://localhost/register');
    getAuthConfig.mockResolvedValue({ authMode: 'standard', signupEnabled: true });
    getProviders.mockResolvedValue({ providers: [LOCAL] });
    register.mockRejectedValue(new Error('stop'));
  });

  it('renders no Confirm password field', async () => {
    render(RegisterPage);
    await screen.findByLabelText('Password');
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull();
  });

  it('show and hide toggle flips the input type and has an accessible name', async () => {
    render(RegisterPage);
    const input = (await screen.findByLabelText('Password')) as HTMLInputElement;
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle);
    expect(input.type).toBe('text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
  });

  it('blocks a weak password and says why', async () => {
    render(RegisterPage);
    await fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Jane' } });
    await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: '12345678' } });
    await waitFor(() => expect(screen.getByText('Use at least 12 characters.')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(register).not.toHaveBeenCalled();
  });

  it('submit sends name, email, password only', async () => {
    render(RegisterPage);
    await fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Jane' } });
    await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'tidal-Orbit-Granite-57' } });
    await waitFor(() => expect(screen.getByText('Strong')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      password: 'tidal-Orbit-Granite-57',
    });
  });

  it('submits a strong password typed and sent right away, before the meter loads', async () => {
    render(RegisterPage);
    await fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Jane' } });
    await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'tidal-Orbit-Granite-57' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(register).toHaveBeenCalled());
  });

  it('button reads "Create account with email" when an external provider exists', async () => {
    getProviders.mockResolvedValue({ providers: [LOCAL, OIDC] });
    render(RegisterPage);
    expect(await screen.findByRole('button', { name: 'Create account with email' })).toBeTruthy();
  });
});
